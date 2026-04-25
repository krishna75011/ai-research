import { describe, expect, test } from 'bun:test';
import { summarizeAcousticWave } from '../src/acousticWave';

describe('acoustic wave summarization', () => {
    test('produces a compact memory text and model prompt from wave features', () => {
        const waveA = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const vector = [
            { re: 2, im: 0 },
            { re: 0, im: 2 },
            { re: -2, im: 0 },
            { re: 0, im: -2 }
        ];

        const summary = summarizeAcousticWave(waveA, vector);

        expect(summary.memoryText).toContain('[Acoustic Uplink]');
        expect(summary.memoryText).toContain('frequency bins=4');
        expect(summary.memoryText).toContain('dominant band=3');
        expect(summary.prompt).toContain('microphone uplink');
        expect(summary.prompt).toContain('[Acoustic Signature]');
        expect(summary.prompt).toContain('mean interference magnitude=');
    });
});
