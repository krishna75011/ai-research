const MAX_THOUGHT_LENGTH = 1000;
const MAX_WAVE_SAMPLES = 2048;

export type StreamMessage =
    | { kind: 'thought'; thought: string }
    | { kind: 'wave'; waveA: number[]; waveB: number[] };

export function sanitizeThought(value: string): string {
    return value.trim().slice(0, MAX_THOUGHT_LENGTH).replace(/[<>]/g, '');
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

function parseWaveArray(value: unknown): number[] | null {
    if (!Array.isArray(value) || value.length > MAX_WAVE_SAMPLES) return null;

    if (value.some((sample) => typeof sample !== 'number' || !Number.isFinite(sample))) return null;

    return value.map((sample) => sample as number);
}

export function parseStreamMessage(message: unknown): StreamMessage | null {
    const parsed = parseUnknownMessage(message);
    if (!parsed) return null;

    if (typeof parsed.thought === 'string') {
        const thought = sanitizeThought(parsed.thought);
        return thought ? { kind: 'thought', thought } : null;
    }

    const waveA = parseWaveArray(parsed.waveA);
    if (waveA) {
        if ('waveB' in parsed && parsed.waveB !== undefined) {
            const waveB = parseWaveArray(parsed.waveB);
            return waveB ? { kind: 'wave', waveA, waveB } : null;
        }

        const waveB = Array.from({ length: waveA.length }, () => 0);
        return { kind: 'wave', waveA, waveB };
    }

    return null;
}
