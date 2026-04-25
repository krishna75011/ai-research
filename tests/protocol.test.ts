import { describe, expect, test } from 'bun:test';
import { parseStreamMessage, sanitizeThought } from '../src/protocol';

describe('stream protocol', () => {
    test('sanitizes thought input', () => {
        expect(sanitizeThought('  <hello>  ')).toBe('hello');
        expect(sanitizeThought('x'.repeat(1100))).toHaveLength(1000);
    });

    test('parses serialized thought messages', () => {
        expect(parseStreamMessage(JSON.stringify({ thought: '  <ping>  ' }))).toEqual({
            kind: 'thought',
            thought: 'ping'
        });
    });

    test('parses numeric wave messages', () => {
        expect(parseStreamMessage({ waveA: [0, 1], waveB: [2, 3] })).toEqual({
            kind: 'wave',
            waveA: [0, 1],
            waveB: [2, 3]
        });
    });

    test('accepts acoustic waveA-only messages by synthesizing a zero waveB', () => {
        expect(parseStreamMessage({ waveA: [0.25, 0.5] })).toEqual({
            kind: 'wave',
            waveA: [0.25, 0.5],
            waveB: [0, 0]
        });
    });

    test('rejects malformed payloads', () => {
        expect(parseStreamMessage('{')).toBeNull();
        expect(parseStreamMessage({ thought: '   ' })).toBeNull();
        expect(parseStreamMessage({ waveA: [0, Number.NaN], waveB: [1, 2] })).toBeNull();
        expect(parseStreamMessage({ waveA: [0], waveB: ['1'] })).toBeNull();
        expect(parseStreamMessage({ waveA: ['0'], waveB: [1] })).toBeNull();
    });
});
