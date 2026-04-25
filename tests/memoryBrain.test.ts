import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    createWorkspace,
    containsOrchestrationArtifact,
    getEvidenceBranches,
    getMemoryAtoms,
    getStandingWaves,
    getWorkspaceSnapshot,
    importFilesToMemory,
    listImportedSources,
    probeMemory,
    recordInteraction,
    updateMemoryFeedback
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

    test('suppresses orchestration artifacts from recall context', async () => {
        const brainPath = testPath('brain-artifact', 'sqlite');
        const legacyLedgerPath = testPath('brain-artifact-legacy', 'crystal');
        const greeting = 'hi';
        const pollutedAssistant = 'Alpha Phase: "Hello! How can I assist you today?" Beta Phase: Acknowledged.';
        const comparativeAssistant = 'Gemma\'s response is more specific and relevant to the user\'s request than the Qwen response.';

        expect(containsOrchestrationArtifact(pollutedAssistant)).toBe(true);
        expect(containsOrchestrationArtifact(comparativeAssistant)).toBe(true);

        await recordInteraction({
            contentText: greeting,
            waveSignature: vectorFor(greeting),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: pollutedAssistant,
            waveSignature: vectorFor('Hello! How can I assist you today?'),
            sourceKind: 'assistant',
            modality: 'system_derived'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: comparativeAssistant,
            waveSignature: vectorFor('Hello! How can I assist you today?'),
            sourceKind: 'assistant',
            modality: 'system_derived'
        }, { brainPath, legacyLedgerPath });

        const probe = await probeMemory(greeting, vectorFor(greeting), { brainPath, legacyLedgerPath });

        expect(probe.assembledContext).toContain('hi');
        expect(probe.assembledContext).not.toContain('Alpha Phase');
        expect(probe.assembledContext).not.toContain('Beta Phase');
        expect(probe.assembledContext).not.toContain('Gemma\'s response');
    });

    test('isolates recall between workspaces', async () => {
        const brainPath = testPath('brain-workspace', 'sqlite');
        const legacyLedgerPath = testPath('brain-workspace-legacy', 'crystal');
        const personalMemory = 'Remember that the personal roadmap uses project alpha.';
        const projectMemory = 'Remember that workspace phoenix uses project beta.';
        const projectWorkspace = await createWorkspace('Phoenix', { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: personalMemory,
            waveSignature: vectorFor(personalMemory),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: projectMemory,
            waveSignature: vectorFor(projectMemory),
            sourceKind: 'user',
            modality: 'text',
            workspaceId: projectWorkspace.id
        }, { brainPath, legacyLedgerPath });

        const personalProbe = await probeMemory(
            'Which project does my personal roadmap use?',
            vectorFor('Which project does my personal roadmap use?'),
            { brainPath, legacyLedgerPath, workspaceId: 'personal' }
        );
        const projectProbe = await probeMemory(
            'Which project does workspace phoenix use?',
            vectorFor('Which project does workspace phoenix use?'),
            { brainPath, legacyLedgerPath, workspaceId: projectWorkspace.id }
        );

        expect(personalProbe.assembledContext).toContain(personalMemory);
        expect(personalProbe.assembledContext).not.toContain(projectMemory);
        expect(projectProbe.assembledContext).toContain(projectMemory);
        expect(projectProbe.assembledContext).not.toContain(personalMemory);

        const projectSnapshot = await getWorkspaceSnapshot({ brainPath, legacyLedgerPath, workspaceId: projectWorkspace.id });
        expect(projectSnapshot.workspace.name).toBe('Phoenix');
        expect(projectSnapshot.stats.totalMemories).toBeGreaterThanOrEqual(1);
    });

    test('keeps acoustic lab entries out of the main workspace feed and stats', async () => {
        const brainPath = testPath('brain-acoustic-feed', 'sqlite');
        const legacyLedgerPath = testPath('brain-acoustic-feed-legacy', 'crystal');
        const textPrompt = 'hi';
        const textReply = 'Hello! How can I assist you today?';
        const acousticSummary = '[Acoustic Uplink] frequency bins=256; dominant band=17; average phase=1.28 rad.';
        const acousticReply = 'Based solely on the provided acoustic signature metrics, this voice sounds active and dynamic.';

        const userAtom = await recordInteraction({
            contentText: textPrompt,
            waveSignature: vectorFor(textPrompt),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: textReply,
            waveSignature: vectorFor(textReply),
            sourceKind: 'assistant',
            modality: 'system_derived',
            parentAtomId: userAtom.id
        }, { brainPath, legacyLedgerPath });

        const acousticAtom = await recordInteraction({
            contentText: acousticSummary,
            waveSignature: vectorFor(acousticSummary),
            sourceKind: 'user',
            modality: 'acoustic_summary'
        }, { brainPath, legacyLedgerPath });

        await recordInteraction({
            contentText: acousticReply,
            waveSignature: vectorFor(acousticReply),
            sourceKind: 'assistant',
            modality: 'system_derived',
            parentAtomId: acousticAtom.id
        }, { brainPath, legacyLedgerPath });

        const snapshot = await getWorkspaceSnapshot({ brainPath, legacyLedgerPath });
        const visibleConversation = snapshot.recentConversation.map((atom) => atom.contentText);
        const visibleTimeline = snapshot.recentActivity.map((atom) => atom.contentText);

        expect(visibleConversation).toContain(textPrompt);
        expect(visibleConversation).toContain(textReply);
        expect(visibleConversation).not.toContain(acousticSummary);
        expect(visibleConversation).not.toContain(acousticReply);
        expect(visibleTimeline).not.toContain(acousticSummary);
        expect(visibleTimeline).not.toContain(acousticReply);
        expect(snapshot.stats.totalMemories).toBe(2);
        expect(snapshot.stats.conversationTurns).toBe(2);
    });

    test('keeps correct support atom ids on conflicting evidence branches', async () => {
        const brainPath = testPath('brain-branch-support', 'sqlite');
        const legacyLedgerPath = testPath('brain-branch-support-legacy', 'crystal');
        const first = 'I prefer local memory mode for long term alpha.';
        const second = 'I prefer local memory mode for long term beta.';

        const firstAtom = await recordInteraction({
            contentText: first,
            waveSignature: vectorFor(first),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        const secondAtom = await recordInteraction({
            contentText: second,
            waveSignature: vectorFor(second),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        const branches = await getEvidenceBranches({ brainPath, legacyLedgerPath });
        const alphaBranch = branches.find((branch) => branch.branchText.includes('alpha'));
        const betaBranch = branches.find((branch) => branch.branchText.includes('beta'));

        expect(alphaBranch).toBeDefined();
        expect(betaBranch).toBeDefined();
        expect(alphaBranch!.supportAtomIds).toEqual([firstAtom.id]);
        expect(betaBranch!.supportAtomIds).toEqual([secondAtom.id]);
    });

    test('imports file memory, skips identical re-imports, and supersedes older file chunks', async () => {
        const brainPath = testPath('brain-files', 'sqlite');
        const legacyLedgerPath = testPath('brain-files-legacy', 'crystal');
        const workspace = await createWorkspace('Files', { brainPath, legacyLedgerPath });

        const firstImport = await importFilesToMemory([{
            name: 'notes.md',
            relativePath: 'docs/notes.md',
            content: 'Decision: ship the memory console with file-backed recall and evidence citations.'
        }], { brainPath, legacyLedgerPath, workspaceId: workspace.id });

        expect(firstImport.importedFiles).toBe(1);
        expect(firstImport.skippedFiles).toBe(0);
        expect(firstImport.importedAtoms).toBeGreaterThan(0);

        const identicalImport = await importFilesToMemory([{
            name: 'notes.md',
            relativePath: 'docs/notes.md',
            content: 'Decision: ship the memory console with file-backed recall and evidence citations.'
        }], { brainPath, legacyLedgerPath, workspaceId: workspace.id });

        expect(identicalImport.importedFiles).toBe(0);
        expect(identicalImport.skippedFiles).toBe(1);

        const updatedImport = await importFilesToMemory([{
            name: 'notes.md',
            relativePath: 'docs/notes.md',
            content: 'Decision: ship the memory console with file-backed recall, evidence citations, and workspace isolation.'
        }], { brainPath, legacyLedgerPath, workspaceId: workspace.id });

        expect(updatedImport.importedFiles).toBe(1);
        expect(updatedImport.sources).toHaveLength(1);

        const sources = await listImportedSources({ brainPath, legacyLedgerPath, workspaceId: workspace.id });
        expect(sources).toHaveLength(1);
        expect(sources[0]!.sourceUri).toContain('docs/notes.md');

        const probe = await probeMemory(
            'What did the imported notes decide to ship?',
            vectorFor('What did the imported notes decide to ship?'),
            { brainPath, legacyLedgerPath, workspaceId: workspace.id }
        );

        expect(probe.evidenceGroups.files.length).toBeGreaterThan(0);
        expect(probe.assembledContext).toContain('workspace isolation');
    });

    test('supports pin, exclude, restore, and mark wrong feedback actions', async () => {
        const brainPath = testPath('brain-feedback', 'sqlite');
        const legacyLedgerPath = testPath('brain-feedback-legacy', 'crystal');
        const memory = 'Remember that I want evidence-first answers with citations.';

        const atom = await recordInteraction({
            contentText: memory,
            waveSignature: vectorFor(memory),
            sourceKind: 'user',
            modality: 'text'
        }, { brainPath, legacyLedgerPath });

        const pinned = await updateMemoryFeedback(atom.id, 'pin', { brainPath, legacyLedgerPath });
        expect(pinned?.isPinned).toBe(true);

        const excluded = await updateMemoryFeedback(atom.id, 'exclude', { brainPath, legacyLedgerPath });
        expect(excluded?.recallState).toBe('excluded');

        const excludedProbe = await probeMemory(memory, vectorFor(memory), { brainPath, legacyLedgerPath });
        expect(excludedProbe.assembledContext ?? '').not.toContain(memory);

        const restored = await updateMemoryFeedback(atom.id, 'restore', { brainPath, legacyLedgerPath });
        expect(restored?.recallState).toBe('active');
        expect(restored?.correctionState).toBe('none');

        const restoredProbe = await probeMemory(memory, vectorFor(memory), { brainPath, legacyLedgerPath });
        expect(restoredProbe.assembledContext).toContain(memory);

        const markedWrong = await updateMemoryFeedback(atom.id, 'mark_wrong', { brainPath, legacyLedgerPath });
        expect(markedWrong?.recallState).toBe('excluded');
        expect(markedWrong?.correctionState).toBe('incorrect');
    });
});
