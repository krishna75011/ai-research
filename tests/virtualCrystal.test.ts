import { describe, expect, test } from 'bun:test';
import { simulateInterference, type WaveUnit } from '../src/virtualCrystal';

describe('virtual crystal interference', () => {
    test('produces constructive interference when waves are in phase', () => {
        const result = simulateInterference([0, 0], [0, 0]);
        // cos(0) + cos(0) = 2, sin(0) + sin(0) = 0
        expect(result[0]!.re).toBeCloseTo(2);
        expect(result[0]!.im).toBeCloseTo(0);
    });

    test('produces destructive interference when waves are π apart', () => {
        const result = simulateInterference([0], [Math.PI]);
        // cos(0) + cos(π) = 1 - 1 = 0, sin(0) + sin(π) = 0
        expect(result[0]!.re).toBeCloseTo(0);
        expect(result[0]!.im).toBeCloseTo(0);
    });

    test('produces quadrature interference at π/2 phase offset', () => {
        const result = simulateInterference([0], [Math.PI / 2]);
        // cos(0) + cos(π/2) = 1 + 0 = 1, sin(0) + sin(π/2) = 0 + 1 = 1
        expect(result[0]!.re).toBeCloseTo(1);
        expect(result[0]!.im).toBeCloseTo(1);
    });

    test('uses the shorter array length when waves differ in size', () => {
        const result = simulateInterference([0, 1, 2], [0, 1]);
        expect(result).toHaveLength(2);
    });

    test('returns empty array for empty input', () => {
        expect(simulateInterference([], [1, 2, 3])).toHaveLength(0);
        expect(simulateInterference([1, 2], [])).toHaveLength(0);
        expect(simulateInterference([], [])).toHaveLength(0);
    });

    test('exports WaveUnit as the canonical complex type', () => {
        const result = simulateInterference([Math.PI / 4], [Math.PI / 4]);
        const unit: WaveUnit = result[0]!;
        expect(typeof unit.re).toBe('number');
        expect(typeof unit.im).toBe('number');
    });
});
