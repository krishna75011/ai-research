import { describe, expect, test } from 'bun:test';
import { textToWave } from '../src/modulator';
import { simulateInterference } from '../src/virtualCrystal';

describe('wave modulation', () => {
    test('converts text characters into normalized phase values', () => {
        const wave = textToWave('A');
        expect(wave).toHaveLength(1);
        expect(wave[0]).toBeCloseTo((65 / 255) * Math.PI * 2);
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
