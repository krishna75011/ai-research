import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { buildSystemPrompt, getModelPath } from '../src/localBrain';

describe('local brain utilities', () => {
    describe('getModelPath', () => {
        test('returns the environment variable value when set', () => {
            const original = process.env.TEST_MODEL_PATH;
            process.env.TEST_MODEL_PATH = '/custom/path/model.gguf';
            try {
                expect(getModelPath('TEST_MODEL_PATH', 'fallback.gguf')).toBe('/custom/path/model.gguf');
            } finally {
                if (original === undefined) {
                    delete process.env.TEST_MODEL_PATH;
                } else {
                    process.env.TEST_MODEL_PATH = original;
                }
            }
        });

        test('falls back to models directory when env var is not set', () => {
            const key = 'NONEXISTENT_MODEL_PATH_' + Date.now();
            const result = getModelPath(key, 'fallback.gguf');
            expect(result).toBe(path.join(process.cwd(), 'models', 'fallback.gguf'));
        });
    });

    describe('buildSystemPrompt', () => {
        const base = 'You are the Virtual Crystal AI.';

        test('returns the base prompt when no memory context is provided', () => {
            expect(buildSystemPrompt(base)).toBe(base);
            expect(buildSystemPrompt(base, null)).toBe(base);
            expect(buildSystemPrompt(base, '')).toBe(base);
        });

        test('appends memory context with cross-reference instruction', () => {
            const memory = '[Synthesized Memory Alpha]: crystal frequency is fibonacci';
            const result = buildSystemPrompt(base, memory);

            expect(result).toContain(base);
            expect(result).toContain(memory);
            expect(result).toContain('cross-reference context');
        });

        test('preserves the base prompt at the start', () => {
            const result = buildSystemPrompt(base, 'some memory');
            expect(result.startsWith(base)).toBe(true);
        });
    });
});
