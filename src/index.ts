import { Elysia } from 'elysia';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
    containsOrchestrationArtifact,
    createWorkspace,
    exportWorkspace,
    getWorkspaceSnapshot,
    importFilesToMemory,
    importWorkspaceData,
    probeMemory,
    recordInteraction,
    updateMemoryFeedback,
    DEFAULT_WORKSPACE_ID,
    type FileImportFile,
    type MemoryFeedbackAction
} from './memoryBrain';
import { processWaveThought } from './localBrain';
import { textToWave } from './modulator';
import { parseStreamMessage } from './protocol';
import { simulateInterference, type WaveUnit } from './virtualCrystal';

const THOUGHT_THROTTLE_MS = 1500;
const DEFAULT_PORT = 3000;

if (!existsSync('logs')) {
    mkdirSync('logs', { recursive: true });
}

const PUBLIC_DIR = path.resolve('public');
const PORT = Number.isFinite(Number(process.env.PORT)) && Number(process.env.PORT) > 0
    ? Number(process.env.PORT)
    : DEFAULT_PORT;

const clientThrottles = new Map<string, number>();
const activeConnections = new Set<{ close(): void }>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWorkspaceId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createTextVector(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
    return simulateInterference(waveA, waveB);
}

function servePublicAsset(assetPath: string) {
    const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const resolved = path.resolve(PUBLIC_DIR, normalized);

    if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        return null;
    }

    return existsSync(resolved) ? Bun.file(resolved) : null;
}

async function recordAssistantMemory(
    response: string,
    workspaceId: string,
    sessionId: string,
    turnId: string,
    parentAtomId: number
) {
    if (containsOrchestrationArtifact(response)) {
        return;
    }

    await recordInteraction({
        contentText: response,
        waveSignature: createTextVector(response),
        sourceKind: 'assistant',
        modality: 'system_derived',
        workspaceId,
        sessionId,
        turnId,
        parentAtomId,
        salience: 0.78,
        confidence: 0.62,
        sourceType: 'conversation',
        sourceTitle: 'Conversation',
        rawPayload: {
            response
        }
    });
}

function parseImportFiles(body: unknown): { workspaceId?: string; files: FileImportFile[] } | null {
    if (!isRecord(body) || !Array.isArray(body.files)) return null;

    const workspaceId = getWorkspaceId(body.workspaceId);
    const files: FileImportFile[] = [];

    for (const file of body.files) {
        if (!isRecord(file) || typeof file.name !== 'string' || typeof file.content !== 'string') {
            return null;
        }

        files.push({
            name: file.name,
            content: file.content,
            relativePath: typeof file.relativePath === 'string' ? file.relativePath : null,
            sourceUri: typeof file.sourceUri === 'string' ? file.sourceUri : null,
            sourceTitle: typeof file.sourceTitle === 'string' ? file.sourceTitle : null,
            sourceHash: typeof file.sourceHash === 'string' ? file.sourceHash : null,
            lastModified: typeof file.lastModified === 'number' && Number.isFinite(file.lastModified) ? file.lastModified : null
        });
    }

    return { workspaceId, files };
}

const app = new Elysia()
    .onError(({ code, error }) => {
        if (code === 'NOT_FOUND') return;

        const timestamp = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';

        appendFileSync('logs/server.log', `[${timestamp}] ERROR ${code}: ${errorMessage}\n${errorStack}\n\n`);
        console.error(`Global error caught: ${errorMessage}`);
    })
    .get('/', () => Bun.file('public/index.html'))
    .get('/favicon.ico', () => Bun.file('public/favicon.ico'))
    .get('/public/*', ({ params, set }) => {
        const file = servePublicAsset(params['*']);
        if (!file) {
            set.status = 404;
            return 'NOT_FOUND';
        }

        return file;
    })
    .get('/api/bootstrap', async ({ query }) => {
        const workspaceId = getWorkspaceId(isRecord(query) ? query.workspaceId : undefined) ?? DEFAULT_WORKSPACE_ID;
        return {
            status: 'ok',
            snapshot: await getWorkspaceSnapshot({ workspaceId })
        };
    })
    .get('/api/workspaces/:id/export', async ({ params, set }) => {
        try {
            const data = await exportWorkspace(params.id);
            set.headers['Content-Disposition'] = `attachment; filename="workspace-${params.id}.json"`;
            set.headers['Content-Type'] = 'application/json';
            return data;
        } catch (err) {
            set.status = 404;
            return { status: 'error', message: 'Workspace not found or export failed.' };
        }
    })
    .post('/api/workspaces/import', async ({ body, set }) => {
        if (!isRecord(body) || !body.exportData) {
            set.status = 400;
            return { status: 'error', message: 'Missing exportData.' };
        }
        try {
            const workspace = await importWorkspaceData(body.exportData);
            return {
                status: 'ok',
                workspace,
                snapshot: await getWorkspaceSnapshot({ workspaceId: workspace.id })
            };
        } catch (err) {
            set.status = 500;
            return { status: 'error', message: err instanceof Error ? err.message : String(err) };
        }
    })
    .post('/api/workspaces', async ({ body, set }) => {
        if (!isRecord(body) || typeof body.name !== 'string' || !body.name.trim()) {
            set.status = 400;
            return { status: 'error', message: 'Workspace name is required.' };
        }

        const workspace = await createWorkspace(body.name);
        return {
            status: 'ok',
            workspace,
            snapshot: await getWorkspaceSnapshot({ workspaceId: workspace.id })
        };
    })
    .post('/api/import', async ({ body, set }) => {
        const parsed = parseImportFiles(body);
        if (!parsed) {
            set.status = 400;
            return { status: 'error', message: 'Invalid import payload.' };
        }

        const result = await importFilesToMemory(parsed.files, { workspaceId: parsed.workspaceId });
        return {
            status: 'ok',
            result,
            snapshot: await getWorkspaceSnapshot({ workspaceId: result.workspaceId })
        };
    })
    .post('/api/memory/feedback', async ({ body, set }) => {
        if (!isRecord(body) || typeof body.atomId !== 'number' || !Number.isFinite(body.atomId) || typeof body.action !== 'string') {
            set.status = 400;
            return { status: 'error', message: 'Invalid feedback payload.' };
        }

        const action = body.action as MemoryFeedbackAction;
        if (!['pin', 'exclude', 'mark_wrong', 'restore'].includes(action)) {
            set.status = 400;
            return { status: 'error', message: 'Unsupported feedback action.' };
        }

        const atom = await updateMemoryFeedback(body.atomId, action, { workspaceId: getWorkspaceId(body.workspaceId) });
        if (!atom) {
            set.status = 404;
            return { status: 'error', message: 'Memory atom not found.' };
        }

        return {
            status: 'ok',
            atom,
            snapshot: await getWorkspaceSnapshot({ workspaceId: atom.workspaceId })
        };
    })
    .ws('/stream', {
        open(ws) {
            activeConnections.add(ws);
            console.log('Client connected to Chronicle Memory stream');
        },
        close(ws) {
            activeConnections.delete(ws);
            clientThrottles.delete(ws.id);
        },
        async message(ws, message: unknown) {
            const start = performance.now();

            try {
                const parsedMessage = parseStreamMessage(message);
                if (!parsedMessage) {
                    ws.send({ status: 'error', message: 'Invalid stream payload.' });
                    return;
                }

                const workspaceId = parsedMessage.workspaceId ?? DEFAULT_WORKSPACE_ID;

                if (parsedMessage.kind === 'thought') {
                    const now = Date.now();
                    const lastThought = clientThrottles.get(ws.id) || 0;
                    if (now - lastThought < THOUGHT_THROTTLE_MS) {
                        ws.send({ status: 'error', message: 'Memory is still synchronizing. Wait a moment and try again.' });
                        return;
                    }
                    clientThrottles.set(ws.id, now);

                    const turnId = crypto.randomUUID();
                    const thoughtVector = createTextVector(parsedMessage.thought);
                    const memoryProbe = await probeMemory(parsedMessage.thought, thoughtVector, { workspaceId });

                    const userAtom = await recordInteraction({
                        contentText: parsedMessage.thought,
                        waveSignature: thoughtVector,
                        sourceKind: 'user',
                        modality: 'text',
                        workspaceId,
                        sessionId: ws.id,
                        turnId,
                        salience: 0.84,
                        confidence: 0.82,
                        sourceType: 'conversation',
                        sourceTitle: 'Conversation',
                        rawPayload: {
                            thought: parsedMessage.thought
                        }
                    });

                    const aiResult = await processWaveThought(parsedMessage.thought, memoryProbe.assembledContext, true, (token) => {
                        ws.send({
                            status: 'thought_stream',
                            workspaceId: memoryProbe.workspaceId,
                            chunk: token,
                            timestamp: Date.now()
                        });
                    });
                    await recordAssistantMemory(aiResult.finalResponse, memoryProbe.workspaceId, ws.id, turnId, userAtom.id);

                    const latencyMs = (performance.now() - start).toFixed(2);

                    ws.send({
                        status: 'thought_processed',
                        workspaceId: memoryProbe.workspaceId,
                        response: aiResult.finalResponse,
                        modelOutputs: {
                            qwen: aiResult.qwenOutput,
                            gemma: aiResult.gemmaOutput,
                            final: aiResult.finalResponse
                        },
                        vector: thoughtVector,
                        memoryActive: memoryProbe.citations.length > 0,
                        context: memoryProbe.assembledContext,
                        memoryCitations: memoryProbe.citations,
                        evidenceGroups: memoryProbe.evidenceGroups,
                        memoryMode: memoryProbe.memoryMode,
                        branchWarnings: memoryProbe.branchWarnings,
                        latencyMs,
                        timestamp: Date.now()
                    });

                    return;
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error('Memory stream error:', errorMessage);
                ws.send({ status: 'error', message: `Memory stream error: ${errorMessage}` });
            }
        }
    });

let server: ReturnType<typeof app.listen> | null = null;

if (import.meta.main) {
    server = app.listen(PORT);

    process.on('SIGINT', () => {
        console.log('\nChronicle Memory powering down.');
        for (const ws of activeConnections) {
            ws.close();
        }
        setTimeout(() => process.exit(0), 500);
    });

    console.log(`\nChronicle Memory server is running at http://localhost:${PORT}`);
    console.log(`Stream endpoint: ws://localhost:${PORT}/stream`);
}

export { app, server };
