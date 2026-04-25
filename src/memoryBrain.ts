import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { textToWave } from './modulator';
import { calculateSector, cosineSimilarity } from './waveMath';
import { simulateInterference, type WaveUnit } from './virtualCrystal';

export const MEMORY_MODE = 'chrono-resonant-memory-brain';
export const DEFAULT_WORKSPACE_ID = 'personal';
export const DEFAULT_WORKSPACE_NAME = 'Personal';

const DEFAULT_MEMORY_BRAIN_PATH = path.join('logs', 'memory-brain.sqlite');
const DEFAULT_LEGACY_LEDGER_PATH = path.join('logs', 'matrix.crystal');
const ROOT_LEGACY_LEDGER_PATH = 'matrix.crystal';
const ALLOWED_IMPORT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.tsx', '.js', '.jsx', '.py']);
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
    'Gemma Output:',
    "Qwen's response",
    "Gemma's response",
    'Qwen response',
    'Gemma response',
    'final answer should be',
    'more specific and relevant to the user'
] as const;

export type MemoryModality = 'text' | 'system_derived' | 'legacy_import' | 'file_chunk';
export type MemorySourceKind = 'user' | 'assistant' | 'system' | 'legacy_ledger';
export type MemorySourceType = 'conversation' | 'file' | 'system' | 'legacy';
export type MemoryRecallState = 'active' | 'excluded' | 'superseded';
export type MemoryCorrectionState = 'none' | 'incorrect' | 'corrected';
export type MemoryFeedbackAction = 'pin' | 'exclude' | 'mark_wrong' | 'restore';

export interface MemoryBrainOptions {
    brainPath?: string;
    legacyLedgerPath?: string;
    workspaceId?: string;
}

export interface Workspace {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    isDefault: boolean;
}

export interface RecordInteractionInput {
    contentText: string;
    waveSignature: WaveUnit[];
    sourceKind: MemorySourceKind;
    modality: MemoryModality;
    workspaceId?: string | null;
    sessionId?: string | null;
    turnId?: string | null;
    rawPayload?: unknown;
    salience?: number;
    confidence?: number;
    parentAtomId?: number | null;
    legacyOrigin?: string | null;
    createdAt?: string;
    sourceType?: MemorySourceType;
    sourceUri?: string | null;
    sourceTitle?: string | null;
    sourceHash?: string | null;
    chunkIndex?: number | null;
    isPinned?: boolean;
    recallState?: MemoryRecallState;
    correctionState?: MemoryCorrectionState;
}

export interface MemoryAtom {
    id: number;
    workspaceId: string;
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
    sourceType: MemorySourceType;
    sourceUri: string | null;
    sourceTitle: string | null;
    sourceHash: string | null;
    chunkIndex: number | null;
    isPinned: boolean;
    recallState: MemoryRecallState;
    correctionState: MemoryCorrectionState;
}

export interface StandingWave {
    id: number;
    workspaceId: string;
    kind: string;
    topicKey: string;
    canonicalText: string;
    supportCount: number;
    firstSeenAt: string;
    lastReinforcedAt: string;
    stability: number;
    confidence: number;
    entityKeys: string[];
    sourceAtomIds: number[];
}

export interface EvidenceBranch {
    id: number;
    workspaceId: string;
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
    workspaceId: string;
    createdAt: string;
    excerpt: string;
    score: number;
    topicKey?: string | null;
    sourceType?: MemorySourceType;
    sourceTitle?: string | null;
    sourceUri?: string | null;
    isPinned?: boolean;
}

export interface ProbeEvidenceGroups {
    conversations: MemoryCitation[];
    files: MemoryCitation[];
    standing: MemoryCitation[];
    branches: MemoryCitation[];
}

export interface ProbeResult {
    queryText: string;
    queryWaveSignature: WaveUnit[];
    workspaceId: string;
    matchedAtomIds: number[];
    matchedStandingWaveIds: number[];
    matchedBranchIds: number[];
    assembledContext: string | null;
    citations: MemoryCitation[];
    evidenceGroups: ProbeEvidenceGroups;
    branchWarnings: string[];
    memoryMode: string;
}

export interface WorkspaceSource {
    sourceTitle: string;
    sourceUri: string;
    sourceHash: string;
    chunkCount: number;
    lastImportedAt: string;
}

export interface WorkspaceSnapshot {
    workspaceId: string;
    workspace: Workspace;
    workspaces: Workspace[];
    recentConversation: MemoryAtom[];
    recentActivity: MemoryAtom[];
    importedSources: WorkspaceSource[];
    stats: {
        totalMemories: number;
        pinnedMemories: number;
        fileSources: number;
        conversationTurns: number;
    };
}

export interface FileImportFile {
    name: string;
    content: string;
    relativePath?: string | null;
    sourceUri?: string | null;
    sourceTitle?: string | null;
    sourceHash?: string | null;
    lastModified?: number | null;
}

export interface FileImportResult {
    workspaceId: string;
    importedFiles: number;
    skippedFiles: number;
    importedAtoms: number;
    sources: WorkspaceSource[];
}

interface DerivedMemory {
    workspaceId: string;
    kind: string;
    topicKey: string;
    canonicalText: string;
    confidence: number;
    entityKeys: string[];
    sourceAtomIds: number[];
    firstSeenAt: string;
    lastReinforcedAt: string;
}

interface TimeAnchor {
    preferredYear: number | null;
    prefersPast: boolean;
}

interface RecallPreference {
    preferConversation: boolean;
    preferFiles: boolean;
}

type WorkspaceRow = {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    updated_at: string;
    is_default: number;
};

type AtomRow = {
    id: number;
    workspace_id: string;
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
    source_type: MemorySourceType;
    source_uri: string | null;
    source_title: string | null;
    source_hash: string | null;
    chunk_index: number | null;
    is_pinned: number;
    recall_state: MemoryRecallState;
    correction_state: MemoryCorrectionState;
};

type StandingWaveRow = {
    id: number;
    workspace_id: string;
    kind: string;
    topic_key: string;
    canonical_text: string;
    support_count: number;
    first_seen_at: string;
    last_reinforced_at: string;
    stability: number;
    confidence: number;
    entity_keys_json: string;
    source_atom_ids_json: string;
};

type EvidenceBranchRow = {
    id: number;
    workspace_id: string;
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

function normalizeText(text: string): string {
    return normalizeWhitespace(text.toLowerCase().replace(/[^a-z0-9_:/\\.\-\s]/g, ' '));
}

function excerpt(text: string, maxLength = 180): string {
    const value = normalizeWhitespace(text);
    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function slugify(text: string): string {
    const slug = normalizeText(text)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'workspace';
}

function hashContent(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function textToVector(text: string): WaveUnit[] {
    const waveA = textToWave(text);
    const waveB = waveA.map((phase) => (phase + Math.PI / 2) % (Math.PI * 2));
    return simulateInterference(waveA, waveB);
}

function tokenize(text: string): string[] {
    return [...new Set(
        normalizeText(text)
            .split(/\s+/)
            .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    )];
}

export function containsOrchestrationArtifact(text: string): boolean {
    return ORCHESTRATION_ARTIFACT_PATTERNS.some((pattern) => text.includes(pattern));
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

    for (const phrase of ['chronicle memory', 'virtual crystal', 'memory brain', 'qwen', 'gemma', 'sqlite', 'llm', 'llms']) {
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

function inferSourceType(input: RecordInteractionInput): MemorySourceType {
    if (input.sourceType) return input.sourceType;
    if (input.modality === 'file_chunk') return 'file';
    if (input.modality === 'legacy_import') return 'legacy';
    if (input.sourceKind === 'assistant') return 'conversation';
    if (input.sourceKind === 'system') return 'system';
    return 'conversation';
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

function inferRecallPreference(queryText: string): RecallPreference {
    const normalized = normalizeText(queryText);
    const preferFiles = /\b(file|files|document|documents|doc|docs|note|notes|source|sources|import|imported|readme|plan\.md|markdown|folder|code)\b/.test(normalized);
    const preferConversation = !preferFiles && (
        /\b(we|our|us)\b/.test(normalized) ||
        /\b(discuss|discussed|decide|decided|talk|talked|said|asked|conversation|chat|earlier|previously|last time)\b/.test(normalized)
    );

    return { preferConversation, preferFiles };
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

function overlapScore(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) return 0;

    const rightSet = new Set(right);
    let matches = 0;

    for (const token of left) {
        if (rightSet.has(token)) matches += 1;
    }

    return matches / Math.max(left.length, right.length, 1);
}

function computeStability(supportCount: number): number {
    return clamp(0.35 + Math.log2(supportCount + 1) * 0.2, 0.35, 1);
}

function isSupportedImportFile(fileName: string): boolean {
    return ALLOWED_IMPORT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function normalizeSourceUri(file: FileImportFile): string {
    return file.sourceUri ?? file.relativePath ?? file.name;
}

function chunkText(content: string, targetSize = 900, overlap = 120): string[] {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    if (normalized.length <= targetSize) return [normalized];

    const chunks: string[] = [];
    let start = 0;

    while (start < normalized.length) {
        let end = Math.min(normalized.length, start + targetSize);
        if (end < normalized.length) {
            const breakIndex = normalized.lastIndexOf('\n', end);
            const spaceIndex = normalized.lastIndexOf(' ', end);
            const candidate = Math.max(breakIndex, spaceIndex);
            if (candidate > start + Math.floor(targetSize * 0.6)) {
                end = candidate;
            }
        }

        const chunk = normalized.slice(start, end).trim();
        if (chunk) {
            chunks.push(chunk);
        }

        if (end >= normalized.length) break;
        start = Math.max(end - overlap, end);
    }

    return chunks;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isDefault: Boolean(row.is_default)
    };
}

function mapAtom(row: AtomRow): MemoryAtom {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
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
        entityKeys: parseStringArray(row.entity_keys_json),
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        sourceTitle: row.source_title,
        sourceHash: row.source_hash,
        chunkIndex: row.chunk_index,
        isPinned: Boolean(row.is_pinned),
        recallState: row.recall_state,
        correctionState: row.correction_state
    };
}

function mapStandingWave(row: StandingWaveRow): StandingWave {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        kind: row.kind,
        topicKey: row.topic_key,
        canonicalText: row.canonical_text,
        supportCount: row.support_count,
        firstSeenAt: row.first_seen_at,
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
        workspaceId: row.workspace_id,
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

function ensureColumn(db: Database, table: string, columnName: string, columnDefinition: string) {
    const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === columnName)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
}

function ensureSchema(db: Database) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS memory_atoms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL DEFAULT 'personal',
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
            entity_keys_json TEXT NOT NULL DEFAULT '[]',
            source_type TEXT NOT NULL DEFAULT 'conversation',
            source_uri TEXT,
            source_title TEXT,
            source_hash TEXT,
            chunk_index INTEGER,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            recall_state TEXT NOT NULL DEFAULT 'active',
            correction_state TEXT NOT NULL DEFAULT 'none'
        );

        CREATE TABLE IF NOT EXISTS standing_waves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL DEFAULT 'personal',
            kind TEXT NOT NULL,
            topic_key TEXT NOT NULL,
            canonical_text TEXT NOT NULL,
            support_count INTEGER NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_reinforced_at TEXT NOT NULL,
            stability REAL NOT NULL,
            confidence REAL NOT NULL,
            entity_keys_json TEXT NOT NULL DEFAULT '[]',
            source_atom_ids_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS evidence_branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL DEFAULT 'personal',
            kind TEXT NOT NULL,
            topic_key TEXT NOT NULL,
            branch_text TEXT NOT NULL,
            status TEXT NOT NULL,
            confidence REAL NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            support_atom_ids_json TEXT NOT NULL DEFAULT '[]'
        );
    `);

    ensureColumn(db, 'memory_atoms', 'workspace_id', "workspace_id TEXT NOT NULL DEFAULT 'personal'");
    ensureColumn(db, 'memory_atoms', 'source_type', "source_type TEXT NOT NULL DEFAULT 'conversation'");
    ensureColumn(db, 'memory_atoms', 'source_uri', 'source_uri TEXT');
    ensureColumn(db, 'memory_atoms', 'source_title', 'source_title TEXT');
    ensureColumn(db, 'memory_atoms', 'source_hash', 'source_hash TEXT');
    ensureColumn(db, 'memory_atoms', 'chunk_index', 'chunk_index INTEGER');
    ensureColumn(db, 'memory_atoms', 'is_pinned', 'is_pinned INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'memory_atoms', 'recall_state', "recall_state TEXT NOT NULL DEFAULT 'active'");
    ensureColumn(db, 'memory_atoms', 'correction_state', "correction_state TEXT NOT NULL DEFAULT 'none'");

    ensureColumn(db, 'standing_waves', 'workspace_id', "workspace_id TEXT NOT NULL DEFAULT 'personal'");
    ensureColumn(db, 'standing_waves', 'first_seen_at', "first_seen_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");

    ensureColumn(db, 'evidence_branches', 'workspace_id', "workspace_id TEXT NOT NULL DEFAULT 'personal'");

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_created_at ON memory_atoms(created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_workspace_id ON memory_atoms(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_turn_id ON memory_atoms(turn_id);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_session_id ON memory_atoms(session_id);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_topic_key ON memory_atoms(topic_key);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_source_type ON memory_atoms(source_type);
        CREATE INDEX IF NOT EXISTS idx_memory_atoms_recall_state ON memory_atoms(recall_state);
        CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at);
    `);

    db.exec('DROP INDEX IF EXISTS idx_standing_wave_unique');
    db.exec('DROP INDEX IF EXISTS idx_branch_unique');
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_standing_wave_unique_v2
            ON standing_waves(workspace_id, kind, topic_key, canonical_text);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_unique_v2
            ON evidence_branches(workspace_id, kind, topic_key, branch_text);
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

function ensureDefaultWorkspace(db: Database) {
    const timestamp = new Date().toISOString();
    db.query(`
        INSERT INTO workspaces(id, name, slug, created_at, updated_at, is_default)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            slug = excluded.slug,
            updated_at = excluded.updated_at,
            is_default = 1
    `).run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_ID, timestamp, timestamp);
}

function resolveWorkspaceId(db: Database, requested: string | null | undefined): string {
    ensureDefaultWorkspace(db);
    if (!requested) return DEFAULT_WORKSPACE_ID;

    const byId = db.query('SELECT id FROM workspaces WHERE id = ?').get(requested) as { id: string } | null;
    if (byId) return byId.id;

    const bySlug = db.query('SELECT id FROM workspaces WHERE slug = ?').get(slugify(requested)) as { id: string } | null;
    return bySlug?.id ?? DEFAULT_WORKSPACE_ID;
}

function runMemoryMaintenance(db: Database) {
    const maintenanceKey = 'maintenance:purge-orchestration-artifacts:v3';
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
             OR content_text LIKE '%Qwen''s response%'
             OR content_text LIKE '%Gemma''s response%'
             OR content_text LIKE '%Qwen response%'
             OR content_text LIKE '%Gemma response%'
             OR content_text LIKE '%final answer should be%'
             OR content_text LIKE '%more specific and relevant to the user%'
          )
    `).run();

    db.query(`
        DELETE FROM memory_atoms
        WHERE source_type = 'acoustic'
           OR modality = 'acoustic_summary'
           OR raw_payload_json LIKE '%acoustic-uplink%'
    `).run();

    db.query(`
        DELETE FROM standing_waves
        WHERE kind LIKE 'acoustic_%'
           OR topic_key LIKE 'acoustic_%'
    `).run();

    db.query(`
        DELETE FROM evidence_branches
        WHERE kind LIKE 'acoustic_%'
           OR topic_key LIKE 'acoustic_%'
           OR branch_text LIKE '%Acoustic Uplink%'
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
    ensureDefaultWorkspace(db);
    runMemoryMaintenance(db);
    databases.set(brainPath, db);
    return db;
}

function prepareDatabase(options: MemoryBrainOptions = {}): Database {
    const db = getDatabase(options);
    ensureLegacyImported(db, options);
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

function insertAtomRow(db: Database, input: RecordInteractionInput, workspaceId: string): MemoryAtom {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const entityKeys = extractEntityKeys(input.contentText);
    const topicKey = entityKeys[0] ?? null;
    const sourceType = inferSourceType(input);

    const result = db.query(`
        INSERT INTO memory_atoms (
            workspace_id,
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
            entity_keys_json,
            source_type,
            source_uri,
            source_title,
            source_hash,
            chunk_index,
            is_pinned,
            recall_state,
            correction_state
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        workspaceId,
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
        JSON.stringify(entityKeys),
        sourceType,
        input.sourceUri ?? null,
        input.sourceTitle ?? null,
        input.sourceHash ?? null,
        input.chunkIndex ?? null,
        input.isPinned ? 1 : 0,
        input.recallState ?? 'active',
        input.correctionState ?? 'none'
    );

    const inserted = db.query('SELECT * FROM memory_atoms WHERE id = ?').get(Number(result.lastInsertRowid)) as AtomRow;
    return mapAtom(inserted);
}

function extractDerivedMemories(atom: MemoryAtom): DerivedMemory[] {
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
            const key = `${rule.kind}:${canonicalText.toLowerCase()}`;
            if (candidates.has(key)) continue;

            candidates.set(key, {
                workspaceId: atom.workspaceId,
                kind: rule.kind,
                topicKey: buildTopicKey(rule.kind, canonicalText),
                canonicalText,
                confidence: rule.confidence,
                entityKeys: extractEntityKeys(canonicalText),
                sourceAtomIds: [atom.id],
                firstSeenAt: atom.createdAt,
                lastReinforcedAt: atom.createdAt
            });
        }
    }

    return [...candidates.values()];
}

function rebuildWorkspaceDerivatives(db: Database, workspaceId: string) {
    db.query('DELETE FROM standing_waves WHERE workspace_id = ?').run(workspaceId);
    db.query('DELETE FROM evidence_branches WHERE workspace_id = ?').run(workspaceId);

    const rows = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND recall_state = 'active'
        ORDER BY datetime(created_at) ASC, id ASC
    `).all(workspaceId) as AtomRow[];

    const aggregates = new Map<string, DerivedMemory>();

    for (const row of rows) {
        const atom = mapAtom(row);
        for (const derived of extractDerivedMemories(atom)) {
            const key = `${derived.kind}\u0000${derived.topicKey}\u0000${derived.canonicalText}`;
            const existing = aggregates.get(key);

            if (!existing) {
                aggregates.set(key, derived);
                continue;
            }

            existing.sourceAtomIds = [...new Set([...existing.sourceAtomIds, ...derived.sourceAtomIds])];
            existing.entityKeys = [...new Set([...existing.entityKeys, ...derived.entityKeys])];
            existing.confidence = Math.max(existing.confidence, derived.confidence);
            existing.lastReinforcedAt = derived.lastReinforcedAt;
        }
    }

    for (const aggregate of aggregates.values()) {
        db.query(`
            INSERT INTO standing_waves (
                workspace_id,
                kind,
                topic_key,
                canonical_text,
                support_count,
                first_seen_at,
                last_reinforced_at,
                stability,
                confidence,
                entity_keys_json,
                source_atom_ids_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            workspaceId,
            aggregate.kind,
            aggregate.topicKey,
            aggregate.canonicalText,
            aggregate.sourceAtomIds.length,
            aggregate.firstSeenAt,
            aggregate.lastReinforcedAt,
            computeStability(aggregate.sourceAtomIds.length),
            clamp(aggregate.confidence, 0, 1),
            JSON.stringify(aggregate.entityKeys),
            JSON.stringify(aggregate.sourceAtomIds)
        );
    }

    const standingRows = db.query(`
        SELECT * FROM standing_waves
        WHERE workspace_id = ?
        ORDER BY id ASC
    `).all(workspaceId) as StandingWaveRow[];

    const grouped = new Map<string, StandingWaveRow[]>();
    for (const row of standingRows) {
        if (row.kind === 'task') continue;
        const key = `${row.kind}\u0000${row.topic_key}`;
        const list = grouped.get(key) ?? [];
        list.push(row);
        grouped.set(key, list);
    }

    for (const rowsForTopic of grouped.values()) {
        if (rowsForTopic.length <= 1) continue;
        for (const row of rowsForTopic) {
            db.query(`
                INSERT INTO evidence_branches (
                    workspace_id,
                    kind,
                    topic_key,
                    branch_text,
                    status,
                    confidence,
                    first_seen_at,
                    last_seen_at,
                    support_atom_ids_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                workspaceId,
                row.kind,
                row.topic_key,
                row.canonical_text,
                'active',
                row.confidence,
                row.first_seen_at,
                row.last_reinforced_at,
                row.source_atom_ids_json
            );
        }
    }
}

function ensureLegacyImported(db: Database, options: MemoryBrainOptions = {}) {
    const brainPath = getMemoryBrainPath(options);
    const workspaceId = resolveWorkspaceId(db, options.workspaceId);
    const candidates = getLegacyLedgerCandidates(options).filter((candidate) => candidate !== brainPath);

    for (const legacyPath of candidates) {
        if (!existsSync(legacyPath)) continue;

        const markerKey = `legacy-import:${legacyPath}`;
        if (getMeta(db, markerKey)) continue;

        const content = readFileSync(legacyPath, 'utf8');
        const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const fallbackCreatedAt = statSync(legacyPath).mtime.toISOString();
        let imported = false;

        for (const line of lines) {
            const record = parseLegacyRecord(line);
            if (!record) continue;

            insertAtomRow(db, {
                contentText: record.text,
                waveSignature: record.vector,
                sourceKind: 'legacy_ledger',
                modality: 'legacy_import',
                workspaceId,
                salience: clamp(record.amplitude ?? 0.6, 0, 1),
                confidence: 0.55,
                rawPayload: {
                    ...record,
                    sector: record.sector ?? calculateSector(record.vector)
                },
                legacyOrigin: legacyPath,
                createdAt: fallbackCreatedAt,
                sourceType: 'legacy',
                sourceUri: legacyPath,
                sourceTitle: path.basename(legacyPath),
                sourceHash: hashContent(line)
            }, workspaceId);
            imported = true;
        }

        if (imported) {
            rebuildWorkspaceDerivatives(db, workspaceId);
        }

        setMeta(db, markerKey, new Date().toISOString());
    }
}

function rankAtoms(atoms: MemoryAtom[], queryText: string, queryWaveSignature: WaveUnit[]): Array<{ atom: MemoryAtom; score: number }> {
    const queryTokens = tokenize(queryText);
    const queryEntities = extractEntityKeys(queryText);
    const timeAnchor = inferTimeAnchor(queryText);
    const recallPreference = inferRecallPreference(queryText);

    return atoms
        .filter((atom) => atom.recallState === 'active' && !shouldSuppressAtomFromRecall(atom))
        .map((atom) => {
            const lexical = overlapScore(queryTokens, tokenize(atom.contentText));
            const entity = overlapScore(queryEntities, atom.entityKeys);
            const wave = cosineSimilarity(queryWaveSignature, atom.waveSignature);
            const time = timeScore(atom.createdAt, timeAnchor);
            const pinned = atom.isPinned ? 1 : 0;
            const sourceBoost = atom.sourceType === 'conversation' ? 0.04 : atom.sourceType === 'file' ? 0.02 : 0;
            const intentBoost = recallPreference.preferConversation
                ? atom.sourceType === 'conversation' ? 0.12 : atom.sourceType === 'file' ? -0.05 : 0
                : recallPreference.preferFiles
                    ? atom.sourceType === 'file' ? 0.12 : atom.sourceType === 'conversation' ? -0.04 : 0
                    : 0;
            const assistantPenalty = atom.sourceKind === 'assistant' ? -0.03 : 0;
            const score = lexical * 0.32 + entity * 0.18 + wave * 0.25 + time * 0.08 + pinned * 0.1 + atom.salience * 0.05 + sourceBoost + intentBoost + assistantPenalty;

            return { atom, score };
        })
        .filter(({ score }) => score > 0.08)
        .sort((left, right) => right.score - left.score);
}

function rankStandingWaves(waves: StandingWave[], queryText: string): Array<{ wave: StandingWave; score: number }> {
    const queryTokens = tokenize(queryText);
    const queryEntities = extractEntityKeys(queryText);

    return waves
        .map((wave) => {
            const lexical = overlapScore(queryTokens, tokenize(wave.canonicalText));
            const entity = overlapScore(queryEntities, wave.entityKeys);
            const support = clamp(wave.supportCount / 6, 0, 1);
            const score = lexical * 0.42 + entity * 0.25 + support * 0.18 + wave.stability * 0.15;

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
    const sourceLabel = atom.sourceType === 'file'
        ? `${atom.sourceTitle ?? atom.sourceUri ?? 'File'}`
        : `${atom.sourceKind}/${atom.modality}`;

    return `- Atom #${atom.id} @ ${atom.createdAt} [${sourceLabel}]: ${excerpt(atom.contentText, 220)}`;
}

function formatStandingWave(wave: StandingWave): string {
    return `- ${wave.kind} (support ${wave.supportCount}, stability ${wave.stability.toFixed(2)}): ${excerpt(wave.canonicalText, 220)}`;
}

function formatBranchWarning(topicKey: string, branches: EvidenceBranch[]): string {
    return `- ${topicKey}: ${branches.map((branch) => excerpt(branch.branchText, 120)).join(' | ')}`;
}

function buildEvidenceGroups(citations: MemoryCitation[]): ProbeEvidenceGroups {
    return {
        conversations: citations.filter((citation) => citation.kind === 'atom' && citation.sourceType !== 'file'),
        files: citations.filter((citation) => citation.kind === 'atom' && citation.sourceType === 'file'),
        standing: citations.filter((citation) => citation.kind === 'standing_wave'),
        branches: citations.filter((citation) => citation.kind === 'branch')
    };
}

function getTimelineNeighbors(db: Database, workspaceId: string, atomId: number): MemoryAtom[] {
    const neighbors: MemoryAtom[] = [];

    const previous = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND id < ?
          AND recall_state = 'active'
          AND source_type != 'file'
        ORDER BY id DESC
        LIMIT 1
    `).get(workspaceId, atomId) as AtomRow | null;

    const next = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND id > ?
          AND recall_state = 'active'
          AND source_type != 'file'
        ORDER BY id ASC
        LIMIT 1
    `).get(workspaceId, atomId) as AtomRow | null;

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

function getWorkspaceRow(db: Database, workspaceId: string): WorkspaceRow {
    ensureDefaultWorkspace(db);
    const resolvedId = resolveWorkspaceId(db, workspaceId);
    return db.query('SELECT * FROM workspaces WHERE id = ?').get(resolvedId) as WorkspaceRow;
}

export async function listWorkspaces(options: MemoryBrainOptions = {}): Promise<Workspace[]> {
    const db = prepareDatabase(options);
    const rows = db.query(`
        SELECT * FROM workspaces
        ORDER BY is_default DESC, updated_at DESC, name ASC
    `).all() as WorkspaceRow[];
    return rows.map(mapWorkspace);
}

export async function createWorkspace(name: string, options: MemoryBrainOptions = {}): Promise<Workspace> {
    const db = prepareDatabase(options);
    const baseName = normalizeWhitespace(name) || 'Untitled Workspace';
    const timestamp = new Date().toISOString();
    const baseSlug = slugify(baseName);
    let slug = baseSlug;
    let suffix = 1;

    while (db.query('SELECT id FROM workspaces WHERE slug = ?').get(slug)) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
    }

    const id = crypto.randomUUID();
    db.query(`
        INSERT INTO workspaces(id, name, slug, created_at, updated_at, is_default)
        VALUES (?, ?, ?, ?, ?, 0)
    `).run(id, baseName, slug, timestamp, timestamp);

    return mapWorkspace(db.query('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow);
}

export async function getWorkspaceSnapshot(options: MemoryBrainOptions = {}): Promise<WorkspaceSnapshot> {
    const db = prepareDatabase(options);
    const workspaceId = resolveWorkspaceId(db, options.workspaceId);
    const workspace = mapWorkspace(getWorkspaceRow(db, workspaceId));
    const workspaces = await listWorkspaces(options);

    const recentConversationRows = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND recall_state = 'active'
          AND source_type != 'file'
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 16
    `).all(workspaceId) as AtomRow[];

    const recentActivityRows = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND recall_state = 'active'
          AND source_type != 'file'
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 24
    `).all(workspaceId) as AtomRow[];

    const importedSources = await listImportedSources({ ...options, workspaceId });

    const statsRow = db.query(`
        SELECT
            COUNT(*) AS total_memories,
            SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) AS pinned_memories,
            SUM(CASE WHEN source_type != 'file' THEN 1 ELSE 0 END) AS conversation_turns
        FROM memory_atoms
        WHERE workspace_id = ?
          AND recall_state = 'active'
    `).get(workspaceId) as { total_memories: number; pinned_memories: number | null; conversation_turns: number | null };

    return {
        workspaceId,
        workspace,
        workspaces,
        recentConversation: recentConversationRows.reverse().map(mapAtom),
        recentActivity: recentActivityRows.map(mapAtom),
        importedSources,
        stats: {
            totalMemories: statsRow.total_memories,
            pinnedMemories: statsRow.pinned_memories ?? 0,
            fileSources: importedSources.length,
            conversationTurns: statsRow.conversation_turns ?? 0
        }
    };
}

export async function listImportedSources(options: MemoryBrainOptions = {}): Promise<WorkspaceSource[]> {
    const db = prepareDatabase(options);
    const workspaceId = resolveWorkspaceId(db, options.workspaceId);
    const rows = db.query(`
        SELECT
            COALESCE(source_title, source_uri, 'Untitled Source') AS source_title,
            COALESCE(source_uri, source_title, 'unknown') AS source_uri,
            COALESCE(source_hash, '') AS source_hash,
            COUNT(*) AS chunk_count,
            MAX(created_at) AS last_imported_at
        FROM memory_atoms
        WHERE workspace_id = ?
          AND source_type = 'file'
          AND recall_state = 'active'
        GROUP BY source_title, source_uri, source_hash
        ORDER BY last_imported_at DESC
    `).all(workspaceId) as Array<{
        source_title: string;
        source_uri: string;
        source_hash: string;
        chunk_count: number;
        last_imported_at: string;
    }>;

    return rows.map((row) => ({
        sourceTitle: row.source_title,
        sourceUri: row.source_uri,
        sourceHash: row.source_hash,
        chunkCount: row.chunk_count,
        lastImportedAt: row.last_imported_at
    }));
}

export async function recordInteraction(input: RecordInteractionInput, options: MemoryBrainOptions = {}): Promise<MemoryAtom> {
    const db = prepareDatabase(options);
    const workspaceId = resolveWorkspaceId(db, input.workspaceId ?? options.workspaceId);
    const atom = insertAtomRow(db, input, workspaceId);

    rebuildWorkspaceDerivatives(db, workspaceId);

    return atom;
}

export async function consolidateAtom(atomId: number, options: MemoryBrainOptions = {}): Promise<void> {
    const db = prepareDatabase(options);
    const row = db.query('SELECT workspace_id FROM memory_atoms WHERE id = ?').get(atomId) as { workspace_id: string } | null;
    if (!row) return;
    rebuildWorkspaceDerivatives(db, row.workspace_id);
}

export async function importFilesToMemory(files: FileImportFile[], options: MemoryBrainOptions = {}): Promise<FileImportResult> {
    const db = prepareDatabase(options);
    const workspaceId = resolveWorkspaceId(db, options.workspaceId);

    let importedFiles = 0;
    let skippedFiles = 0;
    let importedAtoms = 0;
    let touchedWorkspace = false;

    for (const file of files) {
        if (!isSupportedImportFile(file.name)) {
            skippedFiles += 1;
            continue;
        }

        const sourceUri = normalizeSourceUri(file);
        const sourceTitle = file.sourceTitle ?? file.name;
        const content = file.content.replace(/\r\n/g, '\n').trim();
        if (!content) {
            skippedFiles += 1;
            continue;
        }

        const sourceHash = file.sourceHash ?? hashContent(content);
        const existing = db.query(`
            SELECT id FROM memory_atoms
            WHERE workspace_id = ?
              AND source_type = 'file'
              AND source_uri = ?
              AND source_hash = ?
              AND recall_state = 'active'
            LIMIT 1
        `).get(workspaceId, sourceUri, sourceHash);

        if (existing) {
            skippedFiles += 1;
            continue;
        }

        db.query(`
            UPDATE memory_atoms
            SET recall_state = 'superseded'
            WHERE workspace_id = ?
              AND source_type = 'file'
              AND source_uri = ?
              AND recall_state = 'active'
        `).run(workspaceId, sourceUri);

        const chunks = chunkText(content);
        for (let index = 0; index < chunks.length; index++) {
            const chunk = chunks[index]!;
            insertAtomRow(db, {
                contentText: chunk,
                waveSignature: textToVector(chunk),
                sourceKind: 'system',
                modality: 'file_chunk',
                workspaceId,
                sourceType: 'file',
                sourceUri,
                sourceTitle,
                sourceHash,
                chunkIndex: index,
                salience: 0.68,
                confidence: 0.74,
                rawPayload: {
                    sourceTitle,
                    sourceUri,
                    sourceHash,
                    chunkIndex: index,
                    chunkCount: chunks.length,
                    lastModified: file.lastModified ?? null
                }
            }, workspaceId);
            importedAtoms += 1;
        }

        importedFiles += 1;
        touchedWorkspace = true;
    }

    if (touchedWorkspace) {
        rebuildWorkspaceDerivatives(db, workspaceId);
        db.query('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), workspaceId);
    }

    return {
        workspaceId,
        importedFiles,
        skippedFiles,
        importedAtoms,
        sources: await listImportedSources({ ...options, workspaceId })
    };
}

export async function updateMemoryFeedback(atomId: number, action: MemoryFeedbackAction, options: MemoryBrainOptions = {}): Promise<MemoryAtom | null> {
    const db = prepareDatabase(options);
    const workspaceId = options.workspaceId ? resolveWorkspaceId(db, options.workspaceId) : null;
    const row = db.query(`
        SELECT * FROM memory_atoms
        WHERE id = ?
        ${workspaceId ? 'AND workspace_id = ?' : ''}
    `).get(...(workspaceId ? [atomId, workspaceId] : [atomId])) as AtomRow | null;

    if (!row) return null;

    const atom = mapAtom(row);

    switch (action) {
        case 'pin':
            db.query(`
                UPDATE memory_atoms
                SET is_pinned = 1,
                    salience = CASE WHEN salience < 0.97 THEN 0.97 ELSE salience END
                WHERE id = ?
            `).run(atomId);
            break;
        case 'exclude':
            db.query(`
                UPDATE memory_atoms
                SET recall_state = 'excluded'
                WHERE id = ?
            `).run(atomId);
            rebuildWorkspaceDerivatives(db, atom.workspaceId);
            break;
        case 'mark_wrong':
            db.query(`
                UPDATE memory_atoms
                SET recall_state = 'excluded',
                    correction_state = 'incorrect'
                WHERE id = ?
            `).run(atomId);
            rebuildWorkspaceDerivatives(db, atom.workspaceId);
            break;
        case 'restore':
            db.query(`
                UPDATE memory_atoms
                SET recall_state = 'active',
                    correction_state = 'none'
                WHERE id = ?
            `).run(atomId);
            rebuildWorkspaceDerivatives(db, atom.workspaceId);
            break;
    }

    const updated = db.query('SELECT * FROM memory_atoms WHERE id = ?').get(atomId) as AtomRow;
    return mapAtom(updated);
}

export async function probeMemory(queryText: string, queryWaveSignature: WaveUnit[], options: MemoryBrainOptions = {}): Promise<ProbeResult> {
    const db = prepareDatabase(options);
    const workspaceId = resolveWorkspaceId(db, options.workspaceId);
    const atomRows = db.query(`
        SELECT * FROM memory_atoms
        WHERE workspace_id = ?
          AND recall_state = 'active'
        ORDER BY id ASC
    `).all(workspaceId) as AtomRow[];
    const standingWaveRows = db.query(`
        SELECT * FROM standing_waves
        WHERE workspace_id = ?
        ORDER BY support_count DESC, id ASC
    `).all(workspaceId) as StandingWaveRow[];
    const branchRows = db.query(`
        SELECT * FROM evidence_branches
        WHERE workspace_id = ?
        ORDER BY id ASC
    `).all(workspaceId) as EvidenceBranchRow[];

    const atoms = atomRows.map(mapAtom);
    const standingWaves = standingWaveRows.map(mapStandingWave);
    const branches = branchRows.map(mapEvidenceBranch);

    const topAtoms = rankAtoms(atoms, queryText, queryWaveSignature).slice(0, 4);
    const topStandingWaves = rankStandingWaves(standingWaves, queryText).slice(0, 3);
    const topBranches = rankBranches(branches, queryText).slice(0, 4);

    const timelineAnchors = new Map<number, MemoryAtom>();
    for (const ranked of topAtoms.slice(0, 2)) {
        for (const neighbor of getTimelineNeighbors(db, workspaceId, ranked.atom.id)) {
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

    const contextSections: string[] = [`[Memory Mode]: ${MEMORY_MODE}`, `[Workspace]: ${mapWorkspace(getWorkspaceRow(db, workspaceId)).name}`];
    const citations: MemoryCitation[] = [];

    if (topAtoms.length > 0) {
        contextSections.push('[Evidence Recall]');
        for (const ranked of topAtoms) {
            contextSections.push(formatAtom(ranked.atom));
            citations.push({
                kind: 'atom',
                id: ranked.atom.id,
                workspaceId,
                createdAt: ranked.atom.createdAt,
                excerpt: excerpt(ranked.atom.contentText),
                score: ranked.score,
                topicKey: ranked.atom.topicKey,
                sourceType: ranked.atom.sourceType,
                sourceTitle: ranked.atom.sourceTitle,
                sourceUri: ranked.atom.sourceUri,
                isPinned: ranked.atom.isPinned
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
                workspaceId,
                createdAt: atom.createdAt,
                excerpt: excerpt(atom.contentText),
                score: 0.2,
                topicKey: atom.topicKey,
                sourceType: atom.sourceType,
                sourceTitle: atom.sourceTitle,
                sourceUri: atom.sourceUri,
                isPinned: atom.isPinned
            });
        }
    }

    if (topStandingWaves.length > 0) {
        contextSections.push('[Standing Summaries]');
        for (const ranked of topStandingWaves) {
            contextSections.push(formatStandingWave(ranked.wave));
            citations.push({
                kind: 'standing_wave',
                id: ranked.wave.id,
                workspaceId,
                createdAt: ranked.wave.lastReinforcedAt,
                excerpt: excerpt(ranked.wave.canonicalText),
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
                workspaceId,
                createdAt: ranked.branch.lastSeenAt,
                excerpt: excerpt(ranked.branch.branchText),
                score: ranked.score,
                topicKey: ranked.branch.topicKey
            });
        }
    }

    if (contextSections.length > 2) {
        contextSections.push('Use retrieved evidence and citations as memory. If branch warnings conflict, acknowledge the conflict instead of collapsing it.');
    }

    return {
        queryText,
        queryWaveSignature,
        workspaceId,
        matchedAtomIds: topAtoms.map((ranked) => ranked.atom.id),
        matchedStandingWaveIds: topStandingWaves.map((ranked) => ranked.wave.id),
        matchedBranchIds: topBranches.map((ranked) => ranked.branch.id),
        assembledContext: contextSections.length > 2 ? contextSections.join('\n') : null,
        citations,
        evidenceGroups: buildEvidenceGroups(citations),
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
    const workspaceId = options.workspaceId ? resolveWorkspaceId(db, options.workspaceId) : null;
    const rows = db.query(`
        SELECT * FROM memory_atoms
        ${workspaceId ? 'WHERE workspace_id = ?' : ''}
        ORDER BY id ASC
    `).all(...(workspaceId ? [workspaceId] : [])) as AtomRow[];
    return rows.map(mapAtom);
}

export async function getStandingWaves(options: MemoryBrainOptions = {}): Promise<StandingWave[]> {
    const db = prepareDatabase(options);
    const workspaceId = options.workspaceId ? resolveWorkspaceId(db, options.workspaceId) : null;
    const rows = db.query(`
        SELECT * FROM standing_waves
        ${workspaceId ? 'WHERE workspace_id = ?' : ''}
        ORDER BY id ASC
    `).all(...(workspaceId ? [workspaceId] : [])) as StandingWaveRow[];
    return rows.map(mapStandingWave);
}

export async function getEvidenceBranches(options: MemoryBrainOptions = {}): Promise<EvidenceBranch[]> {
    const db = prepareDatabase(options);
    const workspaceId = options.workspaceId ? resolveWorkspaceId(db, options.workspaceId) : null;
    const rows = db.query(`
        SELECT * FROM evidence_branches
        ${workspaceId ? 'WHERE workspace_id = ?' : ''}
        ORDER BY id ASC
    `).all(...(workspaceId ? [workspaceId] : [])) as EvidenceBranchRow[];
    return rows.map(mapEvidenceBranch);
}
