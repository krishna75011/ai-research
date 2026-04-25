import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import {
    calculateSector,
    cosineSimilarity,
    recallResonance,
    saveThoughtWave,
    triggerEntropy,
    type WaveUnit
} from '../src/resonanceLedger';
import { textToWave } from '../src/modulator';
import { simulateInterference } from '../src/virtualCrystal';

function testBrainPath(name: string): string {
    return path.join(process.cwd(), 'logs', 'tests', `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function vectorFor(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
    return simulateInterference(waveA, waveB);
}

describe('resonance ledger compatibility', () => {
    test('compares both real and imaginary vector components', () => {
        const first = [
            { re: 1, im: 0 },
            { re: 0, im: 1 }
        ];
        const second = [
            { re: 1, im: 0 },
            { re: 0, im: -1 }
        ];

        expect(cosineSimilarity(first, first)).toBeCloseTo(1);
        expect(cosineSimilarity(first, second)).toBeCloseTo(0);
        expect(calculateSector(first)).toBeGreaterThanOrEqual(1);
        expect(calculateSector(first)).toBeLessThanOrEqual(10);
    });

    test('stores thought waves in the memory brain and recalls evidence-backed context', async () => {
        const brainPath = testBrainPath('compat');
        const ledgerPath = testBrainPath('compat-legacy');
        const vector = vectorFor('phase memory');

        await saveThoughtWave('phase memory', vector, { brainPath, ledgerPath });

        const recalled = await recallResonance(vector, { brainPath, ledgerPath });
        expect(recalled).toContain('[Memory Mode]: chrono-resonant-memory-brain');
        expect(recalled).toContain('phase memory');
    });

    test('does not decay or delete memory through entropy', async () => {
        const brainPath = testBrainPath('entropy');
        const ledgerPath = testBrainPath('entropy-legacy');
        const vector = vectorFor('append only memory');

        await saveThoughtWave('append only memory', vector, { brainPath, ledgerPath });

        const result = await triggerEntropy({ brainPath, ledgerPath });
        expect(result.memoryMode).toBe('chrono-resonant-memory-brain');
        expect(result.atoms).toBe(1);
    });
});
