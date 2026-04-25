import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { buildSystemPrompt, getModelPath, isMetaResponse, selectUserFacingResponse } from '../src/localBrain';

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
        const base = 'You are Chronicle Memory, a local-first personal memory assistant.';

        test('returns the base prompt when no memory context is provided', () => {
            expect(buildSystemPrompt(base)).toBe(base);
            expect(buildSystemPrompt(base, null)).toBe(base);
            expect(buildSystemPrompt(base, '')).toBe(base);
        });

        test('appends memory context with evidence-first instruction', () => {
            const memory = '[Synthesized Memory Alpha]: crystal frequency is fibonacci';
            const result = buildSystemPrompt(base, memory);

            expect(result).toContain(base);
            expect(result).toContain(memory);
            expect(result).toContain('retrieved memory evidence');
        });

        test('preserves the base prompt at the start', () => {
            const result = buildSystemPrompt(base, 'some memory');
            expect(result.startsWith(base)).toBe(true);
        });
    });

    describe('response selection', () => {
        test('detects model-comparison responses as meta output', () => {
            expect(isMetaResponse('Gemma\'s response is more specific and relevant to the user\'s request.')).toBe(true);
            expect(isMetaResponse('Hello! How can I help you today?')).toBe(false);
        });

        test('falls back to the best user-facing candidate when synthesis is meta', () => {
            const result = selectUserFacingResponse(
                'Gemma\'s response is more specific and relevant to the user\'s request.',
                'General status noted.',
                'Hello! How can I help you today?'
            );

            expect(result).toBe('Hello! How can I help you today?');
        });

        test('keeps the synthesized response when it is already user-facing', () => {
            const result = selectUserFacingResponse(
                'Hello! How can I help you today?',
                'Hi there.',
                'Acknowledged.'
            );

            expect(result).toBe('Hello! How can I help you today?');
        });
    });
});
