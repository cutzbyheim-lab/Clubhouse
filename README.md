# Clubhouse

Desktop golf intelligence platform. Electron · React · TypeScript · SQLite.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design.

## Requirements

Node.js 22 or newer. No C++ toolchain is needed on Linux x64, macOS, or Windows:
the SQLite driver installs as a prebuilt binary matched to the bundled Electron.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies and fetches the matching native SQLite binary |
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Strict typecheck, then production build into `out/` |
| `npm run preview` | Runs the production build |
| `npm test` | Runs the test suite inside Electron's Node runtime |

## Version pinning

Electron and better-sqlite3 are pinned as a pair (`~42.11` / `12.11.1`)
because that is the newest pairing with an official prebuilt binary. Upgrading
Electron means first checking that better-sqlite3 publishes a prebuild for the
new Electron ABI; otherwise `npm install` falls back to compiling from source.

## Where data lives

`clubhouse.db` in the OS app-data folder (`~/.config/Clubhouse` on Linux,
`~/Library/Application Support/Clubhouse` on macOS, `%APPDATA%\Clubhouse` on
Windows). Set `CLUBHOUSE_DATA_DIR` to use another folder. A backup is written to
`backups/` before any schema migration runs on an existing database.
