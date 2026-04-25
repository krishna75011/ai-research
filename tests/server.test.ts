import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { textToWave } from '../src/modulator';
import { parseStreamMessage } from '../src/protocol';
import { simulateInterference } from '../src/virtualCrystal';

const TEST_PORT = 9877;
let server: { stop(): void };

function createTestServer() {
    return new Elysia()
        .ws('/stream', {
            message(ws, message: unknown) {
                const parsed = parseStreamMessage(message);
                if (!parsed) {
                    ws.send(JSON.stringify({ status: 'error', message: 'Invalid stream payload.' }));
                    return;
                }

                const waveA = textToWave(parsed.thought);
                const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
                const vector = simulateInterference(waveA, waveB);

                ws.send(JSON.stringify({
                    status: 'thought_processed',
                    response: `Echo: ${parsed.thought}`,
                    vector,
                    timestamp: Date.now()
                }));
            }
        })
        .listen(TEST_PORT);
}

function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/stream`);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        ws.addEventListener('message', (event) => {
            resolve(JSON.parse(event.data as string) as Record<string, unknown>);
        }, { once: true });
    });
}

beforeAll(() => {
    server = createTestServer();
});

afterAll(() => {
    server.stop();
});

describe('WebSocket server integration', () => {
    test('returns a thought response for a valid thought message', async () => {
        const ws = await connectWs();
        try {
            const response = nextMessage(ws);
            ws.send(JSON.stringify({ thought: 'hello memory' }));

            const data = await response;
            expect(data.status).toBe('thought_processed');
            expect(data.response).toBe('Echo: hello memory');
            expect(Array.isArray(data.vector)).toBe(true);

            const vector = data.vector as { re: number; im: number }[];
            expect(vector.length).toBeGreaterThan(0);
            expect(typeof vector[0]!.re).toBe('number');
            expect(typeof vector[0]!.im).toBe('number');
        } finally {
            ws.close();
        }
    });

    test('returns an error for malformed payloads', async () => {
        const ws = await connectWs();
        try {
            const response = nextMessage(ws);
            ws.send('not valid json {{{');

            const data = await response;
            expect(data.status).toBe('error');
            expect(typeof data.message).toBe('string');
        } finally {
            ws.close();
        }
    });
});
