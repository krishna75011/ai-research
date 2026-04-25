import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { textToWave } from '../src/modulator';
import {
    calculateSector,
    cosineSimilarity,
    recallResonance,
    saveThoughtWave,
    triggerEntropy,
    type WaveUnit
} from '../src/resonanceLedger';
import { simulateInterference } from '../src/virtualCrystal';

function testLedgerPath(name: string): string {
    return path.join(process.cwd(), 'logs', 'tests', `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.crystal`);
}

function vectorFor(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = Array.from({ length: waveA.length }, () => 0);
    return simulateInterference(waveA, waveB);
}

describe('resonance ledger', () => {
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
    });

    test('saves and recalls a synthesized matching thought without using the root ledger', async () => {
        const ledgerPath = testLedgerPath('recall');
        const vector = vectorFor('phase memory');

        await saveThoughtWave('phase memory', vector, { ledgerPath });

        expect(await recallResonance(vector, { ledgerPath })).toBe('[Synthesized Memory Alpha]: phase memory');
    });

    test('synthesizes the top two matching memories and re-illuminates both', async () => {
        const ledgerPath = testLedgerPath('synthesis');
        await mkdir(path.dirname(ledgerPath), { recursive: true });

        const signal = [
            { re: 1, im: 0 },
            { re: 0, im: 1 }
        ];
        const scaledSignal = signal.map((value) => ({
            re: value.re * 0.991,
            im: value.im * 0.991
        }));
        const unrelated = [
            { re: -1, im: 0 },
            { re: 0, im: -1 }
        ];
        const records = [
            {
                text: 'alpha memory',
                vector: signal,
                sector: calculateSector(signal),
                amplitude: 0.85
            },
            {
                text: 'beta memory',
                vector: scaledSignal,
                sector: calculateSector(scaledSignal),
                amplitude: 0.8
            },
            {
                text: 'unrelated memory',
                vector: unrelated,
                sector: calculateSector(unrelated),
                amplitude: 0.6
            }
        ];

        await writeFile(ledgerPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);

        const context = await recallResonance(signal, { ledgerPath });
        expect(context).toBe('[Synthesized Memory Alpha]: alpha memory\n[Synthesized Memory Beta]: beta memory');

        const updatedRecords = (await readFile(ledgerPath, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as { text: string; amplitude: number });

        expect(updatedRecords.find((record) => record.text === 'alpha memory')?.amplitude).toBe(1);
        expect(updatedRecords.find((record) => record.text === 'beta memory')?.amplitude).toBe(1);
        expect(updatedRecords.find((record) => record.text === 'unrelated memory')?.amplitude).toBe(0.6);
    });

    test('deduplicates identical thoughts instead of creating multiple entries', async () => {
        const ledgerPath = testLedgerPath('dedup');
        const vector = vectorFor('repeated idea');

        await saveThoughtWave('repeated idea', vector, { ledgerPath });
        await saveThoughtWave('repeated idea', vector, { ledgerPath });
        await saveThoughtWave('repeated idea', vector, { ledgerPath });

        const lines = (await readFile(ledgerPath, 'utf8')).trim().split('\n');
        expect(lines).toHaveLength(1);

        const record = JSON.parse(lines[0]!) as { text: string; amplitude: number };
        expect(record.text).toBe('repeated idea');
        expect(record.amplitude).toBe(1);
    });

    test('enforces maximum record count by evicting lowest-amplitude entries', async () => {
        const ledgerPath = testLedgerPath('cap');
        await mkdir(path.dirname(ledgerPath), { recursive: true });

        const maxRecords = 3;

        for (let i = 0; i < 5; i++) {
            const text = `thought-${i}`;
            const vector = vectorFor(text);
            await saveThoughtWave(text, vector, { ledgerPath, maxRecords });
        }

        const lines = (await readFile(ledgerPath, 'utf8')).trim().split('\n');
        expect(lines.length).toBeLessThanOrEqual(maxRecords);
    });

    test('entropy removes exhausted records', async () => {
        const ledgerPath = testLedgerPath('entropy');
        await mkdir(path.dirname(ledgerPath), { recursive: true });

        const vector = vectorFor('short-lived memory');
        const record = {
            text: 'short-lived memory',
            vector,
            sector: calculateSector(vector),
            amplitude: 0.04
        };

        await writeFile(ledgerPath, `${JSON.stringify(record)}\n`);
        await triggerEntropy({ ledgerPath });

        expect(await readFile(ledgerPath, 'utf8')).toBe('');
    });
});
