import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { summarizeAcousticWave } from './acousticWave';
import { containsOrchestrationArtifact, probeMemory, recordInteraction } from './memoryBrain';
import { processWaveThought } from './localBrain';
import { textToWave } from './modulator';
import { parseStreamMessage } from './protocol';
import { simulateInterference, type WaveUnit } from './virtualCrystal';

const THOUGHT_THROTTLE_MS = 1500;
const ACOUSTIC_THROTTLE_MS = 2500;

if (!existsSync('logs')) {
    mkdirSync('logs', { recursive: true });
}

const clientThrottles = new Map<string, number>();
const clientAcousticThrottles = new Map<string, number>();
const activeAcousticClients = new Set<string>();
const activeConnections = new Set<{ close(): void }>();

function createTextVector(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
    return simulateInterference(waveA, waveB);
}

async function recordAssistantMemory(response: string, sessionId: string, turnId: string, parentAtomId: number, inputMode: 'text' | 'acoustic-uplink') {
    if (containsOrchestrationArtifact(response)) {
        return;
    }

    await recordInteraction({
        contentText: response,
        waveSignature: createTextVector(response),
        sourceKind: 'assistant',
        modality: 'system_derived',
        sessionId,
        turnId,
        parentAtomId,
        salience: 0.78,
        confidence: 0.62,
        rawPayload: {
            inputMode,
            response
        }
    });
}

const app = new Elysia()
    .use(staticPlugin())
    .onError(({ code, error }) => {
        if (code === 'NOT_FOUND') return;

        const timestamp = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';

        appendFileSync('logs/server.log', `[${timestamp}] ERROR ${code}: ${errorMessage}\n${errorStack}\n\n`);
        console.error(`Global error caught: ${errorMessage}`);
    })
    .get('/', () => Bun.file('public/index.html'))
    .get('/favicon.ico', () => Bun.file('public/favicon.ico'))
    .ws('/stream', {
        open(ws) {
            activeConnections.add(ws);
            console.log('Client connected to Virtual Crystal Stream');
        },
        close(ws) {
            activeConnections.delete(ws);
            clientThrottles.delete(ws.id);
            clientAcousticThrottles.delete(ws.id);
            activeAcousticClients.delete(ws.id);
        },
        async message(ws, message: unknown) {
            const start = performance.now();

            try {
                const parsedMessage = parseStreamMessage(message);
                if (!parsedMessage) {
                    ws.send({ status: 'error', message: 'Invalid stream payload.' });
                    return;
                }

                if (parsedMessage.kind === 'thought') {
                    const now = Date.now();
                    const lastThought = clientThrottles.get(ws.id) || 0;
                    if (now - lastThought < THOUGHT_THROTTLE_MS) {
                        ws.send({ status: 'error', message: 'Resonance saturated. Wait for wave stabilization.' });
                        return;
                    }
                    clientThrottles.set(ws.id, now);

                    const turnId = crypto.randomUUID();
                    const thoughtVector = createTextVector(parsedMessage.thought);
                    const memoryProbe = await probeMemory(parsedMessage.thought, thoughtVector);

                    const userAtom = await recordInteraction({
                        contentText: parsedMessage.thought,
                        waveSignature: thoughtVector,
                        sourceKind: 'user',
                        modality: 'text',
                        sessionId: ws.id,
                        turnId,
                        salience: 0.84,
                        confidence: 0.82,
                        rawPayload: {
                            thought: parsedMessage.thought
                        }
                    });

                    const aiResult = await processWaveThought(parsedMessage.thought, memoryProbe.assembledContext);
                    await recordAssistantMemory(aiResult.finalResponse, ws.id, turnId, userAtom.id, 'text');

                    const latencyMs = (performance.now() - start).toFixed(2);

                    ws.send({
                        status: 'thought_processed',
                        response: aiResult.finalResponse,
                        modelOutputs: {
                            qwen: aiResult.qwenOutput,
                            gemma: aiResult.gemmaOutput,
                            final: aiResult.finalResponse
                        },
                        vector: thoughtVector,
                        memoryActive: memoryProbe.citations.length > 0,
                        context: memoryProbe.assembledContext,
                        memoryCitations: memoryProbe.citations,
                        memoryMode: memoryProbe.memoryMode,
                        branchWarnings: memoryProbe.branchWarnings,
                        latencyMs,
                        timestamp: Date.now()
                    });

                    return;
                }

                const interference = simulateInterference(parsedMessage.waveA, parsedMessage.waveB);

                if (parsedMessage.source !== 'acoustic-uplink') {
                    ws.send({
                        status: 'processed',
                        samples: interference.length,
                        vector: interference,
                        timestamp: Date.now()
                    });
                    return;
                }

                const now = Date.now();
                const lastAcousticThought = clientAcousticThrottles.get(ws.id) || 0;
                if (activeAcousticClients.has(ws.id) || now - lastAcousticThought < ACOUSTIC_THROTTLE_MS) {
                    return;
                }

                clientAcousticThrottles.set(ws.id, now);
                activeAcousticClients.add(ws.id);

                try {
                    const turnId = crypto.randomUUID();
                    const acousticSummary = summarizeAcousticWave(parsedMessage.waveA, interference);
                    const memoryProbe = await probeMemory(acousticSummary.prompt, interference);

                    const userAtom = await recordInteraction({
                        contentText: acousticSummary.memoryText,
                        waveSignature: interference,
                        sourceKind: 'user',
                        modality: 'acoustic_summary',
                        sessionId: ws.id,
                        turnId,
                        salience: 0.6,
                        confidence: 0.48,
                        rawPayload: {
                            source: 'acoustic-uplink',
                            waveA: parsedMessage.waveA,
                            summary: acousticSummary
                        }
                    });

                    const aiResult = await processWaveThought(acousticSummary.prompt, memoryProbe.assembledContext);
                    await recordAssistantMemory(aiResult.finalResponse, ws.id, turnId, userAtom.id, 'acoustic-uplink');

                    const latencyMs = (performance.now() - start).toFixed(2);

                    ws.send({
                        status: 'thought_processed',
                        response: aiResult.finalResponse,
                        modelOutputs: {
                            qwen: aiResult.qwenOutput,
                            gemma: aiResult.gemmaOutput,
                            final: aiResult.finalResponse
                        },
                        vector: interference,
                        memoryActive: memoryProbe.citations.length > 0,
                        context: memoryProbe.assembledContext,
                        memoryCitations: memoryProbe.citations,
                        memoryMode: memoryProbe.memoryMode,
                        branchWarnings: memoryProbe.branchWarnings,
                        inputMode: 'acoustic-uplink',
                        latencyMs,
                        timestamp: Date.now()
                    });
                } finally {
                    activeAcousticClients.delete(ws.id);
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error('Wave processing error:', errorMessage);
                ws.send({ status: 'error', message: `Wave collapse: ${errorMessage}` });
            }
        }
    })
    .listen(3000);

process.on('SIGINT', () => {
    console.log('\nVirtual Crystal powering down.');
    for (const ws of activeConnections) {
        ws.close();
    }
    setTimeout(() => process.exit(0), 500);
});

console.log(`\nVirtual Crystal WebSocket server is running at localhost:3000`);
console.log('Endpoint: ws://localhost:3000/stream');

export { app };
