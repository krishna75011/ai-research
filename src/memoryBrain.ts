import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { calculateSector, cosineSimilarity } from './waveMath';
import type { WaveUnit } from './virtualCrystal';

export const MEMORY_MODE = 'chrono-resonant-memory-brain';

const DEFAULT_MEMORY_BRAIN_PATH = path.join('logs', 'memory-brain.sqlite');
const DEFAULT_LEGACY_LEDGER_PATH = path.join('logs', 'matrix.crystal');
const ROOT_LEGACY_LEDGER_PATH = 'matrix.crystal';
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'build', 'but', 'by', 'for', 'from', 'had', 'has',
    'have', 'here', 'how', 'into', 'its', 'just', 'not', 'now', 'our', 'that', 'the', 'their', 'them', 'then',
    'there', 'they', 'this', 'those', 'too', 'use', 'using', 'was', 'were', 'what', 'when', 'where', 'which',
    'with', 'would', 'your'
]);
const ORCHESTRATION_ARTIFACT_PATTERNS = [
    'Alpha Phase:',
    'Beta Phase:',
    '[Alpha Phase]',
    '[Beta Phase]',
    '[Qwen Output]',
    '[Gemma Output]',
    'Qwen Output:',
    'Gemma Output:'
] as const;

export type MemoryModality = 'text' | 'acoustic_summary' | 'system_derived' | 'legacy_import';
export type MemorySourceKind = 'user' | 'assistant' | 'system' | 'legacy_ledger';

export interface MemoryBrainOptions {
    brainPath?: string;
    legacyLedgerPath?: string;
}

export interface RecordInteractionInput {
    contentText: string;
    waveSignature: WaveUnit[];
    sourceKind: MemorySourceKind;
    modality: MemoryModality;
    sessionId?: string | null;
    turnId?: string | null;
    rawPayload?: unknown;
    salience?: number;
    confidence?: number;
    parentAtomId?: number | null;
    legacyOrigin?: string | null;
    createdAt?: string;
}

export interface MemoryAtom {
    id: number;
    createdAt: string;
    sourceKind: MemorySourceKind;
    sessionId: string | null;
    turnId: string | null;
    contentText: string;
    rawPayloadJson: string | null;
    waveSignature: WaveUnit[];
    salience: number;
    confidence: number;
    modality: MemoryModality;
    parentAtomId: number | null;
    legacyOrigin: string | null;
    topicKey: string | null;
    entityKeys: string[];
}

export interface StandingWave {
    id: number;
    kind: string;
    topicKey: string;
    canonicalText: string;
    supportCount: number;
    lastReinforcedAt: string;
    stability: number;
    confidence: number;
    entityKeys: string[];
    sourceAtomIds: number[];
}

export interface EvidenceBranch {
    id: number;
    kind: string;
    topicKey: string;
    branchText: string;
    status: string;
    confidence: number;
    firstSeenAt: string;
    lastSeenAt: string;
    supportAtomIds: number[];
}

export interface MemoryCitation {
    kind: 'atom' | 'standing_wave' | 'branch';
    id: number;
    createdAt: string;
    excerpt: string;
    score: number;
    topicKey?: string | null;
}

export interface ProbeResult {
    queryText: string;
    queryWaveSignature: WaveUnit[];
    matchedAtomIds: number[];
    matchedStandingWaveIds: number[];
    matchedBranchIds: number[];
    assembledContext: string | null;
    citations: MemoryCitation[];
    branchWarnings: string[];
    memoryMode: string;
}

interface DerivedMemory {
    kind: string;
    topicKey: string;
    canonicalText: string;
    confidence: number;
    entityKeys: string[];
}

interface TimeAnchor {
    preferredYear: number | null;
    prefersPast: boolean;
}

type AtomRow = {
    id: number;
    created_at: string;
    source_kind: MemorySourceKind;
    session_id: string | null;
    turn_id: string | null;
    content_text: string;
    raw_payload_json: string | null;
    wave_signature_json: string;
    salience: number;
    confidence: number;
    modality: MemoryModality;
    parent_atom_id: number | null;
    legacy_origin: string | null;
    topic_key: string | null;
    entity_keys_json: string;
};

type StandingWaveRow = {
    id: number;
    kind: string;
    topic_key: string;
    canonical_text: string;
    support_count: number;
    last_reinforced_at: string;
    stability: number;
    confidence: number;
    entity_keys_json: string;
    source_atom_ids_json: string;
};

type EvidenceBranchRow = {
    id: number;
    kind: string;
    topic_key: string;
    branch_text: string;
    status: string;
    confidence: number;
    first_seen_at: string;
    last_seen_at: string;
    support_atom_ids_json: string;
};

interface LegacyLedgerRecord {
    text: string;
    vector: WaveUnit[];
    sector?: number;
    amplitude?: number;
}

const databases = new Map<string, Database>();

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function serializeJson(value: unknown): string | null {
    if (value === undefined) return null;
    return JSON.stringify(value);
}

function parseStringArray(value: string | null | undefined): string[] {
    if (!value) return [];

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
        return [];
    }
}

function parseNumberArray(value: string | null | undefined): number[] {
    if (!value) return [];

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
    } catch {
        return [];
    }
}

function parseWaveSignature(value: string): WaveUnit[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const candidate = item as Partial<WaveUnit>;
            const re = candidate.re;
            const im = candidate.im;
            if (typeof re !== 'number' || !Number.isFinite(re) || typeof im !== 'number' || !Number.isFinite(im)) return [];
            return [{ re, im }];
        });
    } catch {
        return [];
    }
}

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function containsOrchestrationArtifact(text: string): boolean {
    return ORCHESTRATION_ARTIFACT_PATTERNS.some((pattern) => text.includes(pattern));
}

function normalizeText(text: string): string {
    return normalizeWhitespace(text.toLowerCase().replace(/[^a-z0-9_:/\\.\-\s]/g, ' '));
}

function tokenize(text: string): string[] {
    const tokens = normalizeText(text)
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

    return [...new Set(tokens)];
}

function extractEntityKeys(text: string): string[] {
    const entities = new Set<string>();
    const normalized = normalizeText(text);

    for (const match of text.match(/[A-Za-z]:\\[^\s"'`]+|(?:\.{1,2}\/|\/)[^\s"'`]+/g) ?? []) {
        entities.add(match.toLowerCase());
    }

    for (const match of text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []) {
        entities.add(match.toLowerCase());
    }

    for (const match of text.match(/\b20\d{2}\b/g) ?? []) {
        entities.add(match);
    }

    for (const phrase of ['virtual crystal', 'acoustic uplink', 'memory brain', 'qwen', 'gemma', 'sqlite', 'llm', 'llms']) {
        if (normalized.includes(phrase)) {
            entities.add(phrase.replace(/\s+/g, '-'));
        }
    }

    for (const token of tokenize(text).slice(0, 12)) {
        entities.add(token);
    }

    return [...entities].slice(0, 16);
}

function buildTopicKey(kind: string, text: string): string {
    const signature = extractEntityKeys(text).slice(0, 5);
    return `${kind}:${signature.join('|') || 'general'}`;
}

function splitSentences(text: string): string[] {
    return text
        .split(/[\n\r]+|(?<=[.!?])\s+/)
        .map(normalizeWhitespace)
        .filter(Boolean);
}

function extractAcousticMemory(text: string): DerivedMemory[] {
    const phaseSpread = Number(text.match(/phase spread=([0-9.]+)/i)?.[1] ?? '0');
    const activeBands = Number(text.match(/active bands=([0-9.]+)/i)?.[1] ?? '0');
    const peakMagnitude = Number(text.match(/peak interference magnitude=([0-9.]+)/i)?.[1] ?? '0');

    const descriptors: string[] = [];
    descriptors.push(phaseSpread >= 1.6 ? 'volatile' : phaseSpread >= 0.9 ? 'dynamic' : 'steady');
    descriptors.push(activeBands >= 100 ? 'dense-spectrum' : activeBands >= 40 ? 'mid-spectrum' : 'focused-spectrum');
    descriptors.push(peakMagnitude >= 1.8 ? 'high-intensity' : peakMagnitude >= 1.1 ? 'moderate-intensity' : 'low-intensity');

    const canonicalText = `acoustic tone: ${descriptors.join(', ')}`;
    return [{
        kind: 'acoustic_tone',
        topicKey: 'acoustic_tone',
        canonicalText,
        confidence: 0.35,
        entityKeys: descriptors
    }];
}

function extractDerivedMemories(atom: MemoryAtom): DerivedMemory[] {
    if (atom.modality === 'acoustic_summary') {
        return extractAcousticMemory(atom.contentText);
    }

    if (atom.sourceKind === 'assistant') {
        return [];
    }

    const candidates = new Map<string, DerivedMemory>();
    const sentences = splitSentences(atom.contentText);

    const rules = [
        { kind: 'preference', pattern: /\b(i prefer|prefer|do not use|don't use|avoid)\b/i, confidence: 0.78 },
        { kind: 'goal', pattern: /\b(i want|we want|i need|goal)\b/i, confidence: 0.75 },
        { kind: 'decision', pattern: /\b(we decided|decision|decided to)\b/i, confidence: 0.86 },
        { kind: 'task', pattern: /\b(todo|next step|follow up|open task)\b/i, confidence: 0.72 },
        { kind: 'fact', pattern: /\b(remember that|note that|important)\b/i, confidence: 0.7 }
    ];

    for (const sentence of sentences) {
        for (const rule of rules) {
            if (!rule.pattern.test(sentence)) continue;

            const canonicalText = normalizeWhitespace(sentence);
            const derived: DerivedMemory = {
                kind: rule.kind,
                topicKey: buildTopicKey(rule.kind, canonicalText),
                canonicalText,
                confidence: rule.confidence,
                entityKeys: extractEntityKeys(canonicalText)
            };

            candidates.set(`${derived.kind}:${derived.canonicalText.toLowerCase()}`, derived);
        }
    }

    return [...candidates.values()];
}

function overlapScore(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) return 0;
    const rightSet = new Set(right);
    let matches = 0;

    for (const token of left) {
        if (rightSet.has(token)) matches += 1;
    }

    return matches / Math.max(left.length, right.length, 1);
}

function inferTimeAnchor(queryText: string): TimeAnchor {
    const normalized = normalizeText(queryText);
    const yearMatch = normalized.match(/\b(20\d{2})\b/);
    if (yearMatch) {
        return {
            preferredYear: Number(yearMatch[1]),
            prefersPast: true
        };
    }

    if (normalized.includes('last year')) {
        return {
            preferredYear: new Date().getFullYear() - 1,
            prefersPast: true
        };
    }

    return {
        preferredYear: null,
        prefersPast: /\b(previously|earlier|before|discussed previously|last time)\b/.test(normalized)
    };
}

function timeScore(createdAt: string, timeAnchor: TimeAnchor): number {
    if (!timeAnchor.preferredYear && !timeAnchor.prefersPast) return 0;

    const atomDate = new Date(createdAt);
    if (Number.isNaN(atomDate.getTime())) return 0;

    if (timeAnchor.preferredYear !== null) {
        return atomDate.getUTCFullYear() === timeAnchor.preferredYear ? 1 : 0;
    }

    const ageDays = Math.max(0, (Date.now() - atomDate.getTime()) / (1000 * 60 * 60 * 24));
    return clamp(ageDays / 365, 0, 1);
}

function computeStability(supportCount: number): number {
    return clamp(0.35 + Math.log2(supportCount + 1) * 0.2, 0.35, 1);
}

function mapAtom(row: AtomRow): MemoryAtom {
    return {
        id: row.id,
        createdAt: row.created_at,
        sourceKind: row.source_kind,
        sessionId: row.session_id,
        turnId: row.turn_id,
        contentText: row.content_text,
        rawPayloadJson: row.raw_payload_json,
        waveSignature: parseWaveSignature(row.wave_signature_json),
        salience: row.salience,
        confidence: row.confidence,
        modality: row.modality,
        parentAtomId: row.parent_atom_id,
        legacyOrigin: row.legacy_origin,
        topicKey: row.topic_key,
        entityKeys: parseStringArray(row.entity_keys_json)
    };
}

function mapStandingWave(row: StandingWaveRow): StandingWave {
    return {
        id: row.id,
        kind: row.kind,
        topicKey: row.topic_key,
        canonicalText: row.canonical_text,
        supportCount: row.support_count,
        lastReinforcedAt: row.last_reinforced_at,
        stability: row.stability,
        confidence: row.confidence,
        entityKeys: parseStringArray(row.entity_keys_json),
        sourceAtomIds: parseNumberArray(row.source_atom_ids_json)
    };
}

function mapEvidenceBranch(row: EvidenceBranchRow): EvidenceBranch {
    return {
        id: row.id,
        kind: row.kind,
        topicKey: row.topic_key,
        branchText: row.branch_text,
        status: row.status,
        confidence: row.confidence,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        supportAtomIds: parseNumberArray(row.support_atom_ids_json)
    };
}

function shouldSuppressAtomFromRecall(atom: MemoryAtom): boolean {
    return atom.sourceKind === 'assistant' && containsOrchestrationArtifact(atom.contentText);
}

function getMemoryBrainPath(options: MemoryBrainOptions = {}): string {
    return path.resolve(options.brainPath ?? process.env.MEMORY_BRAIN_PATH ?? DEFAULT_MEMORY_BRAIN_PATH);
}

function getLegacyLedgerCandidates(options: MemoryBrainOptions = {}): string[] {
    if (options.legacyLedgerPath) {
        return [path.resolve(options.legacyLedgerPath)];
    }

    const candidates = [
        process.env.MATRIX_LEDGER_PATH,
        process.env.LEDGER_PATH,
        ROOT_LEGACY_LEDGER_PATH,
        DEFAULT_LEGACY_LEDGER_PATH
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function ensureSchema(db: Database) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_atoms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            session_id TEXT,
            turn_id TEXT,
            content_text TEXT NOT NULL,
            raw_payload_json TEXT,
            wave_signature_json TEXT NOT NULL,
            salience REAL NOT NULL,
            confidence REAL NOT NULL,
            modality TEXT NOT NULL,
            parent_atom_id INTEGER,
            legacy_origin TEXT,
            topic_key TEXT,
            entity_keys_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_memory_atoms_created_at ON memory_atoms(created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_turn_id ON memory_atoms(turn_id);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_session_id ON memory_atoms(session_id);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_topic_key ON memory_atoms(topic_key);

        CREATE TABLE IF NOT EXISTS standing_waves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            topic_key TEXT NOT NULL,
            canonical_text TEXT NOT NULL,
            support_count INTEGER NOT NULL,
            last_reinforced_at TEXT NOT NULL,
            stability REAL NOT NULL,
            confidence REAL NOT NULL,
            entity_keys_json TEXT NOT NULL DEFAULT '[]',
            source_atom_ids_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_standing_wave_unique
            ON standing_waves(kind, topic_key, canonical_text);

        CREATE TABLE IF NOT EXISTS evidence_branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            topic_key TEXT NOT NULL,
            branch_text TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence REAL NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            support_atom_ids_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_unique
            ON evidence_branches(kind, topic_key, branch_text);
    `);
}

function getMeta(db: Database, key: string): string | null {
    const row = db.query('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | null;
    return row?.value ?? null;
}

function setMeta(db: Database, key: string, value: string) {
    db.query(`
        INSERT INTO meta(key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
}

function runMemoryMaintenance(db: Database) {
    const maintenanceKey = 'maintenance:purge-orchestration-artifacts:v1';
    if (getMeta(db, maintenanceKey)) return;

    db.query(`
        DELETE FROM memory_atoms
        WHERE source_kind = 'assistant'
          AND (
                content_text LIKE '%Alpha Phase:%'
             OR content_text LIKE '%Beta Phase:%'
             OR content_text LIKE '%[Alpha Phase]%'
             OR content_text LIKE '%[Beta Phase]%'
             OR content_text LIKE '%[Qwen Output]%'
             OR content_text LIKE '%[Gemma Output]%'
             OR content_text LIKE '%Qwen Output:%'
             OR content_text LIKE '%Gemma Output:%'
          )
    `).run();

    setMeta(db, maintenanceKey, new Date().toISOString());
}

function getDatabase(options: MemoryBrainOptions = {}): Database {
    const brainPath = getMemoryBrainPath(options);
    const existing = databases.get(brainPath);
    if (existing) return existing;

    mkdirSync(path.dirname(brainPath), { recursive: true });
    const db = new Database(brainPath, { create: true });
    ensureSchema(db);
    databases.set(brainPath, db);
    return db;
}

function parseLegacyRecord(line: string): LegacyLedgerRecord | null {
    try {
        const parsed = JSON.parse(line) as Partial<LegacyLedgerRecord>;
        if (typeof parsed.text !== 'string' || !Array.isArray(parsed.vector)) return null;

        const vector = parsed.vector.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const candidate = item as Partial<WaveUnit>;
            const re = candidate.re;
            const im = candidate.im;
            if (typeof re !== 'number' || !Number.isFinite(re) || typeof im !== 'number' || !Number.isFinite(im)) return [];
            return [{ re, im }];
        });

        if (vector.length === 0) return null;

        return {
            text: parsed.text,
            vector,
            sector: typeof parsed.sector === 'number' ? parsed.sector : undefined,
            amplitude: typeof parsed.amplitude === 'number' ? parsed.amplitude : undefined
        };
    } catch {
        return null;
    }
}

function insertAtomRow(db: Database, input: RecordInteractionInput): MemoryAtom {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const entityKeys = extractEntityKeys(input.contentText);
    const topicKey = entityKeys[0] ?? null;

    const result = db.query(`
        INSERT INTO memory_atoms (
            created_at,
            source_kind,
            session_id,
            turn_id,
            content_text,
            raw_payload_json,
            wave_signature_json,
            salience,
            confidence,
            modality,
            parent_atom_id,
            legacy_origin,
            topic_key,
            entity_keys_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        createdAt,
        input.sourceKind,
        input.sessionId ?? null,
        input.turnId ?? null,
        normalizeWhitespace(input.contentText),
        serializeJson(input.rawPayload),
        JSON.stringify(input.waveSignature),
        clamp(input.salience ?? 0.7, 0, 1),
        clamp(input.confidence ?? 0.7, 0, 1),
        input.modality,
        input.parentAtomId ?? null,
        input.legacyOrigin ?? null,
        topicKey,
        JSON.stringify(entityKeys)
    );

    const inserted = db.query('SELECT * FROM memory_atoms WHERE id = ?').get(Number(result.lastInsertRowid)) as AtomRow;
    return mapAtom(inserted);
}

function upsertStandingWave(db: Database, atom: MemoryAtom, derived: DerivedMemory): StandingWave {
    const existingRow = db.query(`
        SELECT * FROM standing_waves
        WHERE kind = ? AND topic_key = ? AND canonical_text = ?
    `).get(derived.kind, derived.topicKey, derived.canonicalText) as StandingWaveRow | null;

    if (!existingRow) {
        db.query(`
            INSERT INTO standing_waves (
                kind,
                topic_key,
                canonical_text,
                support_count,
                last_reinforced_at,
                stability,
                confidence,
                entity_keys_json,
                source_atom_ids_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            derived.kind,
            derived.topicKey,
            derived.canonicalText,
            1,
            atom.createdAt,
            computeStability(1),
            clamp(derived.confidence, 0, 1),
            JSON.stringify(derived.entityKeys),
            JSON.stringify([atom.id])
        );

        const inserted = db.query(`
            SELECT * FROM standing_waves
            WHERE kind = ? AND topic_key = ? AND canonical_text = ?
        `).get(derived.kind, derived.topicKey, derived.canonicalText) as StandingWaveRow;

        return mapStandingWave(inserted);
    }

    const sourceAtomIds = [...new Set([...parseNumberArray(existingRow.source_atom_ids_json), atom.id])];
    const supportCount = existingRow.support_count + 1;
    const stability = computeStability(supportCount);
    const confidence = clamp(Math.max(existingRow.confidence, derived.confidence), 0, 1);
    const entityKeys = [...new Set([...parseStringArray(existingRow.entity_keys_json), ...derived.entityKeys])];

    db.query(`
        UPDATE standing_waves
        SET support_count = ?,
            last_reinforced_at = ?,
            stability = ?,
            confidence = ?,
            entity_keys_json = ?,
            source_atom_ids_json = ?
        WHERE id = ?
    `).run(
        supportCount,
        atom.createdAt,
        stability,
        confidence,
        JSON.stringify(entityKeys),
        JSON.stringify(sourceAtomIds),
        existingRow.id
    );

    const updated = db.query('SELECT * FROM standing_waves WHERE id = ?').get(existingRow.id) as StandingWaveRow;
    return mapStandingWave(updated);
}

function upsertEvidenceBranch(db: Database, derived: DerivedMemory, atom: MemoryAtom) {
    const existingRow = db.query(`
        SELECT * FROM evidence_branches
        WHERE kind = ? AND topic_key = ? AND branch_text = ?
    `).get(derived.kind, derived.topicKey, derived.canonicalText) as EvidenceBranchRow | null;

    if (!existingRow) {
        db.query(`
            INSERT INTO evidence_branches (
                kind,
                topic_key,
                branch_text,
                status,
                confidence,
                first_seen_at,
                last_seen_at,
                support_atom_ids_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            derived.kind,
            derived.topicKey,
            derived.canonicalText,
            'active',
            derived.confidence,
            atom.createdAt,
            atom.createdAt,
            JSON.stringify([atom.id])
        );
        return;
    }

    const supportAtomIds = [...new Set([...parseNumberArray(existingRow.support_atom_ids_json), atom.id])];
    db.query(`
        UPDATE evidence_branches
        SET status = ?,
            confidence = ?,
            last_seen_at = ?,
            support_atom_ids_json = ?
        WHERE id = ?
    `).run(
        'active',
        clamp(Math.max(existingRow.confidence, derived.confidence), 0, 1),
        atom.createdAt,
        JSON.stringify(supportAtomIds),
        existingRow.id
    );
}

function reconcileBranches(db: Database, derived: DerivedMemory, atom: MemoryAtom) {
    if (derived.kind === 'acoustic_tone' || derived.kind === 'task') return;

    const rows = db.query(`
        SELECT * FROM standing_waves
        WHERE kind = ? AND topic_key = ?
    `).all(derived.kind, derived.topicKey) as StandingWaveRow[];

    const distinctTexts = [...new Set(rows.map((row) => row.canonical_text))];
    if (distinctTexts.length <= 1) return;

    for (const text of distinctTexts) {
        upsertEvidenceBranch(db, {
            ...derived,
            canonicalText: text
        }, atom);
    }
}

function consolidateAtomInternal(db: Database, atom: MemoryAtom) {
    const derivedMemories = extractDerivedMemories(atom);
    for (const derived of derivedMemories) {
        upsertStandingWave(db, atom, derived);
        reconcileBranches(db, derived, atom);
    }
}

function ensureLegacyImported(db: Database, options: MemoryBrainOptions = {}) {
    const brainPath = getMemoryBrainPath(options);
    const candidates = getLegacyLedgerCandidates(options).filter((candidate) => candidate !== brainPath);

    for (const legacyPath of candidates) {
        if (!existsSync(legacyPath)) continue;

        const markerKey = `legacy-import:${legacyPath}`;
        if (getMeta(db, markerKey)) continue;

        const content = readFileSync(legacyPath, 'utf8');
        const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const fallbackCreatedAt = statSync(legacyPath).mtime.toISOString();

        for (const line of lines) {
            const record = parseLegacyRecord(line);
            if (!record) continue;

            const atom = insertAtomRow(db, {
                contentText: record.text,
                waveSignature: record.vector,
                sourceKind: 'legacy_ledger',
                modality: 'legacy_import',
                salience: clamp(record.amplitude ?? 0.6, 0, 1),
                confidence: 0.55,
                rawPayload: {
                    ...record,
                    sector: record.sector ?? calculateSector(record.vector)
                },
                legacyOrigin: legacyPath,
                createdAt: fallbackCreatedAt
            });

            consolidateAtomInternal(db, atom);
        }

        setMeta(db, markerKey, new Date().toISOString());
    }
}

function prepareDatabase(options: MemoryBrainOptions = {}): Database {
    const db = getDatabase(options);
    runMemoryMaintenance(db);
    ensureLegacyImported(db, options);
    return db;
}

function getTimelineNeighbors(db: Database, atomId: number): MemoryAtom[] {
    const neighbors: MemoryAtom[] = [];

    const previous = db.query(`
        SELECT * FROM memory_atoms
        WHERE id < ?
        ORDER BY id DESC
        LIMIT 1
    `).get(atomId) as AtomRow | null;

    const next = db.query(`
        SELECT * FROM memory_atoms
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 1
    `).get(atomId) as AtomRow | null;

    if (previous) {
        const atom = mapAtom(previous);
        if (!shouldSuppressAtomFromRecall(atom)) {
            neighbors.push(atom);
        }
    }

    if (next) {
        const atom = mapAtom(next);
        if (!shouldSuppressAtomFromRecall(atom)) {
            neighbors.push(atom);
        }
    }

    return neighbors;
}

function rankAtoms(atoms: MemoryAtom[], queryText: string, queryWaveSignature: WaveUnit[]): Array<{ atom: MemoryAtom; score: number }> {
    const queryTokens = tokenize(queryText);
    const queryEntities = extractEntityKeys(queryText);
    const timeAnchor = inferTimeAnchor(queryText);

    return atoms
        .filter((atom) => !shouldSuppressAtomFromRecall(atom))
        .map((atom) => {
            const lexical = overlapScore(queryTokens, tokenize(atom.contentText));
            const entity = overlapScore(queryEntities, atom.entityKeys);
            const wave = cosineSimilarity(queryWaveSignature, atom.waveSignature);
            const time = timeScore(atom.createdAt, timeAnchor);
            const recencyPenalty = atom.sourceKind === 'assistant' ? -0.03 : 0;
            const score = lexical * 0.35 + entity * 0.2 + wave * 0.35 + time * 0.1 + recencyPenalty + atom.salience * 0.05;

            return { atom, score };
        })
        .filter(({ score }) => score > 0.08)
        .sort((left, right) => right.score - left.score);
}

function rankStandingWaves(waves: StandingWave[], queryText: string, queryWaveSignature: WaveUnit[]): Array<{ wave: StandingWave; score: number }> {
    const queryTokens = tokenize(queryText);
    const queryEntities = extractEntityKeys(queryText);

    return waves
        .map((wave) => {
            const lexical = overlapScore(queryTokens, tokenize(wave.canonicalText));
            const entity = overlapScore(queryEntities, wave.entityKeys);
            const waveHint = queryWaveSignature.length > 0 && wave.kind === 'acoustic_tone' ? 0.2 : 0;
            const support = clamp(wave.supportCount / 6, 0, 1);
            const score = lexical * 0.45 + entity * 0.25 + support * 0.15 + wave.stability * 0.15 + waveHint;

            return { wave, score };
        })
        .filter(({ score }) => score > 0.12)
        .sort((left, right) => right.score - left.score);
}

function rankBranches(branches: EvidenceBranch[], queryText: string): Array<{ branch: EvidenceBranch; score: number }> {
    const queryTokens = tokenize(queryText);
    const queryEntities = extractEntityKeys(queryText);

    return branches
        .map((branch) => {
            const lexical = overlapScore(queryTokens, tokenize(branch.branchText));
            const entity = overlapScore(queryEntities, extractEntityKeys(branch.branchText));
            const support = clamp(branch.supportAtomIds.length / 4, 0, 1);
            const score = lexical * 0.5 + entity * 0.25 + support * 0.15 + branch.confidence * 0.1;

            return { branch, score };
        })
        .filter(({ score }) => score > 0.12)
        .sort((left, right) => right.score - left.score);
}

function formatAtom(atom: MemoryAtom): string {
    return `- Atom #${atom.id} @ ${atom.createdAt} [${atom.sourceKind}/${atom.modality}]: ${atom.contentText}`;
}

function formatStandingWave(wave: StandingWave): string {
    return `- ${wave.kind} (support ${wave.supportCount}, stability ${wave.stability.toFixed(2)}): ${wave.canonicalText}`;
}

function formatBranchWarning(topicKey: string, branches: EvidenceBranch[]): string {
    return `- ${topicKey}: ${branches.map((branch) => branch.branchText).join(' | ')}`;
}

export async function recordInteraction(input: RecordInteractionInput, options: MemoryBrainOptions = {}): Promise<MemoryAtom> {
    const db = prepareDatabase(options);
    const atom = insertAtomRow(db, input);
    consolidateAtomInternal(db, atom);
    return atom;
}

export async function consolidateAtom(atomId: number, options: MemoryBrainOptions = {}) {
    const db = prepareDatabase(options);
    const row = db.query('SELECT * FROM memory_atoms WHERE id = ?').get(atomId) as AtomRow | null;
    if (!row) return;
    consolidateAtomInternal(db, mapAtom(row));
}

export async function probeMemory(queryText: string, queryWaveSignature: WaveUnit[], options: MemoryBrainOptions = {}): Promise<ProbeResult> {
    const db = prepareDatabase(options);
    const atomRows = db.query('SELECT * FROM memory_atoms ORDER BY id ASC').all() as AtomRow[];
    const standingWaveRows = db.query('SELECT * FROM standing_waves ORDER BY support_count DESC, id ASC').all() as StandingWaveRow[];
    const branchRows = db.query('SELECT * FROM evidence_branches ORDER BY id ASC').all() as EvidenceBranchRow[];

    const atoms = atomRows.map(mapAtom);
    const standingWaves = standingWaveRows.map(mapStandingWave);
    const branches = branchRows.map(mapEvidenceBranch);

    const topAtoms = rankAtoms(atoms, queryText, queryWaveSignature).slice(0, 4);
    const topStandingWaves = rankStandingWaves(standingWaves, queryText, queryWaveSignature).slice(0, 3);
    const topBranches = rankBranches(branches, queryText).slice(0, 4);

    const timelineAnchors = new Map<number, MemoryAtom>();
    for (const ranked of topAtoms.slice(0, 2)) {
        for (const neighbor of getTimelineNeighbors(db, ranked.atom.id)) {
            if (!topAtoms.some((candidate) => candidate.atom.id === neighbor.id)) {
                timelineAnchors.set(neighbor.id, neighbor);
            }
        }
    }

    const branchGroups = new Map<string, EvidenceBranch[]>();
    for (const ranked of topBranches) {
        const list = branchGroups.get(ranked.branch.topicKey) ?? [];
        list.push(ranked.branch);
        branchGroups.set(ranked.branch.topicKey, list);
    }

    const branchWarnings = [...branchGroups.entries()]
        .filter(([, grouped]) => grouped.length > 1)
        .map(([topicKey, grouped]) => formatBranchWarning(topicKey, grouped));

    const contextSections: string[] = [`[Memory Mode]: ${MEMORY_MODE}`];
    const citations: MemoryCitation[] = [];

    if (topAtoms.length > 0) {
        contextSections.push('[Evidence Recall]');
        for (const ranked of topAtoms) {
            contextSections.push(formatAtom(ranked.atom));
            citations.push({
                kind: 'atom',
                id: ranked.atom.id,
                createdAt: ranked.atom.createdAt,
                excerpt: ranked.atom.contentText,
                score: ranked.score,
                topicKey: ranked.atom.topicKey
            });
        }
    }

    if (timelineAnchors.size > 0) {
        contextSections.push('[Timeline Anchors]');
        for (const atom of timelineAnchors.values()) {
            contextSections.push(formatAtom(atom));
            citations.push({
                kind: 'atom',
                id: atom.id,
                createdAt: atom.createdAt,
                excerpt: atom.contentText,
                score: 0.2,
                topicKey: atom.topicKey
            });
        }
    }

    if (topStandingWaves.length > 0) {
        contextSections.push('[Standing Waves]');
        for (const ranked of topStandingWaves) {
            contextSections.push(formatStandingWave(ranked.wave));
            citations.push({
                kind: 'standing_wave',
                id: ranked.wave.id,
                createdAt: ranked.wave.lastReinforcedAt,
                excerpt: ranked.wave.canonicalText,
                score: ranked.score,
                topicKey: ranked.wave.topicKey
            });
        }
    }

    if (branchWarnings.length > 0) {
        contextSections.push('[Branch Warnings]');
        contextSections.push(...branchWarnings);
        for (const ranked of topBranches) {
            citations.push({
                kind: 'branch',
                id: ranked.branch.id,
                createdAt: ranked.branch.lastSeenAt,
                excerpt: ranked.branch.branchText,
                score: ranked.score,
                topicKey: ranked.branch.topicKey
            });
        }
    }

    if (contextSections.length > 1) {
        contextSections.push('Use retrieved evidence and citations as memory. If branch warnings conflict, acknowledge the conflict instead of collapsing it.');
    }

    return {
        queryText,
        queryWaveSignature,
        matchedAtomIds: topAtoms.map((ranked) => ranked.atom.id),
        matchedStandingWaveIds: topStandingWaves.map((ranked) => ranked.wave.id),
        matchedBranchIds: topBranches.map((ranked) => ranked.branch.id),
        assembledContext: contextSections.length > 1 ? contextSections.join('\n') : null,
        citations,
        branchWarnings,
        memoryMode: MEMORY_MODE
    };
}

export async function importLegacyLedger(legacyLedgerPath: string, options: MemoryBrainOptions = {}) {
    const db = prepareDatabase({ ...options, legacyLedgerPath });
    ensureLegacyImported(db, { ...options, legacyLedgerPath });
    return {
        importedFrom: path.resolve(legacyLedgerPath)
    };
}

export async function getMemoryAtoms(options: MemoryBrainOptions = {}): Promise<MemoryAtom[]> {
    const db = prepareDatabase(options);
    const rows = db.query('SELECT * FROM memory_atoms ORDER BY id ASC').all() as AtomRow[];
    return rows.map(mapAtom);
}

export async function getStandingWaves(options: MemoryBrainOptions = {}): Promise<StandingWave[]> {
    const db = prepareDatabase(options);
    const rows = db.query('SELECT * FROM standing_waves ORDER BY id ASC').all() as StandingWaveRow[];
    return rows.map(mapStandingWave);
}

export async function getEvidenceBranches(options: MemoryBrainOptions = {}): Promise<EvidenceBranch[]> {
    const db = prepareDatabase(options);
    const rows = db.query('SELECT * FROM evidence_branches ORDER BY id ASC').all() as EvidenceBranchRow[];
    return rows.map(mapEvidenceBranch);
}
