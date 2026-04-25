import { createReadStream, existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as readline from 'node:readline';

const LEGACY_LEDGER_PATH = 'matrix.crystal';
const DEFAULT_LEDGER_PATH = path.join('logs', 'matrix.crystal');
const RECALL_THRESHOLD = 0.72;
const SYNTHESIS_LABELS = ['Alpha', 'Beta'] as const;

export interface WaveUnit {
    re: number;
    im: number;
}

export interface ResonanceRecord {
    text: string;
    vector: WaveUnit[];
    sector: number;
    amplitude: number;
}

export interface LedgerOptions {
    ledgerPath?: string;
}

type LedgerLine =
    | { raw: string; record: ResonanceRecord }
    | { raw: string; record: null };

interface MemoryCandidate {
    index: number;
    record: ResonanceRecord;
    similarity: number;
    weightedSimilarity: number;
}

let ledgerQueue = Promise.resolve();

export function getLedgerPath(options: LedgerOptions = {}): string {
    return options.ledgerPath ?? process.env.MATRIX_LEDGER_PATH ?? process.env.LEDGER_PATH ?? DEFAULT_LEDGER_PATH;
}

function withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = ledgerQueue.then(operation, operation);
    ledgerQueue = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

async function ensureLedgerReady(ledgerPath: string, migrateLegacy: boolean) {
    const ledgerDir = path.dirname(ledgerPath);
    if (ledgerDir && ledgerDir !== '.') {
        await mkdir(ledgerDir, { recursive: true });
    }

    const shouldMigrateLegacy =
        migrateLegacy &&
        path.resolve(ledgerPath) !== path.resolve(LEGACY_LEDGER_PATH) &&
        existsSync(LEGACY_LEDGER_PATH) &&
        !existsSync(ledgerPath);

    if (shouldMigrateLegacy) {
        await copyFile(LEGACY_LEDGER_PATH, ledgerPath);
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function parseWaveUnit(value: unknown): WaveUnit | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<WaveUnit>;
    if (!isFiniteNumber(candidate.re) || !isFiniteNumber(candidate.im)) return null;

    return { re: candidate.re, im: candidate.im };
}

function parseResonanceRecord(line: string): ResonanceRecord | null {
    try {
        const parsed = JSON.parse(line) as Partial<ResonanceRecord>;

        if (typeof parsed.text !== 'string') return null;
        if (!Array.isArray(parsed.vector)) return null;

        const vector: WaveUnit[] = [];
        for (const item of parsed.vector) {
            const unit = parseWaveUnit(item);
            if (!unit) return null;
            vector.push(unit);
        }

        const sector = isFiniteNumber(parsed.sector) ? Math.trunc(parsed.sector) : calculateSector(vector);
        const amplitude = isFiniteNumber(parsed.amplitude) ? Math.max(0, parsed.amplitude) : 1;

        return {
            text: parsed.text,
            vector,
            sector: Math.max(1, Math.min(10, sector || 1)),
            amplitude
        };
    } catch {
        return null;
    }
}

function circularSectorDistance(a: number, b: number): number {
    const distance = Math.abs(a - b);
    return Math.min(distance, 10 - distance);
}

function getTopResonantSectors(baseSector: number, signalVector: WaveUnit[], rows: LedgerLine[]): number[] {
    const sectorScores = new Map<number, number>();

    for (const row of rows) {
        if (!row.record) continue;

        const distance = circularSectorDistance(baseSector, row.record.sector);
        const baseAffinity = 1 - distance / 5;
        const similarity = cosineSimilarity(signalVector, row.record.vector);
        const weightedScore = similarity * Math.max(0, row.record.amplitude) * (0.75 + Math.max(0, baseAffinity) * 0.25);
        const currentScore = sectorScores.get(row.record.sector) ?? -1;

        if (weightedScore > currentScore) {
            sectorScores.set(row.record.sector, weightedScore);
        }
    }

    return [...sectorScores.entries()]
        .sort(([sectorA, scoreA], [sectorB, scoreB]) => {
            if (scoreB !== scoreA) return scoreB - scoreA;
            return circularSectorDistance(baseSector, sectorA) - circularSectorDistance(baseSector, sectorB);
        })
        .slice(0, 2)
        .map(([sector]) => sector);
}

function formatSynthesizedMemory(matches: MemoryCandidate[]): string {
    return matches
        .map((match, index) => `[Synthesized Memory ${SYNTHESIS_LABELS[index]}]: ${match.record.text}`)
        .join('\n');
}

async function readLedgerLines(ledgerPath: string): Promise<LedgerLine[]> {
    if (!existsSync(ledgerPath)) return [];

    const fileStream = createReadStream(ledgerPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const rows: LedgerLine[] = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        rows.push({ raw: line, record: parseResonanceRecord(line) });
    }

    return rows;
}

async function rewriteLedger(ledgerPath: string, lines: string[]) {
    const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
    const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

    await writeFile(tempPath, content);
    await rename(tempPath, ledgerPath);
}

/**
 * Calculates a stable sector bucket for fast coarse filtering.
 */
export function calculateSector(vector: WaveUnit[]): number {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
        const v = vector[i]!;
        sum += (i + 1) * (Math.abs(v.re) * 17 + Math.abs(v.im) * 31);
    }

    const sector = Math.floor(sum * 1000) % 10;
    return sector + 1;
}

/**
 * Calculates cosine similarity across the real and imaginary vector components.
 */
export function cosineSimilarity(vecA: WaveUnit[], vecB: WaveUnit[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(vecA.length, vecB.length);

    for (let i = 0; i < len; i++) {
        const a = vecA[i]!;
        const b = vecB[i]!;

        dotProduct += a.re * b.re + a.im * b.im;
        normA += a.re * a.re + a.im * a.im;
        normB += b.re * b.re + b.im * b.im;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Saves a thought and its wave math to the ledger.
 */
export async function saveThoughtWave(text: string, vector: WaveUnit[], options: LedgerOptions = {}) {
    const ledgerPath = getLedgerPath(options);

    return withLedgerLock(async () => {
        await ensureLedgerReady(ledgerPath, options.ledgerPath === undefined && process.env.MATRIX_LEDGER_PATH === undefined && process.env.LEDGER_PATH === undefined);

        const record: ResonanceRecord = {
            text,
            vector,
            sector: calculateSector(vector),
            amplitude: 1
        };

        await appendFile(ledgerPath, `${JSON.stringify(record)}\n`);
    });
}

/**
 * Recalls resonance context based on signal vector.
 */
export async function recallResonance(signalVector: WaveUnit[], options: LedgerOptions = {}): Promise<string | null> {
    const ledgerPath = getLedgerPath(options);

    return withLedgerLock(async () => {
        await ensureLedgerReady(ledgerPath, options.ledgerPath === undefined && process.env.MATRIX_LEDGER_PATH === undefined && process.env.LEDGER_PATH === undefined);
        if (!existsSync(ledgerPath)) return null;

        const baseSector = calculateSector(signalVector);
        const rows = await readLedgerLines(ledgerPath);
        const topSectors = getTopResonantSectors(baseSector, signalVector, rows);
        const topSectorSet = new Set(topSectors);

        if (topSectorSet.size === 0) return null;

        const candidates: MemoryCandidate[] = [];

        for (let i = 0; i < rows.length; i++) {
            const record = rows[i]!.record;
            if (!record) continue;
            if (!topSectorSet.has(record.sector)) continue;

            const similarity = cosineSimilarity(signalVector, record.vector);
            candidates.push({
                index: i,
                record,
                similarity,
                weightedSimilarity: similarity * record.amplitude
            });
        }

        const matches = candidates
            .filter((candidate) => candidate.weightedSimilarity >= RECALL_THRESHOLD)
            .sort((a, b) => {
                if (b.weightedSimilarity !== a.weightedSimilarity) {
                    return b.weightedSimilarity - a.weightedSimilarity;
                }

                return b.similarity - a.similarity;
            })
            .slice(0, 2);

        if (matches.length === 0) return null;

        const reIlluminatedIndexes = new Set(matches.map((match) => match.index));

        const updatedRows = rows.map((row, index) => {
            if (!reIlluminatedIndexes.has(index) || !row.record) return row.raw;
            return JSON.stringify({ ...row.record, amplitude: 1 });
        });

        await rewriteLedger(ledgerPath, updatedRows);
        return formatSynthesizedMemory(matches);
    });
}

/**
 * Subtracts amplitude from stored waves and removes exhausted entries.
 */
export async function triggerEntropy(options: LedgerOptions = {}) {
    const ledgerPath = getLedgerPath(options);

    return withLedgerLock(async () => {
        await ensureLedgerReady(ledgerPath, options.ledgerPath === undefined && process.env.MATRIX_LEDGER_PATH === undefined && process.env.LEDGER_PATH === undefined);
        if (!existsSync(ledgerPath)) return;

        console.log('Triggering entropy across the resonance ledger...');

        const rows = await readLedgerLines(ledgerPath);
        const updatedRows: string[] = [];

        for (const row of rows) {
            if (!row.record) {
                updatedRows.push(row.raw);
                continue;
            }

            const nextAmplitude = Math.max(0, row.record.amplitude - 0.05);
            if (nextAmplitude > 0) {
                updatedRows.push(JSON.stringify({ ...row.record, amplitude: nextAmplitude }));
            }
        }

        await rewriteLedger(ledgerPath, updatedRows);
        console.log(`Entropy complete. ${updatedRows.length} memory vectors remain.`);
    });
}
