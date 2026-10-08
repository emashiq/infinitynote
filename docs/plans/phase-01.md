# Phase 01 plan: Secure desktop foundation and persistence

Planner: infinity-planner (Opus HIGH), 2026-10-08. Implementer: infinity-code-medium (Sonnet 5.5 MEDIUM), one pass. QA: infinity-qa. Acceptance: infinity-acceptor.

Status: ready. This plan is the implementer's single input. It settles the routine choices for Phase 01: layout, scripts, migration 001, IPC catalogue, security model, save and lease services, tests, the Linux leg and evidence.

Where this plan and an accepted contract disagree, the contract wins unless this plan names a decision that changes it (D-035 to D-043, already recorded in `docs/DECISIONS.md` by the planner). Precedence for the rest:

- The pack wins on scope.
- The root `CLAUDE.md` user decisions win on Python, WSL and commits.

---

## 1. Inputs read and actual repository state

Read:

- Pack: `CLAUDE.md`, `infinity-notes-claude-pack/phases/01-secure-desktop-foundation-and-persistence.md`, the pack's `PRODUCT_PLAN.md`, `ARCHITECTURE.md`, `TEST_MATRIX.md` and `roles/planner.md`.
- Accepted Phase 00 contracts: `docs/PRODUCT_SPEC.md`, `docs/UX_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` and `docs/BACKLOG.md` (Phase 01 IDs and W01).
- Phase 00 reports: `docs/progress/phase-00-acceptance.md` (follow-ups F-1 to F-9), `docs/progress/phase-00.md` and `docs/progress/phase-00-qa.md`.
- Tooling and state: `tools/check-traceability.mjs`, `.gitignore`, `.infinity-work/agent-status.json`.

Repository state (verified 2026-10-08):

- Branch `master`, commit `a775a4e Phase 00`, clean tree.
- No `package.json`, `src/`, `tests/`, lockfile or CI files.
- Windows host: Windows 11 Pro 10.0.26300, Node v24.15.0, npm 11.12.1, git autocrlf=true, no Python.
- WSL: Ubuntu 26.04.1 LTS, Node v24.21.0, npm 11.19.0, WSLg 1.0.73 (Weston). The only account was root until the planner created the user `infinity` (D-039).

### 1.1 Planner probes (evidence for this plan)

All probes ran in scratch directories outside the repository. The log is `.infinity-work/logs/phase-01/planner-probes.log`.

| Probe | Result |
| --- | --- |
| better-sqlite3 13.0.3 in Node 24.15 (Windows) and Node 24.21 (WSL) | SQLite 3.53.4, WAL, `ENABLE_FTS5`, JSON, FTS5 with `unicode61 remove_diacritics 2 categories 'L* N* Co M*'` matches Bangla `বাংলায়`, prefix match, BLOB 0..255 round trip, `db.backup()` copy readable, INTEGER PRIMARY KEY stable after VACUUM |
| Same inside Electron 44.7.0 main (Windows dev binary; WSL as user `infinity`) | identical pass (ABI 149, N-API 10). The prebuilt binary loads with no rebuild |
| electron-builder 26.15.3 `--win nsis --x64` with `npmRebuild:false`, `asarUnpack: ["**/*.node"]` | exit 0. NSIS installer plus `win-unpacked`, with the binary in `resources/app.asar.unpacked/.../prebuilds/win32-x64.node`. The packaged exe passed the same probe. Not signed (`NotSigned`) |
| electron-builder `--linux AppImage deb` in WSL | AppImage built. The `linux-unpacked` binary and the AppImage (`APPIMAGE_EXTRACT_AND_RUN=1`) passed the probe. **deb failed: "Please specify project homepage"**, so homepage and maintainer metadata are required (D-043) |
| node:sqlite in Electron 44 main | SQLite 3.53.4, FTS5 `categories` tokenizer, Bangla, BLOB pass; `backup` function present. The fallback is viable but not needed (D-038) |
| Renderer origin under the exact ARCHITECTURE section 14 CSP | `file://` page: fetch, XHR and `<img>` of arbitrary local files were **allowed**. `infinity-app://renderer/` page: all **blocked**; module scripts, same-origin fetch, CSP eval block and network block all work (D-035) |
| Electron as root in WSL | FATAL "Running as root without --no-sandbox is not supported". As user `infinity`: works, and the user-namespace sandbox works without SUID chrome-sandbox (D-039) |
| Default ozone under WSLg | `x11` (XWayland) because `XDG_SESSION_TYPE` is unset. `--ozone-platform=wayland` also works. Xvfb (`env -u WAYLAND_DISPLAY xvfb-run -a`) works |
| Migration 001 SQL exactly as in section 7.3, with better-sqlite3 13.0.3 | Applies in one transaction with `user_version`. FTS triggers: insert, update (old term gone, new term found), trash (gone), restore (found), revision-only update and hard delete all behave. `doc_key` stable after VACUUM, Bangla match after VACUUM, `integrity-check` ok. CHECKs reject an attachment path with `..` or backslash, rich+`content_text`, non-JSON settings and duplicate note_attachments (Probe R) |
| npm quirks | `npx --no electron-builder --win nsis ...` makes npm 11 swallow flags, so run CLIs via `node <cli path>`. Electron 44 has no postinstall (lazy download). npm 11.19 lists an implicit `node-gyp rebuild` install script for better-sqlite3, so `ignore-scripts=true` is used (D-038) |

### 1.2 Interpretation of the phase acceptance (explicit)

- "native-module rebuild works on the current host" becomes **"the prebuilt N-API better-sqlite3 binary loads without any source rebuild in Electron main"**. This must hold in three settings:
  - the development build;
  - the packaged unpacked app;
  - the Linux AppImage.
  
  It must hold on both hosts, Windows and WSL Ubuntu. The proof is the self-test report, plus a SHA-256 match between the packaged `.node` and the npm tarball copy, plus the absence of `node_modules/better-sqlite3/build/` (D-038). A source rebuild needs node-gyp and Python and is ruled out (D-031).
- The second OS is available (WSL2 Ubuntu 26.04 + WSLg). The Linux leg (section 16) is part of this phase. If one Linux step fails for environmental reasons, record it as `pending` with the exact error and continue. It never blocks the Windows work.
- `npm install` and `npm ci` must both pass. The lockfile is committed and `npm ci` is re-run from a deleted `node_modules` on Windows and in WSL.

---

## 2. Follow-ups from Phase 00 acceptance

| ID | Resolution in Phase 01 |
| --- | --- |
| F-1 | Section 14.1 restates every Phase 01 ID (INF-FND-01..13) as explicit assertions: action, expected result, failure case, test and host |
| F-2 | D-036: `notes.doc_key INTEGER PRIMARY KEY AUTOINCREMENT`; `notes_fts` external content `content_rowid='doc_key'`; trigger sync. ARCHITECTURE section 3 already updated by the planner. Tests in `tests/integration/migrations.test.ts` › "fts doc_key survives VACUUM" |
| F-3 | D-038: fallback not implemented because better-sqlite3 passes. If the implementation-time self-test fails on either host, implement the `node:sqlite` driver and pass the identical self-test (Electron main and Node integration). If both fail, the status is `blocked` |
| F-4 | D-037: override honored in packaged builds (absolute path only). Test hooks stay unpackaged-only. Tests: `tests/unit/app-paths.test.ts` and `tests/e2e/packaged.spec.ts` |
| F-5 | Extend `tools/check-traceability.mjs` (section 15.6): compare the PRODUCT_SPEC section 4 phase and requirement text per ID against BACKLOG. Negative test `tests/unit/traceability.test.ts` |
| F-6 | Done by the planner: BACKLOG W01-02 now references the DECISIONS "Pinned dependency table" |

There are no outstanding QA defects for Phase 01. The Phase 00 QA low issues were converted into F-1 to F-6.

---

## 3. Dependencies

### 3.1 Install (exact pins from the DECISIONS Pinned dependency table; yazl/yauzl wait for Phase 08)

Create `.npmrc` first (section 5.2), then run the following from the repository root on Windows:

```
npm install --save-exact better-sqlite3@13.0.3 zod@4.6.5 luxon@3.7.2
npm install --save-exact --save-dev electron@44.7.0 electron-vite@5.0.0 vite@7.3.7 @vitejs/plugin-react@5.2.0 react@19.3.0 react-dom@19.3.0 typescript@6.0.3 @tiptap/core@3.31.4 @tiptap/react@3.31.4 @tiptap/pm@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/extension-list@3.31.4 @tiptap/extension-unique-id@3.31.4 @tiptap/extension-image@3.31.4 @tiptap/extensions@3.31.4 @types/better-sqlite3@9.6.0 @types/luxon@3.7.6 chrono-node@2.10.2 dompurify@3.4.16 lucide-react@1.53.0 vitest@5.0.3 jsdom@30.1.2 @playwright/test@1.64.0 eslint@10.12.0 @eslint/js@10.0.1 typescript-eslint@8.71.1 eslint-plugin-react-hooks@7.1.1 globals@17.13.0 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@24.19.1 electron-builder@26.15.3
npm run setup:electron
npm ls --all            (must exit 0: no missing or invalid peers; never use --legacy-peer-deps or --force)
```

Classification rules:

- `dependencies` holds only modules that main loads at runtime. electron-vite externalizes them and electron-builder copies them into the asar: better-sqlite3, zod and luxon.
- Everything else is a `devDependency`. Renderer libraries are bundled by Vite (electron-vite guidance).
- Tiptap, chrono-node, dompurify and lucide-react are installed now so the whole dependency graph, peers included, is locked and verified once. They are unused until Phases 02, 03 and 06.

Lockfile:

- Generate it from a clean state (no `node_modules`, no lock) so optional platform packages for both OSes are recorded (`@rollup/rollup-linux-x64-gnu`, `@esbuild/linux-x64` and the others).
- Prove it with `rm -rf node_modules && npm ci` on Windows and `npm ci` in WSL.
- If WSL `npm ci` or `build` reports a missing optional native package, regenerate the lock from a clean state on Windows and retry once. If it still fails, record the exact error (risk R1-03).

Forbidden: `@electron/rebuild`, `node-gyp`, `electron-rebuild`, `@electron/remote`, any ORM, UI framework, network, telemetry or AI SDK, `electron-log`, Prettier. `tests/unit/app-identity.test.ts` asserts that none of them appears in `package.json`.

### 3.2 TypeScript 6.0 notes

- TS 6 defaults `types` to `[]`. List the types explicitly (`"types": ["node"]`, and in the web config add `vite/client` only if needed).
- Use `"moduleResolution": "bundler"` and `"module": "ESNext"`. Do not use `baseUrl` (deprecated). Use `strict: true` and `noUncheckedIndexedAccess: true`.

---

## 4. Directory layout and file boundaries

The implementer creates exactly this tree. Names are binding because tests and BACKLOG refer to them.

```
.gitattributes                      * text=auto eol=lf; *.png binary; *.ico binary
.npmrc                              ignore-scripts=true, engine-strict=true
.github/workflows/ci.yml            Windows + Ubuntu CI (written, never pushed)
package.json, package-lock.json
electron-builder.json
electron.vite.config.ts
eslint.config.mjs
playwright.config.ts
vitest.config.ts
tsconfig.json                       references tsconfig.node.json + tsconfig.web.json (files: [])
tsconfig.node.json                  src/main, src/preload, src/shared, tests/{unit,integration,e2e} excluding tests/unit/renderer/**, *.config.ts
tsconfig.web.json                   src/renderer, src/shared, tests/unit/renderer/** (lib DOM, jsx react-jsx)
resources/icon.png                  512x512 placeholder, generated by tools/make-icon.mjs (committed)
resources/icon.ico                  PNG-compressed ICO (256, 48, 32, 16), generated (committed)
src/shared/
  app-identity.ts                   APP_ID='com.infinitynotes.desktop', PRODUCT_NAME='Infinity Notes', NPM_NAME='infinity-notes', LINUX_EXECUTABLE='infinity-notes', RENDERER_SCHEME='infinity-app', RENDERER_HOST='renderer', ATTACHMENT_SCHEME='infinity-attachment'
  csp.ts                            PROD_CSP, DEV_CSP (exact strings, section 9.2)
  contracts/channel-names.ts        INVOKE_CHANNELS, EVENT_CHANNELS (string constants only; no zod; imported by preload)
  contracts/envelope.ts             ERROR_CODES (9), Result<T>, ErrorEnvelope {code,message,details?}
  contracts/ids.ts                  Uuid schema (lower-case canonical)
  contracts/app.ts                  AppInfo, StartupState, Capabilities schemas
  contracts/settings.ts             SETTINGS registry, SettingKey, SettingValue<K>, settings:get/set schemas, SettingsChangedEvent
  contracts/notes.ts                NoteSave*, Lease*, NoteRevisionEvent, NoteLeaseEvent, LeaseReleaseRequestEvent (Phase 03 wires IPC)
  contracts/channels.ts             schema map {channel: {request, response}} + event schema map
  contracts/bridge.ts               InfinityBridge TypeScript interface (window.infinity)
  text/plain-text.ts                extractPlainText(format, content)
src/main/
  index.ts                          bootstrap only (section 6); no business logic
  app-paths.ts                      resolveUserDataOverride, resolveDataPaths, assertNotInstallDir
  self-test-mode.ts                 --self-test handling (section 7.6)
  single-instance.ts
  test-hooks.ts                     enabled only when !app.isPackaged && INFINITY_NOTES_E2E==='1'
  menu.ts                           File>Quit, Edit roles, View>Reload/DevTools only when !isPackaged
  db/driver.ts                      Db interface (exec, prepare->{run,get,all}, transaction, pragma, backup, close, driverName, sqliteVersion)
  db/better-sqlite3-driver.ts       the only file importing better-sqlite3
  db/open-database.ts               probe -> open -> migrate -> pragmas; returns DbOpenResult
  db/migrate.ts                     runner (section 7.4)
  db/migrations/001_initial.sql
  db/migrations/index.ts            [{version:1, name:'initial', sql}] via import '...sql?raw'
  db/migrations/checksums.json      {"1":"<sha256 of LF-normalized 001_initial.sql>"}
  db/self-test.ts                   runSqliteSelfTest(tmpDir, opts) -> SelfTestReport
  db/repositories/settings-repo.ts
  db/repositories/notes-repo.ts     createNote (minimal), getNoteById (used by NoteWriter and tests; Phase 02 extends)
  services/clock.ts                 Clock {now(), monotonicNow()} + systemClock
  services/logger.ts                file logger userData/logs/main.log (rotate at 1 MB, keep main.1.log)
  services/settings-service.ts
  services/note-writer.ts           save-revision contract (section 11)
  services/lease-manager.ts         writer-lease contract (section 11)
  services/capabilities.ts          detectCapabilities(inputs) pure + collectCapabilityInputs()
  services/shell-adapter.ts         openPath wrapper; fake in test hooks
  services/network-guard.ts         decideRequest(url, devOrigin) pure + install(session)
  services/app-error.ts             AppError(code, message, details?)
  ipc/router.ts                     createIpcRouter (section 10.3)
  ipc/sender-policy.ts
  ipc/event-bus.ts                  broadcast(channel, payload) to registry windows
  ipc/handlers/app-handlers.ts      app:getInfo, app:showDataFolder, app:quit
  ipc/handlers/settings-handlers.ts settings:get, settings:set
  ipc/handlers/capabilities-handlers.ts capabilities:get
  windows/window-registry.ts
  windows/main-window.ts
  windows/web-security.ts           web-contents-created guards, permission handlers
  windows/renderer-protocol.ts      infinity-app scheme handler (pure createRendererHandler + register)
  windows/attachment-protocol.ts    infinity-attachment handler (pure createAttachmentHandler + register)
  windows/schemes.ts                registerSchemesAsPrivileged (called at module load, before ready)
  env.d.ts                          declare module '*.sql?raw'
src/preload/index.ts                contextBridge only; imports 'electron' and channel-names.ts only
src/renderer/
  index.html                        contains <!--CSP--> placeholder, <title>Infinity Notes</title>
  main.tsx, App.tsx, bridge.ts, env.d.ts
  shell/FoundationScreen.tsx        temporary Phase 01 screen (Phase 02 replaces)
  startup/StartupErrorScreen.tsx
  theme/theme.ts                    resolveTheme(setting, prefersDark), applyTheme(root, theme)
  styles/tokens.css, styles/base.css UX_SPEC section 3 tokens (light/dark), typography section 4
tests/unit/                         *.test.ts (+ renderer/*.test.tsx with jsdom)
tests/integration/                  *.test.ts (real better-sqlite3, temp dirs)
tests/e2e/                          fixtures.ts, *.spec.ts (Playwright _electron)
tools/
  check-traceability.mjs            (edit for F-5)
  finalize-docs.mjs                 (DO NOT TOUCH)
  lib/proc.mjs                      spawnNode(cliPath,args), killTree(pid), sha256File, withDisplay(cmd,args) (xvfb wrapper)
  make-icon.mjs, package.mjs, run-e2e.mjs, verify-native.mjs, dev-smoke.mjs
```

Import boundaries are enforced by ESLint `no-restricted-imports` and tested in `tests/unit/boundaries.test.ts`:

- `src/renderer/**` must not import `electron`, `node:*` or Node built-ins (`fs`, `path`, `child_process`, ...), `better-sqlite3`, or `src/main/**`. It may import `src/shared/**`.
- `src/preload/**` may import only `electron` and `src/shared/contracts/channel-names.ts`, plus type-only imports from `src/shared/contracts/*`. It must not import zod.
- `src/shared/**` must not import `electron`, Node built-ins, `better-sqlite3`, `src/main/**` or `src/renderer/**`.
- Only `src/main/db/better-sqlite3-driver.ts` may import `better-sqlite3`.

Do not touch any of the following:

- `infinity-notes-claude-pack/**`, `.claude/**`, `CLAUDE.md`, `tools/finalize-docs.mjs`
- `docs/PRODUCT_SPEC.md` (no edits in Phase 01)
- The existing `.gitignore` lines (append only if needed)
- The accepted D-001 to D-043 entries. New Phase 01 implementation decisions go in as D-044 onward, and only if needed.

---

## 5. Project configuration (exact)

### 5.1 package.json

```json
{
  "name": "infinity-notes",
  "productName": "Infinity Notes",
  "version": "0.1.0",
  "private": true,
  "description": "Offline notes, stickies and reminders for Windows and Linux.",
  "license": "UNLICENSED",
  "author": { "name": "Infinity Notes", "email": "noreply@infinity-notes.invalid" },
  "homepage": "https://infinity-notes.invalid/",
  "main": "out/main/index.js",
  "engines": { "node": ">=24.15.0 <25" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:e2e": "node tools/run-e2e.mjs",
    "test:e2e:packaged": "node tools/run-e2e.mjs --packaged",
    "check": "npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run check:traceability",
    "check:traceability": "node tools/check-traceability.mjs --repo .",
    "verify:native": "node tools/verify-native.mjs",
    "setup:electron": "node node_modules/electron/install.js",
    "package:current": "node tools/package.mjs current",
    "package:win": "node tools/package.mjs win",
    "package:linux": "node tools/package.mjs linux"
  },
  "dependencies": { "...": "exact pins from 3.1" },
  "devDependencies": { "...": "exact pins from 3.1" }
}
```

All 11 standard scripts are applicable by the end of Phase 01. Real status and non-zero exits come from these cases:

- `package:win` on Linux and `package:linux` on Windows exit 2 with a message naming the correct host (section 15.2).
- `test:e2e` on Linux with no display and no `xvfb-run` exits 1 with "No display available: run inside WSLg/a desktop session or install xvfb".
- `test:e2e:packaged` with no packaged build exits 1 with "No packaged build at <path>; run npm run package:current first".
- Vitest exits non-zero when a project matches no test files (do not set `passWithNoTests`).

No script is `echo`, `exit 0` or `true`. `tests/unit/scripts.test.ts` asserts this.

### 5.2 .npmrc, .gitattributes, .gitignore

- `.npmrc`: `ignore-scripts=true` and `engine-strict=true`. Do not set `legacy-peer-deps`.
- `.gitattributes`: `* text=auto eol=lf`, `*.png binary`, `*.ico binary`. This keeps the migration SQL checksum stable under `core.autocrlf=true`. The checksum test also normalizes CRLF to LF before hashing.
- `.gitignore`: already covers `node_modules/`, `out/`, `release/`, `test-results/`, `playwright-report/`, `coverage/` and `.infinity-work/`. No change is needed. Verify with `git status --porcelain` after the build, package and E2E runs, and log it in `win-gitstatus.log`.

### 5.3 electron.vite.config.ts

- `main`: input `src/main/index.ts`. `dependencies` are externalized by default (better-sqlite3 must never be bundled).
- `preload`: input `src/preload/index.ts`, `build.externalizeDeps: false`, `output.format: 'cjs'`. This is a sandboxed preload, so it is a single CJS file with only `electron` external.
- `renderer`: root `src/renderer`, input `src/renderer/index.html`, plugins `[react(), cspMeta()]`.
  - `cspMeta` is a `transformIndexHtml` plugin. It replaces `<!--CSP-->` with `<meta http-equiv="Content-Security-Policy" content="...">`, using `DEV_CSP` when serving and `PROD_CSP` when building.
  - If the placeholder is missing, it throws.
- No `package.json` `"type": "module"`, so main and preload are CJS.

### 5.4 electron-builder.json

```json
{
  "appId": "com.infinitynotes.desktop",
  "productName": "Infinity Notes",
  "copyright": "Infinity Notes local build",
  "directories": { "output": "release", "buildResources": "resources" },
  "files": ["out/**", "resources/icon.png", "package.json", "!**/*.map",
            "!node_modules/better-sqlite3/deps/**", "!node_modules/better-sqlite3/src/**"],
  "asarUnpack": ["**/*.node"],
  "npmRebuild": false,
  "nodeGypRebuild": false,
  "buildDependenciesFromSource": false,
  "publish": null,
  "win": { "target": [{ "target": "nsis", "arch": ["x64"] }], "icon": "resources/icon.ico",
           "artifactName": "Infinity-Notes-Setup-${version}-x64-unsigned.${ext}" },
  "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true,
            "createDesktopShortcut": true, "createStartMenuShortcut": true, "shortcutName": "Infinity Notes",
            "deleteAppDataOnUninstall": false },
  "linux": { "target": [{ "target": "AppImage", "arch": ["x64"] }, { "target": "deb", "arch": ["x64"] }],
             "executableName": "infinity-notes", "icon": "resources/icon.png", "category": "Office",
             "synopsis": "Offline notes, stickies and reminders",
             "maintainer": "Infinity Notes <noreply@infinity-notes.invalid>",
             "artifactName": "infinity-notes-${version}-${arch}-unsigned.${ext}" }
}
```

Fuses are not changed in Phase 01. The Phase 09 INF-SEC-02 review decides on them. Note: disabling `EnableNodeCliInspectArguments` would break Playwright control of the packaged app, so the packaged E2E would need another driver.

### 5.5 CI definition (`.github/workflows/ci.yml`, written locally, never pushed)

```yaml
name: ci
on:
  push:
    branches: [main, master]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build-test:
    name: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-2025, ubuntu-24.04]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24.15.0'
          cache: npm
      - run: npm ci
      - run: npm run setup:electron
      # Ubuntu 24.04 restricts unprivileged user namespaces via AppArmor; a root-owned SUID chrome-sandbox
      # keeps the Chromium sandbox enabled. Xvfb provides a virtual display (application logic only).
      - name: Linux prerequisites
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb
          sudo chown root:root node_modules/electron/dist/chrome-sandbox
          sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
      - run: npm run check
      - run: npm run build
      - run: npm run verify:native
      - run: npm run test:e2e
      - run: npm run package:current
      - name: Linux packaged sandbox helper
        if: runner.os == 'Linux'
        run: |
          sudo chown root:root release/linux-unpacked/chrome-sandbox
          sudo chmod 4755 release/linux-unpacked/chrome-sandbox
      - run: npm run verify:native -- --packaged
      - run: npm run test:e2e:packaged
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: infinity-notes-${{ matrix.os }}
          path: |
            release/*.exe
            release/*.AppImage
            release/*.deb
            release/artifacts.json
            test-results/
            playwright-report/
          if-no-files-found: warn
# Limitations: headless CI validates application logic only. Native notifications, tray, compositor
# window behavior and Windows toast identity need real desktop sessions (Phase 09 NATIVE_OS_MATRIX).
# Builds are unsigned local builds; nothing is published.
```

The WSL leg needs no SUID step: the user-namespace sandbox works there (D-039). In CI, the YAML is checked by `tests/unit/ci-config.test.ts` and by review. It is not executed in Phase 01.

### 5.6 Test runner configs

- `vitest.config.ts`: `test.projects` with two projects.
  - `unit`: include `tests/unit/**/*.test.{ts,tsx}`, environment `node`. Renderer files declare `// @vitest-environment jsdom`. Plugins `[react()]`.
  - `integration`: include `tests/integration/**/*.test.ts`, environment `node`, pool `forks`, `testTimeout: 30000`.
  - No `passWithNoTests`.
- `playwright.config.ts`: `testDir: 'tests/e2e'`, `workers: 1`, `fullyParallel: false`, `retries: 0`, `timeout: 90_000`, `expect.timeout: 10_000`, `outputDir: 'test-results'`, reporters `list` and `html` (`open: 'never'`), `use.trace: 'retain-on-failure'`. No browser projects are needed because `_electron` is used.
- `eslint.config.mjs`: flat config with `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react-hooks` recommended for `src/renderer/**`, `globals` (node for main, preload, tools and tests; browser for the renderer), the boundary rules from section 4, and `@typescript-eslint/no-explicit-any: error`.
  - Ignores: `out/**`, `release/**`, `node_modules/**`, `coverage/**`, `test-results/**`, `playwright-report/**`, `infinity-notes-claude-pack/**`, `tools/finalize-docs.mjs`, `.infinity-work/**`.

---

## 6. Main process startup sequence (`src/main/index.ts`)

Order matters. Each step is a call into a module from section 4.

1. `import './windows/schemes'`. Its module load calls `protocol.registerSchemesAsPrivileged` for:
   - `infinity-app` with `{standard:true, secure:true, supportFetchAPI:true}`;
   - `infinity-attachment` with `{standard:true, secure:true, supportFetchAPI:false, stream:true}`.
2. `app.enableSandbox()`. On win32, `app.setAppUserModelId(APP_ID)` (dev and packaged).
3. `resolveUserDataOverride(process.env.INFINITY_NOTES_USER_DATA_DIR)`. If it returns a path, `mkdirSync(recursive)` and `app.setPath('userData', p)`. Remember the warning for an invalid value (logged at step 6). See D-037.
4. If argv contains `--self-test`, go to `runSelfTestMode()` (section 7.6) and return. There is no lock, no window and no user database.
5. `if (!app.requestSingleInstanceLock()) { app.quit(); return; }`. On `second-instance`, restore the main window if it is minimized, show it, focus it, and log `second-instance received`.
6. `app.whenReady()`:
   1. Logger. Log the startup lines (section 12.2).
   2. `installWebSecurity()`: `web-contents-created` guards and session permission handlers.
   3. `installNetworkGuard(session.defaultSession, devOrigin)`.
   4. Register the `infinity-app` handler (built mode) and the `infinity-attachment` handler.
   5. `resolveDataPaths(app.getPath('userData'))`, `assertNotInstallDir(dataDir, path.dirname(process.execPath))` (packaged only), then mkdir `data`, `data/attachments/tmp`, `data/pre-migration` and `logs`.
   6. `openDatabase(...)` gives `startupState`, which is `ok` or one of `MIGRATION_FAILED`, `SCHEMA_TOO_NEW` or `DB_OPEN_FAILED`.
   7. Create the services (settings, capabilities; NoteWriter and LeaseManager are constructed but have no IPC).
   8. `nativeTheme.themeSource` from `appearance.theme` when the DB is ok.
   9. Register IPC handlers (always, so the error screen can call `app:*`).
   10. `Menu.setApplicationMenu(buildMenu())`.
   11. Install test hooks if enabled.
   12. Create the main window.
7. `window-all-closed` calls `app.quit()` (Phase 04 replaces this per D-027). `will-quit` closes the DB. Log `uncaughtException` and `unhandledRejection` without exiting silently.

Main window (`windows/main-window.ts`):

- Size and frame: `width 1100, height 720, minWidth 720, minHeight 480, title 'Infinity Notes', show:false` (shown on `ready-to-show`), `autoHideMenuBar:true`. On Linux, `icon` is `resources/icon.png`.
- `webPreferences`: `{ preload, contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true, allowRunningInsecureContent:false, experimentalFeatures:false, webviewTag:false, navigateOnDragDrop:false, spellcheck:false, safeDialogs:true }`.
- URL: `infinity-app://renderer/index.html#/`. Use the dev server URL only when `!app.isPackaged && process.env.ELECTRON_RENDERER_URL`.
- Register the window in `WindowRegistry` (role `main`). Remove it on `closed`.
- Log `renderer:loaded origin=<origin>` on `did-finish-load`.

---

## 7. Data, paths and migrations

### 7.1 Paths (D-014, D-037)

- `resolveUserDataOverride(raw)` returns `{dir}`, `{ignored: reason}` or `null` (unset). It rejects empty strings, relative paths and strings containing `\0`, and it normalizes accepted paths. It does not depend on `isPackaged`.
- `resolveDataPaths(userData)` returns:
  - `{ dataDir: <ud>/data, dbFile: <ud>/data/infinity-notes.sqlite3, attachmentsDir: <ud>/data/attachments, attachmentsTmp: <ud>/data/attachments/tmp, preMigrationDir: <ud>/data/pre-migration, logsDir: <ud>/logs }`
- `assertNotInstallDir(dataDir, installDir)` throws if `dataDir` is inside `installDir`, after `path.relative` containment and case-insensitive comparison on win32.

### 7.2 DB driver interface (`db/driver.ts`)

```ts
export interface Statement<P extends unknown[] = unknown[], R = unknown> { run(...p: P): { changes: number; lastInsertRowid: number | bigint }; get(...p: P): R | undefined; all(...p: P): R[] }
export interface Db {
  readonly driverName: 'better-sqlite3' | 'node:sqlite';
  readonly sqliteVersion: string;
  exec(sql: string): void;
  prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Statement<P, R>;
  transaction<T>(fn: () => T, mode?: 'deferred' | 'immediate'): T;   // rolls back on throw
  pragma(sql: string): unknown[];      // e.g. pragma('user_version')
  pragmaValue(sql: string): unknown;   // simple form
  backup(destFile: string): Promise<void>;
  close(): void;
}
export function openBetterSqlite(file: string, opts: { readonly?: boolean; fileMustExist?: boolean; timeoutMs?: number }): Db;
```

Repositories and services depend only on `Db`. If `@types/better-sqlite3@9.6.0` disagrees with the 13.x runtime, the wrapper owns the types and casts in exactly one place.

### 7.3 Migration 001 (`src/main/db/migrations/001_initial.sql`)

This content is binding. Comments may be added, but once the phase is accepted the file is frozen by its checksum.

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY NOT NULL CHECK (length(key) BETWEEN 1 AND 100),
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
  id             TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT
) STRICT;

CREATE TABLE folders (
  id             TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  project_id     TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  parent_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;
CREATE INDEX folders_parent  ON folders(parent_id);
CREATE INDEX folders_project ON folders(project_id);

CREATE TABLE notes (
  doc_key        INTEGER PRIMARY KEY AUTOINCREMENT,
  id             TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
  project_id     TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  folder_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  title          TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  format         TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  content_json   TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
  content_text   TEXT,
  plain_text     TEXT NOT NULL DEFAULT '',
  revision       INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  sticky_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sticky_enabled IN (0, 1)),
  color          TEXT,
  pinned_at      INTEGER,
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  trash_batch_id TEXT,
  CHECK ((format = 'rich' AND content_text IS NULL) OR (format = 'plain' AND content_json IS NULL))
) STRICT;
CREATE INDEX notes_scope   ON notes(project_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX notes_updated ON notes(updated_at) WHERE deleted_at IS NULL;
CREATE INDEX notes_pinned  ON notes(pinned_at) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX notes_sticky  ON notes(sticky_enabled) WHERE sticky_enabled = 1 AND deleted_at IS NULL;
CREATE INDEX notes_trash   ON notes(trash_batch_id) WHERE trash_batch_id IS NOT NULL;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, plain_text,
  content = 'notes', content_rowid = 'doc_key',
  tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'"
);
CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO notes_fts(rowid, title, plain_text) VALUES (NEW.doc_key, NEW.title, NEW.plain_text);
END;
CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes WHEN OLD.deleted_at IS NULL BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', OLD.doc_key, OLD.title, OLD.plain_text);
END;
-- One trigger so the delete of the old index entry always runs before the insert of the new one
-- (relative firing order of separate triggers is not something to rely on; a duplicate rowid corrupts FTS5).
CREATE TRIGGER notes_fts_au AFTER UPDATE OF title, plain_text, deleted_at ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, plain_text)
    SELECT 'delete', OLD.doc_key, OLD.title, OLD.plain_text WHERE OLD.deleted_at IS NULL;
  INSERT INTO notes_fts(rowid, title, plain_text)
    SELECT NEW.doc_key, NEW.title, NEW.plain_text WHERE NEW.deleted_at IS NULL;
END;

CREATE TABLE note_versions (
  id               TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  note_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL CHECK (revision >= 0),
  format           TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  content_snapshot TEXT NOT NULL,
  attachment_ids   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachment_ids)),
  reason           TEXT NOT NULL CHECK (reason IN ('auto', 'conversion', 'conflict', 'restore', 'import')),
  created_at       INTEGER NOT NULL
) STRICT;
CREATE INDEX note_versions_note ON note_versions(note_id, created_at);

CREATE TABLE note_drafts (
  id            TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  view_id       TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  format        TEXT NOT NULL CHECK (format IN ('rich', 'plain')),
  title         TEXT,
  content       TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('conflict', 'lease_lost')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER
) STRICT;
CREATE INDEX note_drafts_open ON note_drafts(note_id) WHERE resolved_at IS NULL;

CREATE TABLE attachments (
  id                    TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  managed_relative_path TEXT NOT NULL UNIQUE
    CHECK (managed_relative_path GLOB 'attachments/[0-9a-f][0-9a-f]/*'
           AND instr(managed_relative_path, '..') = 0
           AND instr(managed_relative_path, '\') = 0),
  sha256                TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  mime                  TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL CHECK (size_bytes >= 0),
  original_name         TEXT,
  kind                  TEXT NOT NULL CHECK (kind IN ('image', 'document')),
  created_at            INTEGER NOT NULL,
  unreferenced_since    INTEGER
) STRICT;

CREATE TABLE note_attachments (
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  block_id      TEXT
) STRICT;
CREATE UNIQUE INDEX note_attachments_unique ON note_attachments(note_id, attachment_id, ifnull(block_id, ''));
CREATE INDEX note_attachments_attachment ON note_attachments(attachment_id);
```

The runner sets `user_version`, so the SQL file must not. If SQLite rejects any statement (for example the backslash literal), the implementer fixes the SQL before acceptance, records the change in the progress report and regenerates `checksums.json`. After acceptance the file is frozen.

### 7.4 Migration runner (`db/migrate.ts`, `db/open-database.ts`), per D-040

1. `existed = file exists && size > 0`.
2. If it existed, open it with `{readonly:true, fileMustExist:true}` and read `user_version` and the user-table count, then close it.
   - Any open or read error (for example `SQLITE_NOTADB`) returns `DB_OPEN_FAILED`.
   - `user_version > LATEST` returns `SCHEMA_TOO_NEW`.
   - In both cases, return before any write.
3. Open read-write with `timeout: 5000` and set `foreign_keys = ON` and `synchronous = FULL`.
4. If `user_version < LATEST`:
   1. If it existed and has at least one table, `await db.backup(<preMigrationDir>/infinity-notes-v<from>-<yyyymmddTHHMMSSZ>.sqlite3)` and prune that directory to the newest 3.
   2. `db.transaction(() => { for each pending m: db.exec(m.sql); db.pragma('user_version = ' + m.version); fk = db.pragma('foreign_key_check'); if (fk.length) throw new MigrationError(...) }, 'immediate')`.
   3. On a throw: close, log `migration failed version=<v> error=<sqlite message>`, and return `MIGRATION_FAILED`.
5. After a successful migration (or when none is pending), set `journal_mode = WAL` and assert the result is `wal`. WAL is switched after migrating, so a failed migration on a rollback-journal file leaves it byte-identical.
6. Compute diagnostics: `sqliteVersion`, `fts5` (from `compile_options` containing `ENABLE_FTS5`), `json` (`json_valid('{}')=1`) and `schemaVersion`.
7. Return `{ok:true, db, schemaVersion, migratedFrom}`.

`migrations/index.ts` exports `LATEST = 1` and the ordered list. A test asserts the versions are contiguous from 1 and the checksums match. Tests inject extra migrations through a parameter of `migrateDatabase(db, migrations)`. There is no production test hook.

### 7.5 Settings (`settings-repo.ts`, `settings-service.ts`), per D-041

- Registry entry: `{ key: 'appearance.theme', version: 1, schema: z.enum(['system','light','dark']), default: 'system' }`. The registry type gives `SettingKey` and `SettingValue<K>`.
- `get(keys)` returns `Record<K, value>`. A missing row gives the default. A row that is not JSON, has the wrong `v` or fails the schema gives the default and logs `settings: invalid stored value key=<k>`. Nothing is rewritten on read.
- `set(key, value)` validates against the registry (unknown key or invalid value is `VALIDATION_FAILED`, nothing written), then `INSERT ... ON CONFLICT(key) DO UPDATE` with `{"v":1,"value":...}` and `updated_at = clock.now()`. After commit it emits `settings:changed {key, value, updatedAt}` through the injected emitter and returns the same.
- Main applies `appearance.theme` to `nativeTheme.themeSource` on startup and on change.

### 7.6 Self-test (`db/self-test.ts`, `self-test-mode.ts`)

`runSqliteSelfTest(tmpDir, {runtime})` returns `SelfTestReport { ok, driver, sqliteVersion, runtime:{electron?, node, modules, napi, platform, arch, isPackaged?}, loadedBinary?: string, checks: {...}, errors: string[] }`.

Each check is a boolean:

- `sqliteAtLeast3_45`
- `walMode`
- `compileOptionFts5`
- `json`
- `ftsCategoriesTokenizer`: the D-029 tokenizer table is created.
- `ftsBanglaMatch`: `'বাংলায়'` matches a body containing it.
- `ftsPrefixMatch`: `hel*`.
- `blobRoundTrip`: bytes 0..255, Buffer equality.
- `backupApi`: `db.backup()` to a file, reopened read-only, blob equal.
- `migrationsToLatest`: a fresh temp DB migrates to `LATEST`.
- `docKeyStableAfterVacuum`: insert two notes, delete the first, VACUUM, second `doc_key` unchanged and FTS still maps to it.
- `ftsIntegrity`: `INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')` succeeds.

Self-test mode (`--self-test`):

1. Requires `--self-test-report=<absolute path>`. If it is missing, write to stderr and exit 3.
2. If no `INFINITY_NOTES_USER_DATA_DIR` is set, set userData to a fresh `mkdtemp` directory before `ready`, so it never touches the real profile.
3. After `ready`, run the self-test in `mkdtemp(os.tmpdir(), 'infinity-selftest-')`.
4. `loadedBinary` is `require.resolve('better-sqlite3/package.json')`'s directory plus `prebuilds/<platform>-<arch>.node`, with `app.asar` replaced by `app.asar.unpacked` when packaged.
5. Write the JSON report, print one line `INFINITY_SELF_TEST {json}` to stdout, delete the temp directory, and call `app.exit(ok ? 0 : 1)`.

---

## 8. Attachment protocol skeleton (INF-FND-08)

`createAttachmentHandler({ db, dataDir })` is a pure function `(request: Request) => Promise<Response>`. It is registered with `protocol.handle('infinity-attachment', ...)`.

1. The method must be `GET`. Otherwise respond 405.
2. Parse with `new URL(request.url)`. The host must match the UUID regex (lower-case) and the pathname must be `''` or `'/'`. Search and hash are ignored. Otherwise respond 404.
3. Look up `SELECT managed_relative_path, mime, kind FROM attachments WHERE id = ?`. If there is no row, respond 404.
4. `kind` must be `image` and `mime` must be one of `image/png`, `image/jpeg`, `image/gif` or `image/webp`. Otherwise respond 404. Documents are never served inline.
5. `abs = path.resolve(dataDir, managed_relative_path)`. Require `path.relative(path.join(dataDir,'attachments'), abs)` to be non-empty, not start with `..` and not be absolute. Otherwise respond 404 and log `attachment: containment violation id=<id>`.
6. Read the file with `fs.promises.readFile` (attachments are small in Phase 01; Phase 03 may stream). If it is missing, respond 404.
7. Respond `200` with headers `Content-Type: <mime>`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'`.

Error responses have an empty body and never contain paths. Registration of real attachments arrives in Phase 03. In Phase 01 the tests seed rows directly.

---

## 9. Security model (INF-FND-03, INF-FND-04)

### 9.1 Window and web-contents guards (`windows/web-security.ts`)

- `app.on('web-contents-created', (_, wc) => { ... })` installs these on every web contents:
  - `will-navigate` and `will-redirect`: `preventDefault()` unless the target URL's scheme and host equal the window's own renderer origin (`infinity-app:` + `renderer`, or the dev origin in development). Log every block: `blocked navigation url=<scheme://host>`, without the path.
  - `setWindowOpenHandler(() => ({ action: 'deny' }))`, logged.
  - `will-attach-webview`: `preventDefault()`.
- `session.defaultSession`:
  - `setPermissionRequestHandler((_wc, _perm, cb) => cb(false))`
  - `setPermissionCheckHandler(() => false)`
  - `setDevicePermissionHandler(() => false)`
- `app.enableSandbox()` (section 6).

### 9.2 CSP (`src/shared/csp.ts`)

```
PROD_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
DEV_CSP  = PROD_CSP with script-src adding 'unsafe-inline' http://localhost:* and connect-src adding ws://localhost:* http://localhost:* (dev server and HMR only)
```

PROD_CSP is delivered in two ways:

- the index.html meta tag (build);
- the `Content-Security-Policy` response header on HTML served by the `infinity-app` handler.

`tests/unit/csp.test.ts` freezes PROD_CSP byte for byte against ARCHITECTURE section 14 and asserts that it contains no `'unsafe-eval'`.

### 9.3 Renderer protocol (`windows/renderer-protocol.ts`), per D-035

`createRendererHandler({ root })` serves `infinity-app://renderer/<path>`:

- The host must be `renderer`. An empty path or `/` maps to `index.html`.
- Decode the pathname. Reject `\0`. Resolve under `root`, using the same containment rule as in section 8.
- Allowed extensions and MIME types:

  | Extension | MIME type |
  | --- | --- |
  | `.html` | `text/html; charset=utf-8` |
  | `.js` | `text/javascript` |
  | `.css` | `text/css` |
  | `.json` | `application/json` |
  | `.png` | `image/png` |
  | `.svg` | `image/svg+xml` |
  | `.woff2` | `font/woff2` |
  | `.ico` | `image/x-icon` |

- Any other extension, a missing file or a containment failure gets 404.
- The file is read with `fs.promises.readFile`, which is asar-aware.

### 9.4 Network guard (`services/network-guard.ts`)

- `decideRequest(url, devOrigin)` is a pure function. It returns `cancel` for `http:`, `https:`, `ws:` and `wss:` unless the request's hostname and port equal those of `devOrigin` (development only). This covers the Vite HMR websocket `ws://localhost:<port>`. Everything else (`infinity-app:`, `infinity-attachment:`, `blob:`, `data:`, `devtools:`) is allowed.
- `install(session)` uses `webRequest.onBeforeRequest({urls:['<all_urls>']})`. Every cancel is logged as `network: blocked <origin>` and pushed to an in-memory list that only test hooks expose.

### 9.5 Test hooks (`src/main/test-hooks.ts`)

Test hooks are active only when `!app.isPackaged && process.env.INFINITY_NOTES_E2E === '1'`. They set `globalThis.__infinityTest = { blockedRequests: string[], shellCalls: {op:'openPath', path:string}[] }` and swap `ShellAdapter` for a recorder, so E2E never opens Explorer or Nautilus. There are no other hooks in Phase 01.

---

## 10. IPC (INF-FND-04)

### 10.1 Phase 01 catalogue (ARCHITECTURE section 4 already updated)

| Channel | Request (Zod, strict objects) | Response `data` | Errors |
| --- | --- | --- | --- |
| `app:getInfo` | `{}` | `AppInfo {name, version, isPackaged, unsignedBuild:true, platform, arch, versions:{electron, chrome, node}, sqlite:{driver, version, fts5, json} \| null, schemaVersion: number \| null, startup: {status:'ok'} \| {status:'error', code:'MIGRATION_FAILED'\|'SCHEMA_TOO_NEW'\|'DB_OPEN_FAILED'}}` (no filesystem paths) | none expected |
| `app:showDataFolder` | `{}` | `{opened: true}` | `UNSUPPORTED` with message when `shell.openPath` returns an error string |
| `app:quit` | `{}` | `{}` (main calls `app.quit()` on `setImmediate` after replying) | none |
| `settings:get` | `{keys: SettingKey[]}` (1..50, unique, registry keys only) | `{values: {[K]: SettingValue<K>}}` | `VALIDATION_FAILED`; `INTERNAL` "Storage is unavailable" when the DB is not open |
| `settings:set` | discriminated union on `key` built from the registry: `{key:'appearance.theme', value:'system'\|'light'\|'dark'}` | `{key, value, updatedAt}` | `VALIDATION_FAILED`, `INTERNAL` |
| `capabilities:get` | `{}` | `Capabilities` (section 12.1) | none |
| event `settings:changed` | n/a | `{key, value, updatedAt}` broadcast to every registry window after commit | n/a |

Phase 03 channels (`note:save`, `lease:*`) and their schemas exist in `src/shared/contracts/notes.ts`, but they are **not registered** in Phase 01. A unit test asserts that they are absent from `INVOKE_CHANNELS`, the router and the preload.

### 10.2 Envelope

The envelope is `{ok:true, data}` or `{ok:false, error:{code, message, details?}}`. Codes are exactly `VALIDATION_FAILED, NOT_FOUND, CONFLICT, LEASE_REQUIRED, CYCLE, LIMIT_EXCEEDED, UNSUPPORTED, FORBIDDEN, INTERNAL`. Messages are short, user-safe English and never include paths, SQL or stack traces.

### 10.3 Router (`ipc/router.ts`)

`createIpcRouter({ ipcMain: IpcMainLike, senderPolicy, logger, validateResponses: boolean })` returns `{ register(def), dispose() }`. Here `IpcMainLike = { handle(ch, fn), removeHandler(ch) }`, so tests use a fake.

Per call, in this order:

1. Sender policy. If it fails, return `FORBIDDEN` and log `ipc: forbidden sender channel=<c>`.
2. Payload size. If `Buffer.byteLength(JSON.stringify(payload ?? null)) > def.maxPayloadBytes ?? 5 MiB`, return `LIMIT_EXCEEDED`.
3. Zod parse of the request. On failure, return `VALIDATION_FAILED`. The message names the first issue path (for example `keys.0`) and never echoes values.
4. Call the handler.
5. When `validateResponses` (true when `!app.isPackaged`), check the response schema. A mismatch returns `INTERNAL` and is logged.
6. A thrown `AppError` returns its code, message and details. Any other throw returns `INTERNAL` "Something went wrong" and the stack is logged.

`register` refuses channels that are not in `INVOKE_CHANNELS`, and refuses duplicates.

### 10.4 Sender policy (`ipc/sender-policy.ts`)

A call is allowed only when all of these hold:

- `event.senderFrame` exists;
- `event.senderFrame.parent === null` (top-level frame);
- `windowRegistry.has(event.sender.id)`;
- the frame URL parses, and either:
  - `url.protocol === 'infinity-app:' && url.host === 'renderer'`, or
  - in development with a dev origin, `url.origin === devOrigin`.

WHATWG `URL.origin` is `"null"` for non-special schemes, so compare protocol and host, never `origin`, for the custom scheme.

### 10.5 Preload surface (`src/preload/index.ts`)

```ts
window.infinity = Object.freeze({
  app: Object.freeze({ getInfo(), showDataFolder(), quit() }),
  settings: Object.freeze({ get({keys}), set({key, value}) }),
  capabilities: Object.freeze({ get() }),
  subscribe(channel: EventChannel, cb: (payload) => void): () => void
})
```

- Each method calls `ipcRenderer.invoke(<fixed channel>, payload)` and resolves to the envelope. Nothing throws on business errors.
- `subscribe` throws `Error('Unknown event channel')` for names not in `EVENT_CHANNELS` (Phase 01: `['settings:changed']`) and for a non-function callback. The wrapper passes only `payload` and never the `IpcRendererEvent`. It returns an unsubscribe function that calls `removeListener`.
- No generic `invoke`, `send` or `on` is exposed.
- `src/shared/contracts/bridge.ts` declares the `InfinityBridge` type, and `src/renderer/env.d.ts` declares `window.infinity: InfinityBridge`.

---

## 11. Save-revision and writer-lease contracts and services (INF-FND-13)

These are implemented in main and integration-tested in Phase 01. Phase 03 registers the IPC channels and builds the UI. See ARCHITECTURE section 6 and D-042.

Contracts (`src/shared/contracts/notes.ts`):

- `NoteSaveRequest = strictObject({ noteId: Uuid, viewId: Uuid, leaseToken: Uuid, baseRevision: int >= 0, requestId: Uuid, title?: string max 200, format: 'rich'|'plain', content: RichDoc | string })`, with these refinements:
  - `format` `rich` requires an object `{type:'doc', content?: unknown[]}` (loose object).
  - `plain` requires a string.
- `NoteSaveAck = {noteId, revision, requestId, updatedAt}`.
- `ConflictDetails = {currentRevision, draftId, reason:'stale'|'trashed'}`.
- `LeaseRequiredDetails = {draftId?: Uuid}`.
- `LeaseAcquireRequest {noteId, viewId}` returns `{granted:true, leaseToken} | {granted:false, holderViewId}`.
- `LeaseReleaseRequest {noteId, viewId, leaseToken}` returns `{released:boolean}`.
- `LeaseTakeRequest {noteId, viewId}` returns `{leaseToken}`.
- Events:
  - `note:revision {noteId, revision, sourceViewId}`
  - `note:lease {noteId, holderViewId: Uuid|null}`
  - `lease:release-request {noteId}`
- `MAX_CONTENT_BYTES = 5 * 1024 * 1024` applies to the serialized content.

`LeaseManager` (`services/lease-manager.ts`) takes deps `{ ids, clock, requestRelease(holder:{viewId, webContentsId}, noteId), emit(NoteLeaseEvent), takeTimeoutMs = 3000 }`.

- `acquire(noteId, viewId, wcId)`: grants when the note is free. When the requester already holds the note, it returns the same token. Otherwise it returns `{granted:false, holderViewId}`.
- `release(noteId, viewId, token, wcId)`: the token must match. On release it emits `note:lease {holderViewId:null}` and resolves any pending take.
- `take(noteId, viewId, wcId): Promise<{leaseToken}>`:
  - If the requester is already the holder, it resolves to its own token.
  - If the note is free, it grants immediately.
  - Otherwise it calls `requestRelease(holder)` and waits for `release` or for `takeTimeoutMs`. Either way it revokes the holder's token (remembered as revoked), grants a new token to the requester and emits `note:lease`.
  - A second `take` for the same note while one is pending throws `AppError('CONFLICT', 'Edit control is already being transferred')`.
- `verify(noteId, viewId, token, wcId)` returns `'ok' | 'lost' | 'forbidden'`.
- `webContentsDestroyed(wcId)`: releases every lease held by views bound to `wcId`, resolves pending takes waiting on them, and drops those view bindings.
- Binding rule: the first use of a `viewId` binds it to `wcId`. Any later call with that `viewId` from another `wcId` returns `forbidden` (`acquire`, `release` and `take` throw `AppError('FORBIDDEN')`).

`NoteWriter.save(req, {webContentsId})` (`services/note-writer.ts`) takes deps `{ db, leases, clock, ids, emit(NoteRevisionEvent), extract = extractPlainText }`.

1. If the serialized content is larger than `MAX_CONTENT_BYTES`, throw `LIMIT_EXCEEDED` and write nothing.
2. `leases.verify(...)`:
   - `forbidden`: throw `FORBIDDEN` (no draft; it is a spoof).
   - `lost`: if the note exists, insert a draft (`lease_lost`) and throw `LEASE_REQUIRED {draftId}`. If the note does not exist, throw `NOT_FOUND`.
3. If `requestId` is in the note's recent-ack LRU (100 per note, in memory), return the cached ack. There is no write and no event.
4. Run `db.transaction(..., 'immediate')`:
   1. Load the note by `id`. If it is missing, throw `NOT_FOUND`.
   2. If `deleted_at` is set, insert a draft (`conflict`) and return a conflict result with `reason 'trashed'`.
   3. If `revision !== baseRevision`, insert a draft (`conflict`) and return a conflict result with `reason 'stale'`.
   4. Otherwise update `content_json` or `content_text` according to the format (the other one is NULL), `plain_text = extract(format, content)`, `title` if provided, `revision = revision + 1` and `updated_at = clock.now()`. The FTS index updates through triggers in the same transaction.
5. After commit:
   - On a conflict result, throw `CONFLICT {currentRevision, draftId, reason}`. The draft is committed.
   - On success, remember the ack, `emit(note:revision {noteId, revision, sourceViewId: viewId})` exactly once, and return the ack.

`extractPlainText(format, content)` (`src/shared/text/plain-text.ts`):

- `plain`: CRLF to LF, returned unchanged otherwise.
- `rich`: depth-first walk, up to depth 200. `text` nodes contribute `text`. `hardBreak` contributes `\n`. Block nodes (`paragraph`, `heading`, `blockquote`, `codeBlock`, `listItem`, `taskItem`, `bulletList`, `orderedList`, `taskList`) are separated by `\n`. Unknown nodes recurse into `content`. The result is trimmed of trailing newlines.

---

## 12. Capabilities and logging

### 12.1 `capabilities.ts` (W01-14 skeleton)

`detectCapabilities(inputs)` is a pure function. Its inputs are `{platform, ozonePlatform, xdgSessionType, waylandDisplay, display, wslDistro, wslgVersion}`.

It returns `Capabilities`:

```
{
  platform: 'win32'|'linux'|'other',
  environment: 'windows'|'wslg'|'linux-desktop'|'unknown',
  sessionType: 'windows'|'wayland'|'x11'|'unknown',
  ozonePlatform: string|null,
  windowPositioning, alwaysOnTop, tray, nativeNotifications, notificationActions, launchAtLogin, globalShortcut
}
```

Each capability field is `{status:'supported'|'unsupported'|'unknown', reason: string}`.

Rules:

- **win32**: `windowPositioning` and `alwaysOnTop` are `supported`.
- **Linux with ozone `wayland`, or under WSL**: both are `unsupported`, reason `wayland-or-wslg`. ARCHITECTURE section 5 treats WSLg as Wayland.
- **Linux X11, not WSL**: `windowPositioning` is `supported` (reason `window-manager-may-adjust`) and `alwaysOnTop` is `unknown`.
- **`notificationActions`** is always `unsupported` (D-026).
- **`tray`, `nativeNotifications`, `launchAtLogin`, `globalShortcut`** are `unknown`, reason `detected-in-later-phase`. Never report `supported` without detection.

`collectCapabilityInputs()` reads:

- `app.commandLine.getSwitchValue('ozone-platform')`;
- the environment;
- `WSL_DISTRO_NAME`;
- the first line of `/mnt/wslg/versions.txt` if it exists.

### 12.2 Logging

The log file is `<userData>/logs/main.log`, UTF-8 and one line per event: `ISO-timestamp level message`. At startup, if the file is over 1 MB, rename it to `main.1.log`, replacing any older one. In development, lines are mirrored to the console.

Required lines:

- `startup app=0.1.0 electron=<v> chrome=<v> node=<v> platform=<p> arch=<a> packaged=<bool> userDataOverride=<on|off>`
- `display ozone=<switch> hint=<switch> XDG_SESSION_TYPE=<v|unset> WAYLAND_DISPLAY=<set|unset> DISPLAY=<v|unset> wsl=<distro|no> wslg=<version|no>` (all platforms; Linux values matter for R-09)
- `db open driver=better-sqlite3 sqlite=<v> schema=<n> migratedFrom=<n> preMigrationCopy=<yes|no>` or `db startup error code=<CODE> detail=<sqlite message>`
- `renderer:loaded origin=<origin>`
- `second-instance received`
- `network: blocked <origin>`, `blocked navigation url=<origin>`, `blocked window.open`, `ipc: forbidden sender channel=<c>`, `settings: invalid stored value key=<k>`

Note content, setting values other than theme, and full paths of user files are never logged. The data directory may be logged relative to userData.

---

## 13. Renderer UX behavior (Phase 01 only)

- `App.tsx` calls `app:getInfo` once.
  - While it is pending, render nothing visible except `<main aria-busy="true">`.
  - If `startup.status === 'error'`, render `StartupErrorScreen`. Otherwise render `FoundationScreen`.
- `StartupErrorScreen` is full-window and centered. It uses the UX_SPEC section 6 copy exactly:

  | Code | Heading text |
  | --- | --- |
  | `MIGRATION_FAILED` | "Database upgrade failed; your data was not changed" |
  | `SCHEMA_TOO_NEW` | "This notebook was created by a newer version of Infinity Notes. Your data was not changed." |
  | `DB_OPEN_FAILED` | "Infinity Notes could not open its database. Your data was not changed." |

  - The heading is an `<h1>` inside `role="alert"`.
  - It has two buttons, "Show data folder" (`app:showDataFolder`) and "Quit" (`app:quit`). Initial focus is on "Show data folder".
  - If `showDataFolder` returns an error, show its message inline in `role="status"`.
- `FoundationScreen` is temporary. Phase 02 replaces it, and the theme control moves to Settings > Appearance per D-041. It shows:
  - `<h1>Infinity Notes</h1>` and the text "Version 0.1.0".
  - A storage status line, "Storage ready (SQLite <version>)".
  - An "Appearance" section: `<fieldset><legend>Theme</legend>` with three radio inputs labeled "System", "Light" and "Dark", bound to `appearance.theme`.
  - Changing a radio calls `settings:set`. On `ok`, it applies the theme. On an error, it reverts the selection and shows the message in `role="status"`.
  - It subscribes to `settings:changed` and unsubscribes on unmount.
- Theme: `resolveTheme(setting, matchMedia('(prefers-color-scheme: dark)').matches)` returns `light` or `dark`, which is set as `document.documentElement.dataset.theme`. The media query listener updates it while the setting is `system`.
- Tokens: `styles/tokens.css` implements the UX_SPEC section 3 light and dark values as CSS variables on `:root[data-theme=light|dark]`. Use the section 4 typography and a 2 px accent focus ring with a 2 px offset. Respect `prefers-reduced-motion` (no transitions).
- Use no external fonts or images.

---

## 14. Tests

### 14.1 Explicit assertions per requirement ID (F-1)

Hosts: **W** means the Windows 11 host. **L** means WSL Ubuntu 26.04 + WSLg as user `infinity`. "L-xvfb" means the same host under `env -u WAYLAND_DISPLAY xvfb-run -a`.

| ID | Action or input | Expected | Failure case asserted | Test file › case | Hosts |
| --- | --- | --- | --- | --- | --- |
| INF-FND-01 | Launch the built app, wait for the foundation screen, relaunch | `__infinityTest.blockedRequests` is empty after startup and relaunch. Renderer `fetch('https://example.com')` rejects. Main `net.fetch('https://example.com/')` rejects and the URL appears in `blockedRequests` (guard active, nothing reaches the network) | Any http/https/ws request during startup fails the test. package.json has none of the forbidden packages (section 3.1) | e2e/smoke.spec › no network requests; unit/network-guard.test › decideRequest; unit/app-identity.test › forbidden dependencies | W, L, L-xvfb |
| INF-FND-02 | With app A running and its window hidden (`win.hide()` via evaluate), spawn a second Electron process with the same userData | Process B exits with code 0 within 15 s. A's main window is visible and not minimized. A's `main.log` contains `second-instance received`. Only one window exists | B staying alive or A's window staying hidden fails. N part (real desktop focus behavior) stays pending for the Phase 09 matrix | e2e/smoke.spec › second instance focuses first | W, L |
| INF-FND-03 | Evaluate in the renderer | `typeof require`, `typeof process` and `typeof module` are `'undefined'`. The CSP meta content equals `PROD_CSP`. An injected inline `<script>` does not run. `eval('1')` throws. `location.href='https://example.com/'` and `location.href='file:///'` leave the URL at `infinity-app://renderer/...`. `window.open('https://example.com')` returns `null` and the window count stays 1. `Notification.requestPermission()` resolves `'denied'`. `navigator.permissions.query({name:'geolocation'})` state is `'denied'`. Main reads `webContents.getLastWebPreferences()` and checks `contextIsolation:true, nodeIntegration:false, sandbox:true` | Any of these succeeding fails the test | e2e/security.spec › renderer has no node/require; › CSP enforced; › navigation blocked; › window.open denied; › permissions denied; › web preferences hardened; unit/csp.test | W, L |
| INF-FND-04 | Bridge and router behavior | The deep key set of `window.infinity` is exactly `{app:[getInfo,quit,showDataFolder], capabilities:[get], settings:[get,set], subscribe}` and the object is frozen. `subscribe('note:revision')` throws "Unknown event channel". `settings.set({key:'appearance.theme', value:'neon'})` returns `VALIDATION_FAILED`. `settings.set({key:'x.y', value:1})` returns `VALIDATION_FAILED`. A 6 MiB value returns `LIMIT_EXCEEDED`. `settings.get({keys:["appearance.theme'; DROP TABLE settings;--"]})` returns `VALIDATION_FAILED` and the `settings` table is still intact after quit. Router with a fake ipcMain: `https://evil.example/` sender, `file:///` sender, subframe sender and unregistered webContents each give `FORBIDDEN`, and the handler is not called. A handler throwing `Error('/secret/path')` gives `INTERNAL` with a message not containing `/secret`. Renderer `fetch('file:///<temp secret.txt>')`, XHR and `<img src=file://...png>` all fail | Any leak fails the test | unit/contracts.test; integration/ipc-validation.test; e2e/security.spec › bridge surface; › validation errors; › renderer cannot read files; unit/boundaries.test (ESLint forbids electron, node, better-sqlite3 and main imports in the renderer) | W, L |
| INF-FND-05 | (a) Fresh userData. (b) A pre-existing rollback-journal DB at `user_version 0` with `CREATE TABLE notes(legacy TEXT)` and one row. (c) A DB at `user_version 99`. (d) A file of 4096 random bytes. (e) An injected failing migration 002 on a v1 WAL DB | (a) Schema v1, all 9 tables plus `notes_fts`, `journal_mode wal`, `foreign_keys 1`, `synchronous 2`. (b) The screen shows the exact MIGRATION_FAILED copy with Show data folder and Quit. "Show data folder" records `openPath(<ud>/data)`. "Quit" exits the process. Afterwards the file SHA-256 is unchanged, `user_version 0`, no `settings` or `projects` table, the legacy row is intact, and there is exactly one file in `data/pre-migration/`, which is openable and contains the legacy row. (c) SCHEMA_TOO_NEW copy, SHA-256 unchanged, no `-wal` file, no pre-migration copy. (d) DB_OPEN_FAILED copy, bytes unchanged. (e) Throws `MigrationError(version 2)`, `user_version` stays 1, no table from 002, pre-migration copy made. Four failing attempts leave only 3 copies. A migration producing a foreign-key violation rolls back | Any partial schema, a changed user file or a missing error screen fails the test | integration/migrations.test › fresh; › failure rolls back; › conflict leaves no partial schema; › newer schema refused unchanged; › foreign key violation rolls back; › pre-migration retention 3; unit/migrations-checksum.test; e2e/migration-failure.spec › upgrade failure screen; › newer schema; › unreadable database | W, L |
| INF-FND-06 | Select "Dark" in the foundation screen, quit, relaunch with the same userData | Before relaunch, `html[data-theme=dark]`. After relaunch, "Dark" is checked and `data-theme=dark`. The DB row `appearance.theme` equals `{"v":1,"value":"dark"}` with `updated_at > 0`. Tampering the row to `{"v":1,"value":"neon"}` and relaunching gives "System" checked plus the log line `settings: invalid stored value key=appearance.theme`. Integration covers: defaults, unknown key, invalid value with no write, one `settings:changed` emitted per set, `updatedAt` from the injected clock, and persistence across close and reopen | Setting lost after relaunch, or a crash on a bad stored value, fails the test | e2e/smoke.spec › setting survives relaunch; › invalid stored setting falls back; integration/settings.test | W, L |
| INF-FND-07 | Launch with `INFINITY_NOTES_USER_DATA_DIR=<tmp>` | `app.getPath('userData') === <tmp>`. `<tmp>/data/infinity-notes.sqlite3` and `<tmp>/logs/main.log` exist, and the log has `userDataOverride=on`. Packaged: the same holds, nothing named `data` is created next to the exe, and `globalThis.__infinityTest` is undefined even with `INFINITY_NOTES_E2E=1` | Unit: relative, empty and NUL values are ignored with a reason, and the result is the same for `isPackaged` true and false. `assertNotInstallDir` throws for a data dir inside the install dir (case-insensitive on win32) | unit/app-paths.test; e2e/smoke.spec › temp userData used; e2e/packaged.spec › override honored, hooks absent | W, L |
| INF-FND-08 | Seed attachment rows and files after the first launch, then relaunch | `<img src="infinity-attachment://<pngId>">` loads (naturalWidth 2). The following all fail to load: an unknown UUID, `infinity-attachment://<pngId>/../../infinity-notes.sqlite3`, `infinity-attachment://not-a-uuid`, `%2e%2e%2f`-encoded paths, and a PDF row (`kind document`). Integration against the handler: 200 with headers `nosniff`, `no-store` and the MIME type. 404 for an unknown ID, a non-UUID host, a non-root path, a document kind and a missing file. 405 for POST. Inserting `managed_relative_path='attachments/ab/../../x'` violates the CHECK. `resolveContained` rejects `..`, absolute and sibling-prefix paths (`attachments-evil/`) | Any served path outside `data/attachments` fails the test | integration/protocol.test › unknown id 404, traversal rejected; e2e/security.spec › attachment protocol | W, L |
| INF-FND-09 | Run every script | All 11 standard scripts exist and none is a placeholder. `package:linux` on Windows and `package:win` on Linux exit 2 with a message naming the host. `node tools/package.mjs bogus` exits 2. `npm run dev` reaches `renderer:loaded origin=http://localhost` (dev-smoke). Every gate has a log with `EXIT=<code>` | A script that prints success without doing work fails the test | unit/scripts.test; review of the logs in section 18 | W, L |
| INF-FND-10 | Read `.github/workflows/ci.yml` | The matrix is `windows-2025` and `ubuntu-24.04`. Steps: `npm ci`, `npm run setup:electron`, a Linux xvfb and sandbox prerequisite step that keeps the sandbox (no `--no-sandbox`), `npm run check`, `npm run build`, `npm run verify:native`, `npm run test:e2e`, `npm run package:current`, `npm run verify:native -- --packaged`, `npm run test:e2e:packaged`, `actions/upload-artifact`, and an explicit headless-limitations comment. `permissions: contents: read`. No publish step | The string `--no-sandbox` anywhere, or a publish token, fails the test | unit/ci-config.test (string and structure assertions) plus R review. Not pushed | W |
| INF-FND-11 | Inspect config | `electron-builder.json` `appId === APP_ID === 'com.infinitynotes.desktop'`, `productName === 'Infinity Notes'`, `linux.executableName === 'infinity-notes'`. `package.json` name and version match D-013. `resources/icon.png` is a PNG of 512x512 (IHDR read). `resources/icon.ico` has a valid ICO header with a 256 entry. Main calls `app.setAppUserModelId(APP_ID)` on win32. `release/win-unpacked/Infinity Notes.exe` exists after packaging | Mismatched identity fails the test. N part (toast shows "Infinity Notes" with the packaged identity) stays pending for Phases 05 and 09 | unit/app-identity.test; R review | W |
| INF-FND-12 | `npm run verify:native` (dev), `npm run verify:native -- --packaged` and `-- --appimage` (Linux) | The report `ok:true`, every check true, `driver better-sqlite3`, `sqliteVersion 3.53.4`, `runtime.electron 44.7.0`, `modules 149`. Packaged: `loadedBinary` contains `app.asar.unpacked`, the packaged `.node` SHA-256 equals the `node_modules` prebuild SHA-256, and `node_modules/better-sqlite3/build` is absent. App diagnostics (`app:getInfo().sqlite`): `{driver:'better-sqlite3', fts5:true, json:true}` and `schemaVersion 1` | A false check or a rebuilt binary fails the test. If it fails on a host, use the D-038 fallback path | integration/sqlite-capabilities.test (Node, same `runSqliteSelfTest`); e2e/smoke.spec › db diagnostics; e2e/native.spec › self-test passes in Electron main; tools/verify-native.mjs logs | W, L |
| INF-FND-13 | Service-level calls with a real DB | See section 14.3 (revision.test) | A stale save overwriting content, or lost text, fails the test | unit/contracts.test › note:save schema, lease schemas; integration/revision.test; integration/lease.test | W, L |

### 14.2 Unit tests (`tests/unit/`, Vitest project `unit`)

| File | Cases |
| --- | --- |
| `contracts.test.ts` | note:save valid rich and plain; rejects non-UUID noteId, negative baseRevision, missing requestId, unknown key (strict), title over 200, rich with a string, plain with an object; lease request and response schemas; `ERROR_CODES` equals the 9 codes; the envelope shape; every `INVOKE_CHANNELS` entry has request and response schemas and vice versa; `EVENT_CHANNELS` equals `['settings:changed']`; no Phase 03 channel is in `INVOKE_CHANNELS`; every settings registry default passes its own schema; the `settings:set` union rejects an unknown key |
| `csp.test.ts` | PROD_CSP exact string; no `unsafe-eval`; DEV_CSP differs only by the localhost additions |
| `network-guard.test.ts` | Cancels `http`, `https`, `ws` and `wss`; allows `infinity-app`, `infinity-attachment`, `blob`, `data` and `devtools`; allows the dev server `http://localhost:5173` and its HMR `ws://localhost:5173` only when a dev origin is given; rejects a near-match host (`http://localhost.evil:5173`) and a different port |
| `app-paths.test.ts` | Section 14.1 INF-FND-07 unit cases |
| `capabilities.test.ts` | win32; Linux Wayland; Linux X11 non-WSL; WSLg with ozone x11 (still unsupported positioning); `notificationActions` always unsupported; later-phase fields `unknown` |
| `plain-text.test.ts` | Plain CRLF; rich nested lists, headings and hardBreak; Bangla text preserved; depth limit (a 300-deep nesting does not throw and is truncated); empty doc |
| `migrations-checksum.test.ts` | Versions contiguous from 1; `LATEST === 1`; SHA-256 of LF-normalized `001_initial.sql` equals `checksums.json` |
| `app-identity.test.ts` | Section 14.1 INF-FND-11 cases; forbidden dependencies absent; `.npmrc` contains `ignore-scripts=true`; builder `npmRebuild:false`, `nodeGypRebuild:false`, `asarUnpack` contains `**/*.node`, `publish:null` |
| `scripts.test.ts` | The 11 standard scripts plus `check:traceability`, `verify:native`, `setup:electron` and `test:e2e:packaged` exist; none matches `/^\s*(echo\|exit\s+0\|true)\b/`; referenced `tools/*.mjs` files exist; spawning `node tools/package.mjs <wrong-os-target>` gives exit 2 and output naming the required host; `bogus` gives exit 2 |
| `ci-config.test.ts` | Section 14.1 INF-FND-10 assertions on the YAML text |
| `boundaries.test.ts` | ESLint `lintText` with the repository config: renderer importing `electron`, `node:fs`, `fs`, `better-sqlite3` or `../main/db/driver` produces `no-restricted-imports` errors; preload importing `zod` errors; shared importing `electron` errors; a renderer importing `../shared/contracts/app` is clean |
| `traceability.test.ts` | Copy `docs/*.md` and `docs/plans/phase-00.md` to a temp repo. The unmodified copy exits 0. Changing one PRODUCT_SPEC phase cell (INF-FND-01 `01` to `02`) exits 1 with `FAIL product-spec-phase`. Changing BACKLOG requirement text exits 1 with `FAIL product-spec-text` |
| `renderer/startup-error.test.tsx` (jsdom) | For each of the 3 codes: exact heading copy, two buttons with accessible names, `role="alert"`, initial focus on "Show data folder"; clicking calls the bridge mock |
| `renderer/theme.test.ts` (jsdom) | `resolveTheme` matrix; `applyTheme` sets `data-theme` |

### 14.3 Integration tests (`tests/integration/`, Vitest project `integration`, real better-sqlite3 in Node, `mkdtemp` per test, cleaned in `afterEach`)

| File | Cases |
| --- | --- |
| `sqlite-capabilities.test.ts` | `runSqliteSelfTest` returns `ok:true` with every check true in Node; `driver` is better-sqlite3; version at least 3.45 |
| `migrations.test.ts` | INF-FND-05 (a) to (e) at service level; FTS triggers: insert gives MATCH, title update removes the old term and adds the new one, soft delete gives no match, restore gives a match, hard delete gives no match, Bangla body match; `fts doc_key survives VACUUM`; `integrity-check` passes after the sequence; CHECK constraints: attachment traversal path rejected, rich with `content_text` rejected, settings non-JSON rejected; reopening a v1 DB makes no pre-migration copy and no change |
| `settings.test.ts` | Section 14.1 INF-FND-06 integration cases |
| `paths.test.ts` | `resolveDataPaths` layout; the directory creation helper is idempotent; the DB file lands under `<ud>/data` |
| `protocol.test.ts` | Section 14.1 INF-FND-08 handler cases with real rows and files; renderer-protocol handler: `index.html` served with the CSP header, `/assets/x.js` served as `text/javascript`, `/../package.json` and `%2e%2e/` give 404, an unknown extension gives 404, a wrong host gives 404 |
| `ipc-validation.test.ts` | Router with a fake ipcMain, a fake registry and fake events: valid call returns `ok`; invalid payload gives `VALIDATION_FAILED` without calling the handler; the four forbidden sender kinds; the dev origin is accepted only with the dev flag; a 5 MiB + 1 payload gives `LIMIT_EXCEEDED`; `AppError` pass-through with details; generic error gives `INTERNAL` with no leak; a response-schema mismatch gives `INTERNAL` when `validateResponses`; registering a non-catalogue channel throws; a duplicate registration throws; `dispose` removes handlers |
| `revision.test.ts` | Acquire, then save base 0, gives revision 1, the ack, `plain_text` set and an FTS match; stale base gives `CONFLICT {currentRevision:1, reason:'stale'}`, the content is unchanged, and the draft row holds the submitted content and title; a duplicate `requestId` returns the identical ack, the revision stays the same and only one event is emitted; a save to a trashed note gives `CONFLICT reason 'trashed'` plus a draft; an over-limit save gives `LIMIT_EXCEEDED` with no rows written; a temp trigger `RAISE(ABORT)` on `title='boom'` gives `INTERNAL` with revision and content unchanged and no event; a `note:revision` event is emitted exactly once on success and never on conflict |
| `lease.test.ts` | Acquire, free; second view gets `{granted:false, holderViewId}`; acquire by the holder is idempotent; take with the holder releasing gives the new token and the old token verifies `lost`; a save with the old token gives `LEASE_REQUIRED` plus a `lease_lost` draft; take with a silent holder (fake timers, 3000 ms) revokes and grants; `webContentsDestroyed` frees the lease and resolves the pending take; a viewId reused from another webContents gives `FORBIDDEN`; a concurrent second take gives `CONFLICT`; `note:lease` events in order |

### 14.4 E2E (`tests/e2e/`, Playwright `_electron`, built app, `workers: 1`)

`fixtures.ts`:

- `makeUserDataDir()` creates `mkdtemp(os.tmpdir(), 'infinity-e2e-')`. Cleanup uses `fs.rm({recursive:true, force:true, maxRetries:10, retryDelay:200})`.
- `launchApp({userDataDir, extraEnv})`:
  - env: `{...process.env, INFINITY_NOTES_USER_DATA_DIR, INFINITY_NOTES_E2E:'1'}`, minus `ELECTRON_RENDERER_URL` and `ELECTRON_RUN_AS_NODE`.
  - args: `[repoRoot, ...splitArgs(INFINITY_NOTES_E2E_ELECTRON_ARGS)]`. In packaged mode use `executablePath = INFINITY_NOTES_PACKAGED_EXE` with no repository argument.
  - Returns `{app, page}`, where `page` is from `app.firstWindow()` once the h1 or alert is visible.
- `readMainLog()`.
- `openDb(file, {readonly})` uses better-sqlite3 from the test process.

| Spec | Cases |
| --- | --- |
| `smoke.spec.ts` | starts a real window with temp userData (title "Infinity Notes", h1 visible); temp userData used; db diagnostics; setting survives relaunch; invalid stored setting falls back; second instance focuses first; no network requests; Linux only: `main.log` has a `display ozone=` line (value recorded in the progress report) |
| `security.spec.ts` | renderer has no node/require; CSP enforced; navigation blocked; window.open denied; permissions denied; web preferences hardened; bridge surface; validation errors; renderer cannot read files; attachment protocol |
| `migration-failure.spec.ts` | upgrade failure screen (fixture b, including the Show data folder record and the Quit exit); newer schema (fixture c); unreadable database (fixture d) |
| `native.spec.ts` | self-test passes in Electron main: spawn the Electron binary with `[repoRoot, '--self-test', '--self-test-report=<tmp>/r.json']` and assert section 14.1 INF-FND-12 |
| `packaged.spec.ts` (tagged `@packaged`, run only by `test:e2e:packaged`) | Launch the packaged exe with temp userData: window, `app:getInfo().isPackaged === true`, sqlite diagnostics, theme persists across relaunch, override honored and hooks absent, no `data` directory next to the exe |

---

## 15. Tools (`tools/*.mjs`, dependency-free, run with `process.execPath`, never through a shell or npx)

### 15.1 `lib/proc.mjs`

- `run(cmd, args, {env, cwd, timeoutMs})` resolves `{code, stdout, stderr}`.
- `nodeCli(relPath)` resolves CLI paths under `node_modules`:
  - `electron-vite/bin/electron-vite.js`
  - `electron-builder/cli.js`
  - `@playwright/test/cli.js`
  
  Verify these paths after install and adjust them if a package differs.
- `killTree(pid)` uses `taskkill /PID <pid> /T /F` through `spawn` with an argument array on win32, and kills the process group on Linux.
- `sha256File(path)`.
- `ensureDisplay(argv)`: on Linux, if neither `DISPLAY` nor `WAYLAND_DISPLAY` is set, re-exec under `xvfb-run -a` when it exists. Otherwise exit 1 with the "No display available" message.

### 15.2 `package.mjs <current|win|linux> [--dir]`

1. Map `current` to the host.
2. `win` requires `process.platform === 'win32'`. Otherwise print "package:win builds the Windows NSIS installer and must run on Windows (this host: <platform>). Linux packages are built with package:linux in the WSL ext4 copy." and exit 2.
3. `linux` requires `linux`. Otherwise print "package:linux must run on Linux (use the WSL copy at /home/infinity/infinity-notes; this host: <platform>)." and exit 2.
4. Unknown targets: print the usage and exit 2.
5. Run `electron-vite build`.
6. Run `electron-builder` with `--win nsis --x64 --publish never` or `--linux AppImage deb --x64 --publish never`, or `--dir` for unpacked only.
7. Write `release/artifacts.json` (`[{file, bytes, sha256}]` for `.exe`, `.AppImage` and `.deb`) and print it.
8. Exit with the builder's code.

### 15.3 `run-e2e.mjs [--packaged] [-- <playwright args>]`

1. `ensureDisplay`.
2. Unless `--packaged`, run `electron-vite build`.
3. Packaged: locate the exe (`release/win-unpacked/Infinity Notes.exe` or `release/linux-unpacked/infinity-notes`). If it is missing, exit 1 with the message from section 5.1. Set `INFINITY_NOTES_PACKAGED_EXE`.
4. Run Playwright `test`, with `--grep-invert @packaged` normally or `--grep @packaged` when packaged, passing extra arguments through.
5. Exit with Playwright's code.

### 15.4 `verify-native.mjs [--packaged|--appimage]`

1. `ensureDisplay`.
2. Dev mode: run the build if `out/main/index.js` is missing or older than `src`, then use `require('electron')` (the executable path) with `[repoRoot, '--self-test', '--self-test-report=<tmp>/report.json']`.
3. Packaged: use the unpacked exe. AppImage (Linux): use the `release/*.AppImage` with `APPIMAGE_EXTRACT_AND_RUN=1`.
4. Set the env `INFINITY_NOTES_USER_DATA_DIR=<tmp>/ud` and unset `ELECTRON_RUN_AS_NODE`. Timeout 90 s.
5. Assert exit 0, `report.ok`, every check true, and that `node_modules/better-sqlite3/build` is absent.
6. Packaged and AppImage: assert that `loadedBinary` includes `app.asar.unpacked` (for the AppImage, the extracted path), and compare the SHA-256 of the packaged `prebuilds/<platform>-<arch>.node` with `node_modules/better-sqlite3/prebuilds/<platform>-<arch>.node`.
7. Print a summary JSON and exit 0 or 1.

### 15.5 `dev-smoke.mjs`, `make-icon.mjs`

- `dev-smoke.mjs`:
  1. Spawn `electron-vite dev` with a temp `INFINITY_NOTES_USER_DATA_DIR`.
  2. Poll `<tmp>/logs/main.log` for `renderer:loaded origin=http://localhost` for up to 120 s.
  3. Kill the process tree and exit 0 if the line was seen, else exit 1. Always print the tail of the log.
- `make-icon.mjs`: deterministic generation with `zlib` and a CRC32 written in JS.
  - Output 1: `resources/icon.png`, 512x512 RGBA. The image is a rounded square in accent `#6A5AE0` with a white lemniscate stroke.
  - Output 2: `resources/icon.ico` with PNG-compressed entries at 256, 48, 32 and 16.
  - Running it twice produces identical bytes. Commit both outputs.

### 15.6 `check-traceability.mjs` (F-5 extension; keep every existing check unchanged)

Add check 3b, `product-spec-phase`:

1. Parse every PRODUCT_SPEC line that starts with `| INF-` and has exactly 4 cells (`ID | Requirement | Acceptance criterion | Phase`).
2. A duplicate ID gives `FAIL product-spec-table`.
3. For each BACKLOG ID:
   - A missing PRODUCT_SPEC row gives `FAIL product-spec-phase: <id> missing`.
   - A phase difference gives `FAIL product-spec-phase: <id> spec <p1> backlog <p2>`, or `WARN` with `--allow-phase-moves`.
   - A requirement text difference (whitespace-normalized) gives `FAIL product-spec-text: <id>`.
4. A PRODUCT_SPEC ID missing from BACKLOG gives a `FAIL`.

The SUMMARY line is unchanged in format.

---

## 16. Linux leg (WSL2 Ubuntu 26.04 + WSLg, user `infinity`; D-039)

Run every command as `wsl -d Ubuntu -u infinity -- bash -lc '<cmd>'`. From Git Bash, prefix with `MSYS_NO_PATHCONV=1` so `/mnt/...` paths are not rewritten. Log to `/mnt/e/notecapt/.infinity-work/logs/phase-01/wsl-<name>.log` using `cmd > log 2>&1; echo "EXIT=$?" >> log`. Start each log with the command, the date and `pwd`.

```
# environment record (wsl-env.log)
lsb_release -ds; uname -r; ldd --version | head -1; node -v; npm -v; id; cat /mnt/wslg/versions.txt; echo "WAYLAND_DISPLAY=$WAYLAND_DISPLAY DISPLAY=$DISPLAY XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset}"
# sync (wsl-sync.log); re-run before every Linux round
mkdir -p ~/infinity-notes && rsync -a --delete --exclude=node_modules/ --exclude=out/ --exclude=release/ --exclude=.git/ --exclude=.infinity-work/ --exclude=test-results/ --exclude=playwright-report/ --exclude=coverage/ /mnt/e/notecapt/ ~/infinity-notes/
cd ~/infinity-notes
export WAYLAND_DISPLAY=/mnt/wslg/runtime-dir/wayland-0
npm ci                                   # wsl-npm-ci.log
npm run setup:electron                   # wsl-setup-electron.log
npm run check                            # wsl-check.log
npm run build                            # wsl-build.log
npm run verify:native                    # wsl-verify-native-dev.log
npm run test:e2e                         # wsl-test-e2e-wslg.log   (WSLg session; record ozone from main.log)
env -u WAYLAND_DISPLAY -u DISPLAY npm run test:e2e   # wsl-test-e2e-xvfb.log (run-e2e wraps xvfb-run -a)
INFINITY_NOTES_E2E_ELECTRON_ARGS=--ozone-platform=wayland npm run test:e2e -- tests/e2e/smoke.spec.ts   # wsl-test-e2e-wayland.log (informational: WSLg Wayland column)
npm run package:linux                    # wsl-package-linux.log (AppImage + deb, artifacts.json)
npm run verify:native -- --packaged      # wsl-verify-native-packaged.log
npm run verify:native -- --appimage      # wsl-verify-native-appimage.log
npm run test:e2e:packaged                # wsl-test-e2e-packaged.log
npm run package:win                      # wsl-package-win-refusal.log (expect EXIT=2)
```

Rules:

- Never copy or share `node_modules` between the hosts.
- Never run Electron as root, and never pass `--no-sandbox`.
- Do not install apt packages. xvfb, fakeroot and dpkg-deb are already present. If a step proves a package missing, record it as a blocker of that step only, add a D-044 entry with the justification, and ask the coordinator. Do not install it silently.
- Installing the `.deb` (needs root `dpkg -i`) belongs to Phase 09 (INF-PKG-02). Phase 01 only builds it and checks `dpkg-deb --info` (logged in `wsl-deb-info.log`).
- Label results "WSLg 1.0.73 (Weston), ozone <value>". Never label them GNOME or an X11 session.
- If a Linux step fails for an environmental reason (not a code defect), record it as `pending` with the exact error and continue the Windows work.

The `test:e2e:wayland` run is informational and not a gate. A code defect found on Linux is a defect and must be fixed.

---

## 17. Work order for the single implementer pass (green incrementally)

At each step, run the listed commands and keep the log before moving on. Logs go to `.infinity-work/logs/phase-01/` (section 18).

1. **Scaffold and install.**
   - Create `.npmrc`, `.gitattributes`, `package.json` (scripts and metadata), the tsconfigs, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `electron.vite.config.ts`, `src/shared/app-identity.ts`, `src/shared/csp.ts` and empty entry points that compile.
   - Run the install commands from section 3.1, then `npm run setup:electron` and `npm ls --all`.
   - **Early Linux check:** sync to WSL and run `npm ci`. This catches lockfile and optional-dependency problems now (R1-03).
2. **Shared contracts, text extraction and unit tests.** Green: `npm run lint`, `npm run typecheck`, `npm run test:unit`.
3. **DB layer.**
   - Write the driver, migration 001 plus checksums, the runner, `open-database`, the self-test, the settings repo and service, the notes repo, the LeaseManager and the NoteWriter.
   - Write the integration tests for sqlite-capabilities, migrations, settings, paths, revision and lease.
   - Green: `npm run test:integration`.
4. **Main process.**
   - Write the paths, logger, schemes, renderer and attachment protocols (plus `protocol.test.ts`), web security, network guard, router, sender policy and handlers (plus `ipc-validation.test.ts`), window registry, main window, menu, single instance, self-test mode, capabilities and test hooks.
   - Write the preload and the renderer (App, FoundationScreen, StartupErrorScreen, theme, tokens) plus the renderer unit tests.
   - Green: `npm run check`, `npm run build`, `node tools/dev-smoke.mjs`.
5. **E2E.** Write `fixtures.ts` and the smoke, security, migration-failure and native specs, plus `run-e2e.mjs` and `verify-native.mjs`. Green on Windows: `npm run test:e2e`, `npm run verify:native`.
6. **Packaging.** Write `make-icon.mjs` (run it, commit the icons), `electron-builder.json`, `package.mjs` and `packaged.spec.ts`. Run in order:
   1. `npm run package:current`
   2. `npm run verify:native -- --packaged`
   3. `npm run test:e2e:packaged`
   4. `npm run package:linux` (expect exit 2)
7. **CI, scripts and traceability.**
   - Write `.github/workflows/ci.yml` and the `ci-config`, `scripts`, `app-identity`, `boundaries` and `traceability` tests.
   - Make the F-5 checker change.
   - Update BACKLOG Phase 01 statuses and planned-test names (section 19.2).
   - Green: `npm run check`.
8. **Linux leg.** Run section 16 in full.
9. **Final gate on Windows from clean.**
   1. `rm -rf node_modules out release test-results playwright-report`
   2. `npm ci`
   3. `npm run setup:electron`
   4. `npm run check`
   5. `npm run build`
   6. `npm run test:e2e`
   7. `npm run verify:native`
   8. `npm run package:current`
   9. `npm run verify:native -- --packaged`
   10. `npm run test:e2e:packaged`
   11. `git status --porcelain` (no ignored output listed; no stray files)
   
   Then write `docs/progress/phase-01.md`.

Stop conditions, which the progress report must state honestly:

- **Self-test fails on a host:** apply the D-038 fallback (`node:sqlite` driver, identical self-test). If both drivers fail, set the status to `blocked`.
- **Playwright cannot drive Electron 44:** record the exact error and set the status to `blocked`. There is no browser-only substitute.
- **Windows NSIS build fails** for an environmental reason (for example a symlink privilege error while extracting `winCodeSign`):
  1. Run `node tools/package.mjs current --dir` to still prove packaged loading.
  2. Record the NSIS failure as an open issue with the exact error.
  3. Do not set `signAndEditExecutable:false` without a D-044 entry.

The commit belongs to the coordinator after acceptance.

---

## 18. Logs (`.infinity-work/logs/phase-01/`)

Every log starts with `# <command>`, an ISO date, the host and the cwd, and ends with `EXIT=<code>`.

| Log | Content |
| --- | --- |
| `planner-probes.log` | Planner evidence (exists) |
| `win-env.log` | `node -v`, `npm -v`, `git --version`, OS build |
| `win-npm-install.log`, `win-setup-electron.log`, `win-npm-ls.log` | Step 1 |
| `win-lint.log`, `win-typecheck.log`, `win-test-unit.log`, `win-test-integration.log`, `win-check.log` | Steps 2 to 4 and 7 |
| `win-build.log`, `win-dev-smoke.log` | Step 4 |
| `win-test-e2e.log`, `win-verify-native-dev.log` | Step 5 |
| `win-package-current.log` (includes `artifacts.json`), `win-verify-native-packaged.log`, `win-test-e2e-packaged.log`, `win-package-linux-refusal.log` | Step 6 |
| `win-traceability.log` | `node tools/check-traceability.mjs --repo .` |
| `win-final-*.log` | Step 9 clean rerun (`win-final-npm-ci.log`, `win-final-check.log`, ...) |
| `win-gitstatus.log` | `git status --porcelain` plus `git check-ignore -v out release node_modules test-results` |
| `wsl-*.log` | Section 16 |

---

## 19. Progress report and backlog updates

### 19.1 `docs/progress/phase-01.md` must contain

1. A summary, the date, and the implementer role and model.
2. Hosts:
   - Windows build, Node and npm versions.
   - WSL: Ubuntu, kernel, glibc, Node, npm, WSLg version, the Weston build hash, the user `infinity`, and the observed ozone platform in the WSLg run, the Xvfb run and the forced-Wayland run.
3. Changed and created files, grouped by the section 4 areas, with one line each.
4. Installed dependency versions taken from `npm ls --depth=0` (must equal the pins), and lockfile proof (`npm ci` on both hosts).
5. A command table: command, host, exit code, duration, log path. Include every row from section 18.
6. Requirement coverage: one row per ID INF-FND-01 to 13. Columns:
   - assertions run;
   - the test file › case names;
   - the result on W, L and L-xvfb;
   - the BACKLOG status set.
7. Native-module proof per host and mode (dev, packaged, AppImage): SQLite version, `loadedBinary`, SHA-256 match, absence of `build/`, Electron ABI.
8. Artifacts: file, bytes, SHA-256, "unsigned local build". Note that installers were not installed (Phase 09).
9. Follow-ups F-2 to F-6: how each was closed, with file references.
10. Decisions added after planning (D-044 onward) or "none".
11. Deviations from this plan with reasons, or "none".
12. Issues found and fixed: severity, reproduction, expected and actual, and fix verification.
13. Cases not run or pending, with reasons, written as an explicit list:
    - the N parts of INF-FND-02 and INF-FND-11;
    - the WSLg Wayland informational run;
    - any Linux step recorded as `pending`;
    - the statement that GNOME and X11 sessions are outside the validation scope.
14. Known limitations:
    - the temporary foundation screen;
    - fuses not set (Phase 09);
    - `spellcheck` off;
    - the edits within the last debounce window are Phase 03's concern.

### 19.2 BACKLOG updates (Status and Planned tests columns only; the Tests column must not change)

- `done`: INF-FND-01, 03, 04, 05, 06, 07, 08, 09, 10 and 13, when all their non-native assertions pass on W and L.
- INF-FND-12: `done` only if dev, packaged and AppImage pass on both hosts. Otherwise `in_progress`, with the failing host named in the progress report.
- INF-FND-02 and INF-FND-11: `in_progress`. The E and R parts are done; the N part stays pending for the Phase 09 matrix (and Phase 05 for toast identity).
- Update the Planned tests text to the final names, for example add `e2e/security.spec › attachment protocol` to INF-FND-08.
- Run `node tools/check-traceability.mjs --repo .` afterwards. It must exit 0.

---

## 20. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1-01 | electron-vite 5, Vite 7 and TypeScript 6 configuration friction (`types` defaults to `[]`, `?raw` typing, sandboxed preload format) | Explicit `types`, `env.d.ts` for `*.sql?raw`, preload `externalizeDeps:false` and `format:'cjs'`. Check that `out/preload/index.js` is a single CJS file with only `require("electron")` |
| R1-02 | Playwright 1.64 `_electron` and Electron 44 compatibility | Smoke test first in step 5. If it is incompatible, record the error and set the status to `blocked` (no browser-only substitute) |
| R1-03 | Lockfile created on Windows lacks Linux optional native packages (rollup, esbuild) | Generate the lock from clean. Run the early WSL `npm ci` in step 1. Regenerate once if needed, then record |
| R1-04 | Windows file locks on temp DB or WAL during E2E cleanup | `electronApp.close()` before removal; `fs.rm` with retries |
| R1-05 | WSLg window flakiness | Xvfb leg as a second record. Retries stay 0 (never hide flakiness); investigate failures |
| R1-06 | AppImage needs FUSE | `APPIMAGE_EXTRACT_AND_RUN=1` (proven in a probe) |
| R1-07 | deb metadata | `homepage` and `maintainer` set (D-043) |
| R1-08 | npx flag parsing | Tools call CLIs through `node <cli path>` (D-043) |
| R1-09 | electron-builder `winCodeSign` extraction or symlink privilege on Windows | The probe built NSIS successfully on this host. Fallback in section 17 stop conditions |
| R1-10 | `@types/better-sqlite3` 9.6.0 versus the 13.x runtime | Types are confined to `better-sqlite3-driver.ts` |
| R1-11 | Spellchecker dictionary download on Linux would be network traffic | `spellcheck:false` and the network guard. Phase 03 decides |
| R1-12 | Focus is not observable under Xvfb (no window manager) | Assert visible and not minimized, not focus |
| R1-13 | zod 4 API differences (`z.strictObject`, `z.looseObject`, `z.uuid()`, issue paths) | Use the zod 4 API only. The unit tests pin the behavior |
| R1-14 | A custom-scheme module script or asset fails in the packaged asar | `fs.readFile` (asar-aware) and the MIME map. The packaged E2E proves it |
| R1-15 | Windows Defender or SmartScreen slows down an unsigned exe launch | E2E timeouts of 90 s. Record if it is observed |
| R1-16 | A future fuse change (Phase 09) disables inspector arguments that Playwright needs | Noted in section 5.4 for the Phase 09 planner |

---

## 21. Explicitly out of scope for Phase 01

The following are out of scope for Phase 01:

- Shell UI (rail, tabs, tree): Phase 02.
- The editor, attachment import and IPC for note:save and lease: Phase 03.
- The close dialog, tray and stickies: Phase 04.
- Notifications, scheduler and Luxon use: Phase 05.
- Search UI: Phase 07.
- Backup, fuses and installers being installed: Phases 08 and 09.

The following must never be done in any phase: publishing, pushing, signing, installing apt packages, running Electron as root, or passing `--no-sandbox`.

---

## 22. Planner status

```json
{"status":"ready","evidence":["docs/plans/phase-01.md","docs/DECISIONS.md (D-035..D-043)","docs/ARCHITECTURE.md (sections 3, 4, 14, 15 amended)","docs/UX_SPEC.md (section 6 startup copy)","docs/BACKLOG.md (W01-02 reference, F-6)",".infinity-work/logs/phase-01/planner-probes.log"],"blockers":[]}
```
