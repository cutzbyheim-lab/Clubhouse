# CLUBHOUSE — Architecture

A desktop golf intelligence platform. Local-first: every byte of the player's data
lives in a SQLite file on their machine. No account, no cloud, no telemetry.

---

## 1. Guiding rules

1. **Never fabricate measured golf statistics.** A number shown as a *measurement*
   (carry, ball speed, score, putts, dispersion…) must trace back to a row the
   player recorded, imported, or explicitly loaded as sample data. Concretely:
   - Every measured row carries `source ∈ {manual, imported, sample}`.
   - Sample rows are badged in the UI and can be wiped in one action.
   - The intelligence engine only *derives* from stored rows. It never invents
     benchmarks ("tour average", "scratch golfer average") and never fills gaps
     with estimates presented as data. Missing data renders as an empty state
     that says what to record — not as a zero, not as a guess.
   - Derived values (averages, strokes-gained-style comparisons against the
     player's *own* baseline, dispersion ellipses) state their sample size `n`
     and are suppressed below a minimum `n`.
   - Equipment specs (loft, lie, length) are *player-entered*. Sample clubs are
     generic ("7 Iron"), never a real product with invented specs.
2. **The renderer is untrusted.** It has no Node, no filesystem, no SQL. It talks
   to the main process through one typed, Zod-validated IPC contract.
3. **One source of truth for shapes.** Zod schemas in `src/shared` define every
   entity and every IPC payload. TypeScript types are inferred from them; the
   same schema validates at the IPC boundary and before writes.
4. **Strict everywhere.** `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, no `any`.

---

## 2. Process model

```
┌──────────────────────── Electron main (Node) ────────────────────────┐
│  app lifecycle · BrowserWindow · menu                                │
│  db/        better-sqlite3 connection (WAL, FK on) + migrator        │
│  db/repositories/   one module per aggregate, prepared statements    │
│  services/  domain logic: stats, dispersion, gapping, insights       │
│  ipc/       handlers: validate input (Zod) → service → Result<T>     │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ ipcRenderer.invoke(channel, payload)
┌───────────────────── preload (contextIsolation) ─────────────────────┐
│  contextBridge exposes window.clubhouse.invoke<C>(channel, input)    │
└───────────────────────────────▲──────────────────────────────────────┘
                                │
┌──────────────────────── Renderer (React) ────────────────────────────┐
│  app shell · router · design system · Zustand stores                 │
│  modules/<feature>/  pages, components, hooks per module             │
└──────────────────────────────────────────────────────────────────────┘
```

### IPC contract

`src/shared/ipc/contract.ts` maps each channel to `{ input: ZodSchema, output: ZodSchema }`.
- Main: `handle(channel, fn)` parses input with the channel's schema; on failure it
  returns `{ ok: false, error: { code: 'VALIDATION', … } }` without touching the DB.
- Every handler returns `Result<T> = { ok: true; data: T } | { ok: false; error: AppError }`.
  Exceptions never cross the bridge raw.
- Renderer: `api.call('rounds.list', input)` is fully typed from the contract.
  A `useQuery`-style hook turns a call into `{ status: 'loading' | 'empty' | 'error' | 'ready' }`,
  which is what drives the loading / empty / error states in every module.

---

## 3. Data layer

- **Engine:** better-sqlite3 (synchronous, fast, transactional), rebuilt for
  Electron's ABI. File lives in `app.getPath('userData')/clubhouse.db`.
- **Pragmas:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Migrations:** ordered TypeScript modules in `db/migrations/NNNN_name.ts`, each
  `{ id, name, up(db) }`. The migrator records applied ids in `schema_migrations`,
  runs each pending migration in its own transaction, and refuses to start if
  the DB is ahead of the app (downgrade protection). A backup copy is written
  before migrating a non-empty DB.
- **Repositories** own SQL; services own logic; handlers own validation.
- **Units:** stored in SI-neutral canonical units (metres, m/s, degrees, rpm).
  Display units (yards/metres, mph/km/h) are a user setting applied at render.

Schema is defined in the next phase (`docs/SCHEMA.md` + migration `0001`).

---

## 4. Modules

| Module | Owns | Reads |
|---|---|---|
| Dashboard | layout of summary widgets | all (read-only summaries) |
| Digital Golf Bag | clubs in bag, bag configurations | equipment |
| Shot Analytics | shots, sessions, dispersion, per-club stats | clubs |
| Round Tracker | rounds, hole scores, per-hole stats | courses |
| Performance Lab | trends over time, own-baseline comparisons | rounds, shots |
| 3D Course Visualizer | course/hole geometry, shot overlays (Three.js) | courses, shots |
| Practice Center | practice plans, drills, logged practice | shots, insights |
| Equipment Lab | equipment inventory, specs, gapping analysis | clubs, shots |
| Intelligence Engine | rule-based insights with evidence + `n` | everything |

Each renderer module is self-contained under `src/renderer/src/modules/<name>/`
with an `index.ts` exporting its route definition, so the shell registers
modules without knowing their internals.

The **Intelligence Engine** is deterministic and explainable: each insight is a
rule over stored data that emits `{ title, detail, evidence: [{metric, value, n}], confidence }`.
No ML model, no external calls, nothing it can't show its working for.

---

## 5. Folder layout

```
clubhouse/
├─ electron.vite.config.ts      build for main / preload / renderer
├─ tsconfig.json                project references
├─ tsconfig.node.json           main + preload + shared (Node)
├─ tsconfig.web.json            renderer + shared (DOM)
├─ src/
│  ├─ shared/                   imported by both sides — no Node, no DOM
│  │  ├─ schemas/               Zod entity schemas
│  │  ├─ ipc/                   contract, Result type, error codes
│  │  ├─ domain/                pure golf math (units, dispersion, gapping)
│  │  └─ constants.ts
│  ├─ main/
│  │  ├─ index.ts               app entry
│  │  ├─ window.ts              BrowserWindow factory, security settings
│  │  ├─ paths.ts
│  │  ├─ db/  connection.ts · migrator.ts · migrations/ · repositories/ · seed/
│  │  ├─ services/
│  │  └─ ipc/                   handler registry + per-domain handlers
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx · App.tsx
│        ├─ app/                shell, sidebar, router, module registry
│        ├─ design/             tokens, primitives, state views
│        ├─ lib/                api client, formatters, useQuery
│        ├─ stores/             Zustand (UI + settings)
│        ├─ styles/globals.css  Tailwind v4 theme
│        └─ modules/            9 feature modules
└─ tests/                       Vitest: domain math, migrator, repositories
```

---

## 6. Security posture

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
strict CSP in `index.html`, navigation and `window.open` blocked, only the
preload's whitelisted channels reachable from the renderer.

## 7. Design language

Dark charcoal surfaces (`#111412` → `#1c201d`), forest-green accent
(`#2f6b45` / highlight `#5fae7c`), warm off-white text, restrained
brass for rare emphasis. Numbers set in a tabular monospace. Dense but calm —
a cockpit, not a scoreboard.
