import path from 'node:path';
import {
    getMemoryAtoms,
    MEMORY_MODE,
    probeMemory,
    recordInteraction,
    type MemoryBrainOptions
} from './memoryBrain';
import { calculateSector, cosineSimilarity } from './waveMath';
import type { WaveUnit } from './virtualCrystal';

export type { WaveUnit };
export { calculateSector, cosineSimilarity, MEMORY_MODE };

const DEFAULT_LEGACY_LEDGER_PATH = path.join('logs', 'matrix.crystal');

export interface LedgerOptions extends MemoryBrainOptions {
    ledgerPath?: string;
}

function toMemoryOptions(options: LedgerOptions = {}): MemoryBrainOptions {
    return {
        brainPath: options.brainPath,
        legacyLedgerPath: options.legacyLedgerPath ?? options.ledgerPath
    };
}

export function getLedgerPath(options: LedgerOptions = {}): string {
    return path.resolve(options.ledgerPath ?? process.env.MATRIX_LEDGER_PATH ?? process.env.LEDGER_PATH ?? DEFAULT_LEGACY_LEDGER_PATH);
}

/**
 * Legacy compatibility wrapper. New writes go into the memory brain as immutable atoms.
 */
export async function saveThoughtWave(text: string, vector: WaveUnit[], options: LedgerOptions = {}) {
    await recordInteraction({
        contentText: text,
        waveSignature: vector,
        sourceKind: 'user',
        modality: 'text',
        rawPayload: {
            text,
            vector,
            sector: calculateSector(vector)
        }
    }, toMemoryOptions(options));
}

/**
 * Legacy compatibility wrapper. The new memory brain returns an evidence-backed context block.
 */
export async function recallResonance(signalVector: WaveUnit[], options: LedgerOptions = {}): Promise<string | null> {
    const result = await probeMemory('', signalVector, toMemoryOptions(options));
    return result.assembledContext;
}

/**
 * Entropy is intentionally disabled in the new architecture. Raw memory is append-only.
 */
export async function triggerEntropy(_options: LedgerOptions = {}) {
    return {
        memoryMode: MEMORY_MODE,
        atoms: (await getMemoryAtoms(toMemoryOptions(_options))).length
    };
}
