# LingoLinq Mobile (Capacitor 7)

Native Android/iOS shell for the LingoLinq AAC web app. This repo wraps packaged Ember assets in Capacitor 7 and talks to a LingoLinq Rails API (local or production).

**App ID:** `com.lingolinq.app`  
**License:** AGPL-3.0-or-later

## How this relates to the LingoLinq monorepo

These are **sibling checkouts**, not a nested package:

```text
repos/
  LingoLinq/            # Rails + Ember (source of truth for app JS/CSS + API)
  lingolinq_mobile/     # this repo — Capacitor shell that loads packaged Ember
```

| Change lives in… | Examples |
|------------------|----------|
| **LingoLinq** | Ember UI, speak mode, API clients, `capacitor_bridge.js`, Rails endpoints |
| **lingolinq_mobile** | Capacitor config, native plugins, Android/iOS projects, packaging/`www` bootstrap |

Default packaging looks for the monorepo at `../LingoLinq`. Override if your layout differs:

```bash
export LINGOLINQ_ROOT=/path/to/LingoLinq
```

Deeper kickoff notes and bridge inventory live in the monorepo:

- `LingoLinq/docs/native-apps/capacitor-7-kickoff.md`
- `LingoLinq/docs/native-apps/native-bridge-inventory.md`

Monorepo adapter worth knowing about:

- `LingoLinq/app/frontend/app/utils/capacitor_bridge.js` — Capacitor bootstrap + IAP gate
- Wired from `capabilities.js` / `subscription.js` on a Capacitor feature branch (e.g. `feat/melissa-capacitor-7-kickoff`)

## Prerequisites

| Need | Notes |
|------|--------|
| Node 20+ (22 preferred) | Matches LingoLinq |
| Sibling `LingoLinq` checkout | For local images/locales and optional local asset builds |
| JDK **21** | Capacitor 7 / Android Gradle |
| Android SDK platform **35** | Android Studio Ladybug+ |
| macOS + Xcode | **Required to build iOS** (cannot compile iOS from Linux/WSL) |
| CocoaPods | iOS deps (`pod install` via `npx cap sync ios`) |

```bash
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.12+8"   # adjust
export ANDROID_HOME="$HOME/Android/Sdk"            # or Windows SDK under /mnt/c/...
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

```bash
cd /path/to/lingolinq_mobile
npm install
```

## Typical day: develop with local LingoLinq

Goal: native app uses **your** Rails on port **5000** (same DB as the webapp), not `app.lingolinq.com`.

### 1. Run LingoLinq locally

In the monorepo, start Rails the way you usually do for web (`bin/fresh_start`, Foreman, etc.) so API is at:

`http://localhost:5000`

Ember on `:8184` is optional for native work; the Capacitor WebView loads packaged assets from `www/`, not the Ember dev server.

### 2. Package + sync the shell (local API)

```bash
cd /path/to/lingolinq_mobile

# Android (WSL / Linux / macOS)
npm run sync:android:local

# iOS (macOS only)
npm run sync:ios:local
```

What that does:

1. Downloads a complete Ember bundle (`PACKAGE_SOURCE=prod` by default for `:local` scripts — local Sprockets trees often omit vendor / `ember-inflector`).
2. Sets `www/init.js` → `capabilities.api_host = "http://localhost:5000"`.
3. Fetches `domain_settings` from that API host when reachable.
4. Runs `npx cap sync` so `android/` / `ios/` pick up `www/`.

Confirm before installing:

```bash
grep api_host www/init.js
# expect: api_host: "http://localhost:5000"
```

### 3. Reach host Rails from the device/emulator

Inside the app, `localhost` is the **phone/emulator**, not your laptop. Forward the port:

```bash
adb reverse tcp:5000 tcp:5000
```

Re-run `adb reverse` after reconnecting a device or restarting the emulator.

| Situation | `LINGOLINQ_API_HOST` | Notes |
|-----------|----------------------|--------|
| Recommended (adb reverse) | `http://localhost:5000` | What `*:local` scripts use |
| Android emulator, no reverse | `http://10.0.2.2:5000` | Bind Rails on `0.0.0.0:5000` |
| Physical device on Wi‑Fi | `http://<lan-ip>:5000` | Same bind note; debug cleartext allowed |

```bash
LINGOLINQ_API_HOST=http://10.0.2.2:5000 PACKAGE_SOURCE=prod npm run package
npx cap sync android
```

### 4. Build / run

**Android**

```bash
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk

# or
npx cap open android
npx cap run android
```

**iOS (Mac only)**

```bash
npm run sync:ios:local
npx cap open ios
# Build/run a simulator or device from Xcode
```

### 5. When you change Ember / Capacitor bridge code in LingoLinq

Packaged `www/app.js` is a **snapshot**. After meaningful frontend changes:

1. Land/build the change in `LingoLinq` (and use a full asset build, or keep `PACKAGE_SOURCE=prod` until local precompile is complete).
2. Re-run `npm run sync:android:local` (or `:ios:local`).
3. Rebuild/reinstall the native app.

Bootstrap-only files you edit in **this** repo (`www/init.js`, `www/tts_bridge.js`, `www/index.html`) still need `npx cap sync …` after changes.

Shell-only changes (plugins, `capacitor.config.json`, AndroidManifest) → sync + native rebuild; no monorepo package required unless `www/` also changed.

## Production-pointing package

Use when you intentionally want the installed app to call production:

```bash
npm run sync:android    # api_host → https://app.lingolinq.com
# or
npm run sync:ios
```

Do **not** use this while iterating against a local DB.

## Packaging reference

| Script | API host | Ember assets |
|--------|----------|--------------|
| `npm run package:local` | `http://localhost:5000` | prod download (`PACKAGE_SOURCE=prod`) |
| `npm run package` | `https://app.lingolinq.com` | local `public/assets` unless `PACKAGE_SOURCE=prod` |
| `npm run sync:android:local` | local | `package:local` + `cap sync android` |
| `npm run sync:ios:local` | local | `package:local` + `cap sync ios` |

| Env var | Purpose | Default |
|---------|---------|---------|
| `LINGOLINQ_ROOT` | Path to monorepo | `../LingoLinq` |
| `LINGOLINQ_API_HOST` | Written into `www/init.js` as `api_host` | `https://app.lingolinq.com` |
| `PACKAGE_SOURCE` | `local` or `prod` Ember bundle | `local` (`prod` for `package:local`) |
| `PACKAGE_PROD_HOST` | Host used when downloading prod assets | `https://app.lingolinq.com` |

`bin/package_from_lingolinq` refuses incomplete local bundles (missing `ember-inflector` AMD modules). Fix with a full Rails asset precompile, or `PACKAGE_SOURCE=prod`.

Gitignored build outputs (regenerated by package/sync): `www/app.js`, `www/css/app.css`, locales/fonts/images copies.

## Layout

| Path | Role |
|------|------|
| `www/` | Web assets Capacitor loads at runtime |
| `www/init.js` | Sets `installed_app` + `api_host` before Ember boots |
| `www/tts_bridge.js` | Android TTS shim (`speechSynthesis` is broken in System WebView) |
| `www/sqlite_bridge.js` | Cordova-shaped `window.sqlitePlugin` over `@capacitor-community/sqlite` (before `app.js`) |
| `www/filesystem_bridge.js` | Cordova-shaped `window.file_storage` over `@capacitor/filesystem` (before `app.js`) |
| `www/domain_settings.js` | Branding/settings snapshot from API |
| `bin/package_from_lingolinq` | Pulls Ember assets from LingoLinq or prod; rewrites `api_host` |
| `capacitor.config.json` | App id, `CapacitorHttp`, allowNavigation, SQLite encryption flags |
| `android/` | Android Studio / Gradle project |
| `ios/` | Xcode project (build on macOS) |

## Offline board speak (MVP)

After plugins + bridges are synced, a logged-in user should sync once online, then open/speak their home board offline with local symbols.

1. `npm run sync:android:local` (or prod sync) and confirm bridges are present:
   ```bash
   grep -E 'sqlite_bridge|filesystem_bridge' www/index.html
   grep api_host www/init.js
   ```
2. Install/run the debug APK. With local API: `adb reverse tcp:5000 tcp:5000`.
3. Fresh install → login → wait for sync (`settings.lastSync` / sync UI).
4. Logcat / remote WebView console: expect `Capacitor sqlitePlugin shim ready` and **not** `should be using sqlite but using indexeddb instead`.
5. Confirm media cache: board images written under app Data (`image/…` via Filesystem).
6. Airplane mode → force-stop app → cold start → open home board → speak; symbols and button actions work from local URLs (`Capacitor.convertFileSrc`).
7. Go online again → sync does not wipe the local set.

**Note:** Shell bridges apply even when `PACKAGE_SOURCE=prod` (prod `app.js` alone has no Capacitor shims). Monorepo `capacitor_*_shim.js` covers local Ember packages that include those modules.

## WSL + Android Studio on Windows

If Studio opens a Windows copy (e.g. `C:\Users\…\AndroidStudioProjects\lingolinq_mobile`), package/sync in WSL first, then refresh that mirror’s `www/` and `android/app/src/main/assets/` (and keep Windows `node_modules` via `npm ci` there). Opening the raw `\\wsl$\…` tree from Studio is fragile; prefer a synced NTFS project.

## Gotchas

- **Prod API in a “dev” APK** — `api_host` is baked at package time. Always `grep api_host www/init.js` after sync.
- **Incomplete local assets** — ~9MB `application-*.js` can still miss vendor; symptom: `Could not find module ember-inflector`. Use `PACKAGE_SOURCE=prod` or a full precompile.
- **CORS / “Can't Reach LingoLinq Cloud”** — keep `CapacitorHttp.enabled: true` in `capacitor.config.json`. Dev Rails CORS allows `localhost` and `capacitor://localhost`.
- **TTS silence on Android** — System WebView does not implement working `speechSynthesis`; kickoff uses `@capacitor-community/text-to-speech` + `tts_bridge.js`.
- **IndexedDB-only is not AAC-ready** — without `sqlite_bridge.js` + `filesystem_bridge.js`, boards may cache weakly but symbols/sounds will not survive offline speak. Always keep those scripts before `app.js`.
- **iOS from WSL** — `ios/` is in the repo, but you must sync/build on a Mac with Xcode.

## Kickoff checklist

- [x] Capacitor 7 + Android/iOS platforms
- [x] Packaged Ember mount (`#ember-application-root`) + `api_host` bootstrap
- [x] Official Capacitor plugins synced
- [x] Debug APK builds
- [x] SQLite + Filesystem plugins + pre-Ember bridges for offline boards
- [ ] Device/emulator login + board load against **local** Rails
- [ ] Offline smoke (airplane + cold start + speak with local symbols)
- [ ] iOS simulator smoke test (on a Mac)

## Deferred (not kickoff)

SQLite offline adapter, `@capacitor/filesystem`, custom `LingoLinqMisc` plugin, Acapela TTS, eye-gaze, IAP (v1.1). See `LingoLinq/docs/native-apps/native-bridge-inventory.md`.

Legacy Cordova (`coughdrop_mobile`) is reference-only — do not extend it for store shipping.
