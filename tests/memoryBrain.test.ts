import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    getEvidenceBranches,
    getMemoryAtoms,
    getStandingWaves,
    probeMemory,
    recordInteraction
} from '../src/memoryBrain';
import { textToWave } from '../src/modulator';
import type { WaveUnit } from '../src/virtualCrystal';
import { simulateInterference } from '../src/virtualCrystal';

function testPath(name: string, extension: string): string {
    return path.join(process.cwd(), 'logs', 'tests', `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
}

function vectorFor(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
    return simulateInterference(waveA, waveB);
}

describe('memory brain', () => {
    test('records atoms, reinforces standing waves, and probes recall with citations', async () => {
        const brainPath = testPath('brain-recall', 'sqlite');
        const legacyLedgerPath = testPath('brain-recall-legacy', 'crystal');
        const statement = 'I want a totally new system for giving llms a brain that never forgets anything.';

        await recordInteraction({
            contentText: statement,
            waveSignature: vectorFor(statement),
            sourceKind: 'user',
            modality: 'text',
            sessionId: 'session-1',
            turnId: 'turn-1'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: statement,
            waveSignature: vectorFor(statement),
            sourceKind: 'user',
            modality: 'text',
            sessionId: 'session-1',
            turnId: 'turn-2'
        }, { brainPath, legacyLedgerPath });

        const standingWaves = await getStandingWaves({ brainPath, legacyLedgerPath });
        const goalWave = standingWaves.find((wave) => wave.kind === 'goal');

        expect(goalWave).toBeDefined();
        expect(goalWave!.supportCount).toBe(2);

        const probe = await probeMemory(
            'What system did I want for long term memory?',
            vectorFor('What system did I want for long term memory?'),
            { brainPath, legacyLedgerPath }
        );

        expect(probe.assembledContext).toContain(statement);
        expect(probe.citations.some((citation) => citation.kind === 'atom')).toBe(true);
        expect(probe.citations.some((citation) => citation.kind === 'standing_wave')).toBe(true);
    });

    test('preserves conflicting preferences as evidence branches', async () => {
        const brainPath = testPath('brain-branch', 'sqlite');
        const legacyLedgerPath = testPath('brain-branch-legacy', 'crystal');
        const first = 'I prefer local memory mode for long term alpha.';
        const second = 'I prefer local memory mode for long term beta.';

        await recordInteraction({
            contentText: first,
            waveSignature: vectorFor(first),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: second,
            waveSignature: vectorFor(second),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        const branches = await getEvidenceBranches({ brainPath, legacyLedgerPath });
        expect(branches.length).toBeGreaterThanOrEqual(2);

        const probe = await probeMemory(
            'Which local memory mode did I prefer for long term?',
            vectorFor('Which local memory mode did I prefer for long term?'),
            { brainPath, legacyLedgerPath }
        );

        expect(probe.branchWarnings.length).toBeGreaterThan(0);
        expect(probe.assembledContext).toContain('[Branch Warnings]');
    });

    test('imports legacy ledger rows only once', async () => {
        const brainPath = testPath('brain-legacy', 'sqlite');
        const legacyLedgerPath = testPath('legacy-ledger', 'crystal');
        const vector = vectorFor('legacy phase memory');

        await mkdir(path.dirname(legacyLedgerPath), { recursive: true });
        await writeFile(legacyLedgerPath, `${JSON.stringify({
            text: 'legacy phase memory',
            vector,
            sector: 4,
            amplitude: 0.9
        })}\n`);

        const firstProbe = await probeMemory('legacy phase memory', vector, { brainPath, legacyLedgerPath });
        expect(firstProbe.assembledContext).toContain('legacy phase memory');

        const atomsAfterFirstProbe = await getMemoryAtoms({ brainPath, legacyLedgerPath });
        const atomsAfterSecondProbe = await getMemoryAtoms({ brainPath, legacyLedgerPath });

        expect(atomsAfterFirstProbe).toHaveLength(1);
        expect(atomsAfterSecondProbe).toHaveLength(1);
    });
});
