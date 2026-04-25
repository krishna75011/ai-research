import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLlama, LlamaChatSession, type LlamaContext } from 'node-llama-cpp';

interface BrainResources {
    qwenContext: LlamaContext;
    gemmaContext: LlamaContext;
    systemPrompt: string;
}

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
            'Answer directly, stay grounded in retrieved evidence when it is provided, and do not invent prior discussions.',
            'If the evidence contains conflicts, acknowledge them plainly instead of collapsing them into one false certainty.'
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

export async function processWaveThought(input: string, memoryContext?: string | null, useDualBrain = true): Promise<WaveThoughtResult> {
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
                const finalResponse = await gemmaSession.prompt(input);
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
                '[Qwen Output]:',
                qwenOutput,
                '',
                '[Gemma Output]:',
                gemmaOutput,
                '',
                'Merge these two model outputs into one final answer.',
                'Keep the answer concise, grounded, and useful.',
                'Do not mention the internal model names unless the user explicitly asked for diagnostics.'
            ].join('\n');

            const finalResponse = await synthesisSession.prompt(mergePrompt);
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
