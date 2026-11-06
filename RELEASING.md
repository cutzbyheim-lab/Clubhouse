# Releasing an update

Installed copies of Clubhouse update themselves from this repository's GitHub
Releases. To ship a new version:

1. Bump `version` in `package.json` (e.g. `0.3.0` → `0.3.1`).
2. Commit and push to `main`.

The **Release** workflow sees a version with no release yet, builds the
Windows installer on GitHub's Windows runner, runs the tests, and publishes
release `v0.3.1` with `Clubhouse-Setup-0.3.1.exe` and `latest.yml` (the file
the updater reads). Pushes that don't change the version build nothing.

Within a few hours (or on next launch) each installed copy downloads the
update in the background and shows **Restart to update** in the sidebar.
Quitting the app also installs it.

## Notes

- The repository must stay **public** so the updater can download releases
  without credentials. Player data never leaves the player's computer.
- The installer is unsigned, so Windows SmartScreen warns on first install
  ("More info → Run anyway"). Updates after that install silently. Signing
  needs a code-signing certificate configured in the workflow.
- The database lives in `%APPDATA%\Clubhouse`, outside the install folder;
  installs, updates and uninstalls leave it alone.
