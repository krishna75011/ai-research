import { describe, expect, test } from 'bun:test';
import { textToWave } from '../src/modulator';
import { simulateInterference } from '../src/virtualCrystal';

describe('wave modulation', () => {
    test('converts text characters into normalized phase values', () => {
        const wave = textToWave('A');
        expect(wave).toHaveLength(1);
        expect(wave[0]).toBeCloseTo((65 / 255) * Math.PI * 2);
    });

    test('handles Unicode characters without exceeding the phase range', () => {
        const wave = textToWave('Hello \u00e9\u4e16\ud83d\ude00');
        // Each character produces one phase value (for...of iterates code points, not code units)
        expect(wave).toHaveLength(9);
        for (const phase of wave) {
            expect(phase).toBeGreaterThanOrEqual(0);
            expect(phase).toBeLessThanOrEqual(Math.PI * 2);
        }
        // ASCII 'H' should still match the original formula
        expect(wave[0]).toBeCloseTo((72 / 255) * Math.PI * 2);
    });

    test('simulates complex interference over the shared wave length', () => {
        const result = simulateInterference([0, Math.PI / 2], [Math.PI, 0, Math.PI]);

        expect(result).toHaveLength(2);
        expect(result[0]!.re).toBeCloseTo(0);
        expect(result[0]!.im).toBeCloseTo(0);
        expect(result[1]!.re).toBeCloseTo(1);
        expect(result[1]!.im).toBeCloseTo(1);
    });
});
