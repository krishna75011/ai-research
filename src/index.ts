import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { processWaveThought } from './localBrain';
import { textToWave } from './modulator';
import { parseStreamMessage } from './protocol';
import { recallResonance, saveThoughtWave, triggerEntropy } from './resonanceLedger';
import { simulateInterference } from './virtualCrystal';

const THOUGHT_THROTTLE_MS = 1500;

if (!existsSync('logs')) {
    mkdirSync('logs', { recursive: true });
}

const clientThrottles = new Map<string, number>();

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
            console.log('Client connected to Virtual Crystal Stream');
        },
        close(ws) {
            clientThrottles.delete(ws.id);
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

                    console.log(`\nProcessing thought: "${parsedMessage.thought.substring(0, 50)}..."`);

                    const waveA = textToWave(parsedMessage.thought);
                    const waveB = Array.from({ length: waveA.length }, () => 0);
                    const holographicVector = simulateInterference(waveA, waveB);

                    const synthesizedMemoryContext = await recallResonance(holographicVector);
                    if (synthesizedMemoryContext) {
                        console.log('Synthesized memory context activated.');
                    }

                    await saveThoughtWave(parsedMessage.thought, holographicVector);

                    const aiResponse = await processWaveThought(parsedMessage.thought, synthesizedMemoryContext);
                    const latencyMs = (performance.now() - start).toFixed(2);

                    ws.send({
                        status: 'thought_processed',
                        response: aiResponse,
                        vector: holographicVector,
                        memoryActive: Boolean(synthesizedMemoryContext),
                        context: synthesizedMemoryContext || null,
                        latencyMs,
                        timestamp: Date.now()
                    });

                    return;
                }

                const interference = simulateInterference(parsedMessage.waveA, parsedMessage.waveB);
                ws.send({
                    status: 'processed',
                    samples: interference.length,
                    vector: interference,
                    timestamp: Date.now()
                });
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error('Wave processing error:', errorMessage);
                ws.send({ status: 'error', message: `Wave collapse: ${errorMessage}` });
            }
        }
    })
    .listen(3000);

process.on('SIGINT', () => {
    console.log('\nVirtual Crystal powering down. Saving state...');
    process.exit(0);
});

console.log(`\nVirtual Crystal WebSocket server is running at localhost:3000`);
console.log('Endpoint: ws://localhost:3000/stream');

setInterval(triggerEntropy, 24 * 60 * 60 * 1000);

export { app };
