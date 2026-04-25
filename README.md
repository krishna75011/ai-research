# ai-research

Local Bun app for experimenting with a memory-backed AI console. The browser sends typed prompts or live acoustic wave input over WebSocket, the backend probes a SQLite memory brain for evidence-backed recall, and two local GGUF models generate the final response.

## What Changed

- `logs/memory-brain.sqlite` is now the canonical long-term memory store.
- `matrix.crystal` is legacy input only. Existing ledger rows are imported once into the memory brain and then left alone.
- Every interaction is stored as immutable `MemoryAtom` records.
- Repeated patterns consolidate into `StandingWave` records.
- Conflicting claims are preserved as `EvidenceBranch` records instead of being overwritten.
- `thought_processed` WebSocket responses now include:
  - `memoryCitations`
  - `memoryMode`
  - `branchWarnings`

## Setup

```bash
bun install
```

Environment defaults live in `.env.example`.

Download the two expected local models:

```bash
bun run download:qwen
bun run download:gemma
```

Default model paths:

- `models/Qwen2-0.5B-Instruct-Q4_K_M.gguf`
- `models/gemma-4-E2B-it-Q4_K_M.gguf`

Override them with:

- `QWEN_MODEL_PATH`
- `GEMMA_MODEL_PATH`

## Run

```bash
bun run dev
```

Endpoints:

- HTTP dashboard: `http://localhost:3000`
- WebSocket stream: `ws://localhost:3000/stream`

## Checks

```bash
bun run typecheck
bun test
```

## Runtime Data

Primary runtime data:

- `MEMORY_BRAIN_PATH` defaults to `./logs/memory-brain.sqlite`

Legacy import sources:

- `MATRIX_LEDGER_PATH`
- `LEDGER_PATH`
- root `matrix.crystal`
- `./logs/matrix.crystal`

The importer records migration markers inside the SQLite store, so the same legacy ledger is not imported repeatedly.
