# ai-research

Local Bun app for experimenting with a "Virtual Crystal" WebSocket interface, vector-style memory, a Three.js dashboard, and local GGUF inference through `node-llama-cpp`.

## Setup

```bash
bun install
```

Environment defaults are documented in `.env.example`. The local `.env` in this workspace already uses the active dual-model paths and runtime ledger path.

Download the two expected local models:

```bash
bun run download:qwen
bun run download:gemma
```

By default the app expects:

- `models/Qwen2-0.5B-Instruct-Q4_K_M.gguf`
- `models/gemma-4-E2B-it-Q4_K_M.gguf`

You can override those paths with `QWEN_MODEL_PATH` and `GEMMA_MODEL_PATH`.

## Run

```bash
bun run dev
```

The app listens on:

- HTTP dashboard: `http://localhost:3000`
- WebSocket stream: `ws://localhost:3000/stream`

## Checks

```bash
bun run typecheck
bun test
```

## Runtime Data

Live resonance memory is stored in `logs/matrix.crystal` by default. The root-level `matrix.crystal` file is treated as a legacy seed and is copied into `logs/` on first run if no runtime ledger exists.

Set `MATRIX_LEDGER_PATH` or `LEDGER_PATH` to use a different ledger path.
