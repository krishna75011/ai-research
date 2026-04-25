# Chrono-Resonant Memory Brain Plan

## Summary

Replace the current resonance ledger prototype with a new first-class memory brain inside this app. The LLM remains the language cortex, but durable memory moves into a local, evidence-backed cognitive layer built for one persistent owner, with branch-preserving truth handling and deterministic recall first.

This plan replaces the old ledger-centric plan.

## Key Changes

### 1. Introduce the Memory Brain as the primary substrate
- Add a new local memory subsystem backed by Bun SQLite, with the novelty living in the memory model and retrieval rules rather than the disk format.
- Make SQLite the canonical store for all history; stop using `matrix.crystal` as primary storage.
- Define four core record types:
  - `MemoryAtom`: one immutable event or derived observation.
  - `StandingWave`: a durable higher-order memory formed from repeated or reinforced atoms.
  - `EvidenceBranch`: competing claims about the same topic, preserved separately.
  - `ProbeResult`: the assembled recall package for one query.
- Treat every interaction as append-only. No destructive overwrites of prior memory atoms.

### 2. Canonical memory model
- `MemoryAtom` fields:
  - `id`, `created_at`, `source_kind`, `session_id`, `turn_id`, `content_text`, `raw_payload_json`, `wave_signature_json`, `salience`, `confidence`, `modality`, `parent_atom_id`, `legacy_origin`
- `StandingWave` fields:
  - `id`, `kind`, `canonical_text`, `support_count`, `last_reinforced_at`, `stability`, `confidence`, `entity_keys_json`, `source_atom_ids_json`
- `EvidenceBranch` fields:
  - `id`, `topic_key`, `branch_text`, `status`, `confidence`, `first_seen_at`, `last_seen_at`, `support_atom_ids_json`
- `ProbeResult` fields:
  - `query_text`, `query_wave_signature_json`, `matched_atom_ids_json`, `matched_standing_wave_ids_json`, `matched_branch_ids_json`, `assembled_context`, `citations_json`
- `modality` values for v1:
  - `text`
  - `acoustic_summary`
  - `system_derived`
  - `legacy_import`

### 3. Ingestion and consolidation pipeline
- On every text turn:
  - create a `MemoryAtom` from the raw user input
  - compute a wave signature from the current text-to-wave path
  - deterministically extract candidate facts, entities, preferences, decisions, and open tasks
  - update or create matching `StandingWave` records
  - update branch records if the new fact conflicts with an existing fact on the same topic
- On every acoustic turn:
  - keep acoustic input as a secondary modality
  - store the acoustic summary text plus its wave signature as a `MemoryAtom`
  - do not treat acoustic summaries as canonical factual truth by default
  - allow acoustic atoms to reinforce mood/tone/intent standing waves, but not overwrite factual branches
- Deterministic extraction rules for v1:
  - entity extraction from names, projects, paths, dates, model names, and explicit user preference phrasing
  - fact extraction for `I want`, `I prefer`, `we decided`, `remember that`, `use X`, `don't use Y`, and dated decisions
  - open-task extraction for explicit future work statements
- LLM-assisted consolidation is a second pass only:
  - optional local-model summarization can propose standing-wave updates
  - deterministic rules remain authoritative for core factual indexing and branch creation

### 4. Probe-based recall and response assembly
- Replace simple `recallResonance` behavior with a probe engine that scores memory using a weighted combination of:
  - exact lexical overlap
  - entity overlap
  - wave-signature similarity
  - time anchoring when the query references dates, `last year`, `previously`, `earlier`, or session continuity
  - standing-wave stability and support count
- Retrieval order for one query:
  1. exact or near-exact prior event matches
  2. relevant standing waves
  3. unresolved evidence branches
  4. adjacent timeline anchors before and after the best matches
- Build the model context as:
  - current query
  - evidence-backed recall block
  - standing-wave summaries
  - branch warnings when facts conflict
- The recall block must include citations with atom IDs and timestamps so the answer can be traced to evidence.
- For `what did we discuss previously` style prompts, the system must answer from retrieved evidence first, not from free synthesis.

### 5. Application integration and migration
- Keep the current Bun/Elysia app, WebSocket flow, local Qwen/Gemma model stack, and browser UI as the host environment.
- The local models remain unchanged in role:
  - Qwen and Gemma are still the language cortex
  - the new memory brain supplies the recall package and evidence
- Add a compatibility bridge for legacy `matrix.crystal`:
  - one-time importer reads legacy ledger rows into `MemoryAtom` records with `modality='legacy_import'`
  - imported rows preserve original text, vector payload, and original timestamps when available
  - importer records a migration marker so the same legacy file is not re-imported repeatedly
  - after migration, all new writes go only to SQLite
- Add recall citations to the WebSocket `thought_processed` payload so the UI can display evidence sources later, even if v1 only surfaces the summary block.

## Interfaces and Behavior Changes

- Replace the old ledger-centric internal interface with a memory-brain service exposing:
  - `recordInteraction(input, metadata): MemoryAtom`
  - `consolidateAtom(atomId): void`
  - `probeMemory(query, metadata): ProbeResult`
  - `importLegacyLedger(path): ImportReport`
- Preserve the external WebSocket contract shape, but extend `thought_processed` responses with:
  - `memoryCitations`
  - `memoryMode`
  - optional `branchWarnings`
- Keep acoustic uplink enabled, but route it through `recordInteraction` using `modality='acoustic_summary'`.

## Test Plan

- Persistence and migration:
  - importing a non-empty legacy `matrix.crystal` creates canonical memory atoms without data loss
  - restarting the app preserves all memory atoms and standing waves
  - migration does not duplicate previously imported ledger rows
- Recall quality:
  - exact same question from a year-old event retrieves the original event with citation
  - paraphrased follow-up retrieves the correct prior discussion
  - timeline questions return dated evidence instead of generic synthesis
- Branch handling:
  - conflicting facts about the same topic create separate evidence branches
  - later queries surface the conflict instead of collapsing to one false certainty
- Consolidation:
  - repeated preferences reinforce one standing wave instead of creating duplicate canonical memories
  - open tasks remain recallable until explicitly resolved
- Acoustic behavior:
  - acoustic inputs create secondary memory atoms
  - acoustic atoms can be recalled as context, but do not override canonical factual branches
- Integration:
  - text and acoustic flows both return `thought_processed`
  - response payload includes citations and memory mode
  - local models still run through the same dual-brain generation path

## Assumptions and Defaults

- Single-user, local-only v1.
- This app remains the main host; no standalone service split in the first pass.
- SQLite is acceptable as the durability substrate; the novel technology is the memory model, consolidation, and probe-recall behavior.
- Deterministic extraction is authoritative in v1; LLM-assisted consolidation is supplemental.
- Acoustic input remains a secondary modality.
- Existing Qwen/Gemma local inference remains in place as the language layer.
