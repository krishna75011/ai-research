import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLlama, LlamaChatSession, type LlamaContext } from 'node-llama-cpp';

interface BrainResources {
    qwenContext: LlamaContext;
    gemmaContext: LlamaContext;
    systemPrompt: string;
}

let resourcesPromise: Promise<BrainResources> | null = null;
let inferenceQueue = Promise.resolve();

function getModelPath(envName: string, fileName: string): string {
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

    console.log('Initializing dual-brain model contexts...');

    const qwenModel = await llama.loadModel({ modelPath: qwenPath });
    const qwenContext = await qwenModel.createContext({
        contextSize: 1024,
        sequences: 1,
        threads: 2
    });

    const gemmaModel = await llama.loadModel({ modelPath: gemmaPath });
    const gemmaContext = await gemmaModel.createContext({
        contextSize: 1024,
        sequences: 1,
        threads: 4
    });

    console.log('Dual-brain model contexts are ready.');

    return {
        qwenContext,
        gemmaContext,
        systemPrompt: 'You are the Virtual Crystal AI. Synthesize logical harmonic waves. Be precise and concise.'
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

function buildSystemPrompt(basePrompt: string, memoryContext?: string | null): string {
    if (!memoryContext) return basePrompt;

    return `${basePrompt}\n\n${memoryContext}\nUse these synthesized memories as cross-reference context when forming the response.`;
}

export async function processWaveThought(input: string, memoryContext?: string | null, useDualBrain = true): Promise<string> {
    return withInferenceLock(async () => {
        const { qwenContext, gemmaContext, systemPrompt } = await ensureResources();
        let alphaSession: LlamaChatSession | null = null;
        let betaSession: LlamaChatSession | null = null;
        const startTime = Date.now();

        try {
            const contextualSystemPrompt = buildSystemPrompt(systemPrompt, memoryContext);

            alphaSession = createSession(qwenContext, contextualSystemPrompt);
            betaSession = createSession(gemmaContext, contextualSystemPrompt);

            console.log('Interference initialized...');

            if (!useDualBrain) {
                return await betaSession.prompt(input);
            }

            const [alphaResponse, betaResponse] = await Promise.all([
                alphaSession.prompt(input),
                betaSession.prompt(input)
            ]);

            const interferencePrompt =
                `[Alpha Phase]: ${alphaResponse}\n` +
                `[Beta Phase]: ${betaResponse}\n` +
                'Merge these two logical phases into a single, cohesive harmonic output. Focus on the overlapping constructive ideas.';

            const finalResponse = await alphaSession.prompt(interferencePrompt);
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            console.log(`Constructive logic synthesized in ${duration}s`);
            return finalResponse;
        } finally {
            alphaSession?.dispose({ disposeSequence: true });
            betaSession?.dispose({ disposeSequence: true });
        }
    });
}
