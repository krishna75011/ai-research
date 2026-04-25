import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { app } from '../src/index';

function testPath(name: string, extension: string): string {
    return path.join(process.cwd(), 'logs', 'tests', `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
}

const originalMemoryBrainPath = process.env.MEMORY_BRAIN_PATH;
const originalMatrixLedgerPath = process.env.MATRIX_LEDGER_PATH;

beforeEach(() => {
    process.env.MEMORY_BRAIN_PATH = testPath('app-brain', 'sqlite');
    process.env.MATRIX_LEDGER_PATH = testPath('app-ledger', 'crystal');
});

afterEach(() => {
    if (originalMemoryBrainPath === undefined) {
        delete process.env.MEMORY_BRAIN_PATH;
    } else {
        process.env.MEMORY_BRAIN_PATH = originalMemoryBrainPath;
    }

    if (originalMatrixLedgerPath === undefined) {
        delete process.env.MATRIX_LEDGER_PATH;
    } else {
        process.env.MATRIX_LEDGER_PATH = originalMatrixLedgerPath;
    }
});

describe('app http contract', () => {
    test('serves the dashboard and bootstrap snapshot', async () => {
        const rootResponse = await app.handle(new Request('http://localhost/'));
        expect(rootResponse.status).toBe(200);
        const rootHtml = await rootResponse.text();
        expect(rootHtml).toContain('<title>Chronicle Memory</title>');
        expect(rootHtml).not.toContain('Acoustic Lab');

        const bootstrapResponse = await app.handle(new Request('http://localhost/api/bootstrap?workspaceId=personal'));
        expect(bootstrapResponse.status).toBe(200);

        const bootstrap = await bootstrapResponse.json() as {
            status: string;
            snapshot: {
                workspaceId: string;
                workspace: { name: string };
                workspaces: Array<{ id: string }>;
            };
        };

        expect(bootstrap.status).toBe('ok');
        expect(bootstrap.snapshot.workspaceId).toBe('personal');
        expect(bootstrap.snapshot.workspace.name).toBe('Personal');
        expect(bootstrap.snapshot.workspaces.some((workspace) => workspace.id === 'personal')).toBe(true);
    });

    test('creates workspaces through the product api', async () => {
        const response = await app.handle(new Request('http://localhost/api/workspaces', {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({ name: 'Project Atlas' })
        }));

        expect(response.status).toBe(200);

        const payload = await response.json() as {
            status: string;
            workspace: { name: string; id: string };
            snapshot: { workspaceId: string };
        };

        expect(payload.status).toBe('ok');
        expect(payload.workspace.name).toBe('Project Atlas');
        expect(payload.snapshot.workspaceId).toBe(payload.workspace.id);
    });

    test('serves static assets from /public', async () => {
        const response = await app.handle(new Request('http://localhost/public/three.module.js'));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('javascript');
    });
});
