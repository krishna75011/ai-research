import { describe, expect, test } from 'bun:test';
import { parseStreamMessage, sanitizeThought } from '../src/protocol';

describe('stream protocol', () => {
    test('sanitizes thought input', () => {
        expect(sanitizeThought('  <hello>  ')).toBe('hello');
        expect(sanitizeThought('x'.repeat(1100))).toHaveLength(1000);
        expect(sanitizeThought('test\x00\x07\x1F')).toBe('test');
        expect(sanitizeThought('tab\there\nok')).toBe('tab\there\nok');
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

    test('accepts waveA-only messages by synthesizing a quadrature waveB', () => {
        const result = parseStreamMessage({ waveA: [0.25, 0.5], source: 'acoustic-uplink' });
        expect(result).not.toBeNull();
        expect(result!.kind).toBe('wave');
        if (result!.kind === 'wave') {
            expect(result!.waveA).toEqual([0.25, 0.5]);
            expect(result!.waveB[0]).toBeCloseTo(0.25 + Math.PI / 2);
            expect(result!.waveB[1]).toBeCloseTo(0.5 + Math.PI / 2);
            expect(result!.source).toBe('acoustic-uplink');
        }
    });

    test('rejects malformed payloads', () => {
        expect(parseStreamMessage('{')).toBeNull();
        expect(parseStreamMessage({ thought: '   ' })).toBeNull();
        expect(parseStreamMessage({ waveA: [0, Number.NaN], waveB: [1, 2] })).toBeNull();
        expect(parseStreamMessage({ waveA: [0], waveB: ['1'] })).toBeNull();
        expect(parseStreamMessage({ waveA: ['0'], waveB: [1] })).toBeNull();
    });
});
