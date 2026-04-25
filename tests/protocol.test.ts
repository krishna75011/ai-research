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
        expect(parseStreamMessage(JSON.stringify({ thought: '  <ping>  ', workspaceId: 'project-1' }))).toEqual({
            kind: 'thought',
            thought: 'ping',
            workspaceId: 'project-1'
        });
    });

    test('drops blank workspace ids', () => {
        expect(parseStreamMessage({ thought: 'hello', workspaceId: '   ' })).toEqual({
            kind: 'thought',
            thought: 'hello',
            workspaceId: undefined
        });
    });

    test('rejects malformed payloads', () => {
        expect(parseStreamMessage('{')).toBeNull();
        expect(parseStreamMessage({ thought: '   ' })).toBeNull();
        expect(parseStreamMessage({ waveA: [0, Number.NaN], waveB: [1, 2] })).toBeNull();
        expect(parseStreamMessage({ waveA: [0], source: 'acoustic-uplink' })).toBeNull();
    });
});
