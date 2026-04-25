# Chronicle Memory

Chronicle Memory is a local-first personal memory workspace built on Bun. It stores conversations and imported files in a SQLite memory brain, retrieves evidence-backed recall per workspace, and uses two local GGUF models to generate final responses.

## Product Shape

- Workspaces isolate personal and project memory.
- Conversations are stored as immutable memory atoms.
- Imported files become cited file-memory chunks.
- Recall returns evidence groups and conflict warnings instead of silent synthesis.
- Acoustic input is still available under Labs, but the core product path is chat plus file memory.

## Setup

```bash
bun install
```

Copy `.env.example` to `.env` if needed. The local env variables used by the app are:

- `PORT`
- `QWEN_MODEL_PATH`
- `GEMMA_MODEL_PATH`
- `MEMORY_BRAIN_PATH`
- `MATRIX_LEDGER_PATH` for optional one-time legacy import

Default model files:

- `models/Qwen2-0.5B-Instruct-Q4_K_M.gguf`
- `models/gemma-4-E2B-it-Q4_K_M.gguf`

Download helpers:

```bash
bun run download:qwen
bun run download:gemma
```

## Run

```bash
bun run dev
```

Set `PORT` if `3000` is already in use.

App endpoints:

- Dashboard: `http://localhost:3000`
- WebSocket stream: `ws://localhost:3000/stream`

HTTP product endpoints:

- `GET /api/bootstrap`
- `POST /api/workspaces`
- `POST /api/import`
- `POST /api/memory/feedback`

## Using The App

1. Start in the default `Personal` workspace or create a new workspace.
2. Import notes or source files from the header controls.
3. Ask about prior decisions, imported content, or earlier discussions.
4. Review the Evidence panel for citations and conflicts.
5. Use `Pin`, `Exclude`, or `Mark Wrong` on recalled memories.

Developer diagnostics stay behind `Developer Mode`. The Qwen and Gemma first-pass outputs are not part of the default product flow.

## Runtime Data

Canonical storage:

- `MEMORY_BRAIN_PATH` defaults to `./logs/memory-brain.sqlite`

Legacy import sources:

- `MATRIX_LEDGER_PATH`
- `LEDGER_PATH`
- root `matrix.crystal`
- `./logs/matrix.crystal`

Legacy ledger rows are imported once into SQLite and tracked there with migration markers.

## Checks

```bash
bun run typecheck
bun test
```
