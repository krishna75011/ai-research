const MAX_THOUGHT_LENGTH = 1000;
const MAX_WORKSPACE_ID_LENGTH = 120;

export type StreamMessage = { kind: 'thought'; thought: string; workspaceId?: string };

export function sanitizeThought(value: string): string {
    return value
        .trim()
        .slice(0, MAX_THOUGHT_LENGTH)
        .replace(/[<>]/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function sanitizeWorkspaceId(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const sanitized = value.trim().slice(0, MAX_WORKSPACE_ID_LENGTH);
    return sanitized || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUnknownMessage(message: unknown): Record<string, unknown> | null {
    if (typeof message === 'string') {
        try {
            const parsed = JSON.parse(message) as unknown;
            return isPlainObject(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    return isPlainObject(message) ? message : null;
}

export function parseStreamMessage(message: unknown): StreamMessage | null {
    const parsed = parseUnknownMessage(message);
    if (!parsed) return null;

    const workspaceId = sanitizeWorkspaceId(parsed.workspaceId);

    if (typeof parsed.thought === 'string') {
        const thought = sanitizeThought(parsed.thought);
        return thought ? { kind: 'thought', thought, workspaceId } : null;
    }

    return null;
}
