import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLlama, LlamaChatSession, type LlamaContext } from 'node-llama-cpp';

interface BrainResources {
    qwenContext: LlamaContext;
    gemmaContext: LlamaContext;
    systemPrompt: string;
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
    if (/\b(qwen|gemma)\b/i.test(text)) score -= 8;
    if (/\b(response is|final answer should|therefore)\b/i.test(text)) score -= 4;

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

    return ranked[0]!.text;
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
        sequences: 1,
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
        const { qwenContext, gemmaContext, systemPrompt } = await ensureResources();
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

            qwenSession.dispose({ disposeSequence: true });
            qwenSession = null;
            gemmaSession.dispose({ disposeSequence: true });
            gemmaSession = null;

            synthesisSession = createSession(qwenContext, contextualSystemPrompt);
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
                'Combine the evidence and candidate answers into a single, clean assistant response.',
                'Answer the user directly and conversationally.',
                'DO NOT repeat the [User Input] or [Candidate Answer] headers.',
                'DO NOT include labels like "User:", "Assistant:", or timestamps in your output.',
                'DO NOT echo the user query or any part of the historical transcript.',
                'Do not say "I don\'t know" if the context provides the answer.',
                'Avoid technical IDs or "Atom #" prefixes.',
                'Return ONLY the final conversation-ready text, starting with the answer itself.'
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
            qwenSession?.dispose({ disposeSequence: true });
            gemmaSession?.dispose({ disposeSequence: true });
            synthesisSession?.dispose({ disposeSequence: true });
        }
    });
}
