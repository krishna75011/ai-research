import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { parseStreamMessage } from '../src/protocol';
import { simulateInterference } from '../src/virtualCrystal';

/**
 * Integration test for the WebSocket wave processing pipeline.
 *
 * Uses a minimal test server that mirrors the real server's wave handling
 * without importing localBrain (which requires GGUF model files).
 * This validates: protocol parsing → interference simulation → response format.
 */

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

                if (parsed.kind === 'wave') {
                    const interference = simulateInterference(parsed.waveA, parsed.waveB);
                    ws.send(JSON.stringify({
                        status: 'processed',
                        samples: interference.length,
                        vector: interference,
                        timestamp: Date.now()
                    }));
                }
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
    test('returns processed interference for a valid wave message', async () => {
        const ws = await connectWs();
        try {
            const response = nextMessage(ws);
            ws.send(JSON.stringify({ waveA: [0, Math.PI / 2], waveB: [Math.PI, 0] }));

            const data = await response;
            expect(data.status).toBe('processed');
            expect(data.samples).toBe(2);
            expect(Array.isArray(data.vector)).toBe(true);

            const vector = data.vector as { re: number; im: number }[];
            expect(vector).toHaveLength(2);
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

    test('synthesizes quadrature waveB when only waveA is provided', async () => {
        const ws = await connectWs();
        try {
            const response = nextMessage(ws);
            ws.send(JSON.stringify({ waveA: [0, Math.PI / 4], source: 'acoustic-uplink' }));

            const data = await response;
            expect(data.status).toBe('processed');
            expect(data.samples).toBe(2);
        } finally {
            ws.close();
        }
    });
});
