import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLlama, LlamaChatSession, type LlamaContext } from 'node-llama-cpp';

interface BrainResources {
    qwenContext: LlamaContext;
    gemmaContext: LlamaContext;
    systemPrompt: string;
    synthesisSystemPrompt: string;
}

const META_RESPONSE_PATTERNS = [
    /\bqwen\b/i,
    /\bgemma\b/i,
    /\bmodel output\b/i,
    /\bcandidate answer\b/i,
    /\bresponse is more\b/i,
    /\bfinal answer should\b/i,
    /\btherefore,? the final answer should\b/i,
    /\bbetter answer\b/i,
    /\bmore specific and relevant\b/i
] as const;

export interface WaveThoughtResult {
    finalResponse: string;
    qwenOutput: string | null;
    gemmaOutput: string | null;
}

let resourcesPromise: Promise<BrainResources> | null = null;
let inferenceQueue = Promise.resolve();

export function getModelPath(envName: string, fileName: string): string {
    return process.env[envName] ?? path.join(process.cwd(), 'models', fileName);
}

function normalizeResponse(value: string | null | undefined): string {
    return value?.trim() ?? '';
}

export function isMetaResponse(value: string | null | undefined): boolean {
    const text = normalizeResponse(value);
    return !text || META_RESPONSE_PATTERNS.some((pattern) => pattern.test(text));
}

function scoreCandidateResponse(value: string | null | undefined): number {
    const text = normalizeResponse(value);
    if (!text) return Number.NEGATIVE_INFINITY;

    let score = 0;

    if (!isMetaResponse(text)) score += 10;
    if (text.length >= 2) score += 1;
    if (text.length <= 240) score += 1;
    if (/[.!?]$/.test(text)) score += 0.5;
    if (/^(hi|hello|hey)\b/i.test(text)) score += 0.5;
    if (text.length > 240) score += 4; // Reward detail/evidence
    if (/\b(qwen|gemma)\b/i.test(text)) score -= 8;
    if (/\b(response is|final answer should|therefore)\b/i.test(text)) score -= 4;
    if (/\b(am sorry|don't know|cannot recall|do not have|does not contain|no information)\b/i.test(text)) score -= 15; // Heavier penalty, no leading 'i'
    if (text.includes('### At')) score -= 10; 

    return score;
}

export function selectUserFacingResponse(finalResponse: string | null | undefined, qwenOutput: string | null | undefined, gemmaOutput: string | null | undefined): string {
    const candidates = [
        { source: 'final', text: normalizeResponse(finalResponse) },
        { source: 'gemma', text: normalizeResponse(gemmaOutput) },
        { source: 'qwen', text: normalizeResponse(qwenOutput) }
    ].filter((candidate) => candidate.text);

    if (!candidates.length) {
        return '';
    }

    const ranked = candidates
        .map((candidate) => ({
            ...candidate,
            score: scoreCandidateResponse(candidate.text)
        }))
        .sort((left, right) => right.score - left.score);

    const top = ranked[0]!;
    const synthesized = ranked.find(c => c.source === 'final');

    // If synthesis is almost as good as the top candidate (within 2 points), 
    // keep it to avoid jarring UX changes after streaming.
    if (synthesized && top.score - synthesized.score < 2) {
        return synthesized.text!;
    }

    return top.text!;
}

function assertModelExists(modelPath: string) {
    if (!existsSync(modelPath)) {
        throw new Error(`Missing local model file: ${modelPath}`);
    }
}

function withInferenceLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = inferenceQueue.then(operation, operation);
    inferenceQueue = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

async function initializeResources(): Promise<BrainResources> {
    const llama = await getLlama('lastBuild');

    const qwenPath = getModelPath('QWEN_MODEL_PATH', 'Qwen2-0.5B-Instruct-Q4_K_M.gguf');
    const gemmaPath = getModelPath('GEMMA_MODEL_PATH', 'gemma-4-E2B-it-Q4_K_M.gguf');

    assertModelExists(qwenPath);
    assertModelExists(gemmaPath);

    console.log('Initializing dual-model contexts...');

    const qwenModel = await llama.loadModel({ modelPath: qwenPath });
    const qwenContext = await qwenModel.createContext({
        contextSize: 2048,
        sequences: 1,
        threads: 2
    });

    const gemmaModel = await llama.loadModel({ modelPath: gemmaPath });
    const gemmaContext = await gemmaModel.createContext({
        contextSize: 2048,
        sequences: 3,
        threads: 4
    });

    return {
        qwenContext,
        gemmaContext,
        systemPrompt: [
            'You are Chronicle Memory, a local-first personal memory assistant.',
            'Your primary goal is to answer based on the provided ## MEMORY CONTEXT.',
            'If the context contains the answer, use it. Do not say you do not know if the information is present in the context.',
            'If there are conflicts in the evidence, mention them clearly.'
        ].join(' '),
        synthesisSystemPrompt: [
            'You are a high-authority synthesis engine for Chronicle Memory.',
            'You will receive a User Input and two Candidate Answers.',
            'Your task is to produce the single best response for the user.',
            'CRITICAL: Preserve the Markdown formatting (lists, bolding, line breaks) from the best candidate.',
            'DO NOT condense the response into a single paragraph if the candidate used lists.',
            'If one candidate provides a detailed answer and the other says "I don\'t know", ALWAYS prefer the detailed answer.',
            'Provide ONLY the clean, conversational assistant reply.'
        ].join(' ')
    };
}

async function ensureResources(): Promise<BrainResources> {
    resourcesPromise ??= initializeResources().catch((error) => {
        resourcesPromise = null;
        throw error;
    });

    return resourcesPromise;
}

function createSession(context: LlamaContext, systemPrompt: string): LlamaChatSession {
    return new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt
    });
}

export function buildSystemPrompt(basePrompt: string, memoryContext?: string | null): string {
    if (!memoryContext) return basePrompt;

    return `${basePrompt}\n\n${memoryContext}\nUse this retrieved memory evidence as context. Prefer cited recall over speculation, and preserve conflicts when branch warnings are present.`;
}

export async function processWaveThought(
    input: string,
    memoryContext?: string | null,
    useDualBrain = true,
    onToken?: (token: string) => void
): Promise<WaveThoughtResult> {
    return withInferenceLock(async () => {
        const { qwenContext, gemmaContext, systemPrompt, synthesisSystemPrompt } = await ensureResources();
        let qwenSession: LlamaChatSession | null = null;
        let gemmaSession: LlamaChatSession | null = null;
        let synthesisSession: LlamaChatSession | null = null;
        const startTime = Date.now();

        try {
            const contextualSystemPrompt = buildSystemPrompt(systemPrompt, memoryContext);

            qwenSession = createSession(qwenContext, contextualSystemPrompt);
            gemmaSession = createSession(gemmaContext, contextualSystemPrompt);

            if (!useDualBrain) {
                const finalResponse = await gemmaSession.prompt(input, {
                    onTextChunk(chunk) {
                        onToken?.(chunk);
                    }
                });
                return {
                    finalResponse,
                    qwenOutput: null,
                    gemmaOutput: finalResponse
                };
            }

            const [qwenOutput, gemmaOutput] = await Promise.all([
                qwenSession.prompt(input),
                gemmaSession.prompt(input)
            ]);

            // Release initial sessions before starting synthesis
            await qwenSession.dispose({ disposeSequence: true });
            qwenSession = null;
            await gemmaSession.dispose({ disposeSequence: true });
            gemmaSession = null;

            synthesisSession = createSession(gemmaContext, synthesisSystemPrompt);
            const mergePrompt = [
                '[User Input]:',
                input,
                '',
                '[Candidate Answer A]:',
                qwenOutput,
                '',
                '[Candidate Answer B]:',
                gemmaOutput,
                '',
                'Final Assistant Reply:'
            ].join('\n');

            const synthesizedResponse = await synthesisSession.prompt(mergePrompt, {
                onTextChunk(chunk) {
                    onToken?.(chunk);
                }
            });
            const finalResponse = selectUserFacingResponse(synthesizedResponse, qwenOutput, gemmaOutput);
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`Final response synthesized in ${duration}s`);

            return {
                finalResponse,
                qwenOutput,
                gemmaOutput
            };
        } finally {
            if (qwenSession) await qwenSession.dispose({ disposeSequence: true });
            if (gemmaSession) await gemmaSession.dispose({ disposeSequence: true });
            if (synthesisSession) await synthesisSession.dispose({ disposeSequence: true });
        }
    });
}
