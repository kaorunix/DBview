# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Always respond in Japanese.

## Commands

### Development
```bash
npm run tauri dev      # Start Tauri app in development mode (launches Vite dev server + Rust binary)
npm run dev            # Start only the Vite frontend dev server (localhost:1420)
npm run build          # TypeScript check + Vite build (frontend only)
npm run tauri build    # Full production build (frontend + Rust binary + app bundle)
```

### Type Checking
```bash
npx tsc --noEmit      # Run TypeScript type check without emitting files
```

There is no test framework or linter configured in this project.

## Architecture

DBview is a Tauri 2 desktop app: React/TypeScript frontend + Rust backend, communicating over Tauri's IPC bridge.

### Frontend → Backend Communication
Frontend calls Rust functions via `invoke()` from `@tauri-apps/api/core`:
```ts
import { invoke } from "@tauri-apps/api/core";
const result = await invoke("command_name", { arg: value });
```

Backend commands are defined in [src-tauri/src/lib.rs](src-tauri/src/lib.rs) with `#[tauri::command]` and registered in the Tauri builder via `generate_handler![command_name]`.

### Key Directories
- `src/` — React/TypeScript frontend (entry: `main.tsx`, main component: `App.tsx`)
- `src-tauri/src/` — Rust backend (`lib.rs` defines commands, `main.rs` is the binary entry point)
- `src-tauri/capabilities/` — Tauri security permissions model (defines what the window can access)
- `src-tauri/tauri.conf.json` — App config: identifier, window size, build commands, CSP

### Adding a New Tauri Command
1. Define function in `src-tauri/src/lib.rs` with `#[tauri::command]`
2. Register it in `generate_handler![...]` inside `run()`
3. Call it from the frontend with `invoke("function_name", { ... })`

### TypeScript Config
Strict mode is enabled with `noUnusedLocals` and `noUnusedParameters` — unused variables are compile errors.
