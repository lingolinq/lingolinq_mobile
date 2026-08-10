# LingoLinq Mobile (Capacitor 7)

Native Android/iOS shell for the LingoLinq AAC web app. Wraps Ember assets in Capacitor 7.

**App ID:** `com.lingolinq.app`  
**Sibling of:** `LingoLinq` / `LingoLinq-AAC` monorepo (not inside it)

## Kickoff definition of done

- [x] Capacitor 7 project with Android + iOS platforms
- [x] Packaged Ember `application-*.{js,css}` into `www/`
- [x] Bootstrap: `#ember-application-root`, `api_host`, `domain_settings.js`
- [x] Official Capacitor plugins synced
- [x] `assembleDebug` produces `android/app/build/outputs/apk/debug/app-debug.apk`
- [ ] Install on a device/emulator and confirm login / public board load

## Prerequisites

- Node 20+ (22 preferred; matches LingoLinq)
- JDK **21** (Capacitor 7). Portable Temurin works, e.g. `~/.local/jdk/jdk-21*`
- Android SDK with platform **35** + build-tools (Android Studio Ladybug+)
- Sibling checkout: `../LingoLinq` with `public/assets/application-*.{js,css}` present **or** use `PACKAGE_SOURCE=prod`

```bash
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.12+8"   # adjust version dir
export ANDROID_HOME="$HOME/Android/Sdk"            # or Windows SDK under /mnt/c/...
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

## Local development (talk to your Rails on :5000)

Do **not** leave `api_host` on `https://app.lingolinq.com` while iterating — that hits production DB.

1. Start local Rails as usual (`bin/fresh_start` / `rails s` on port **5000**).
2. Package + sync the shell against localhost:

```bash
cd /home/melis/repos/lingolinq_mobile
npm run sync:android:local
# writes capabilities.api_host = "http://localhost:5000" into www/init.js
```

3. Forward the device/emulator port to your host (required so `localhost:5000` inside the app reaches WSL/host Rails):

```bash
adb reverse tcp:5000 tcp:5000
```

4. Build/install the debug APK (Android Studio or `./gradlew assembleDebug`).

### Alternatives

| Target | `LINGOLINQ_API_HOST` | Notes |
|--------|----------------------|--------|
| Host loopback via adb (recommended) | `http://localhost:5000` | Needs `adb reverse tcp:5000 tcp:5000` |
| Android emulator without reverse | `http://10.0.2.2:5000` | Rails must listen on `0.0.0.0:5000` |
| Physical device on Wi‑Fi | `http://<your-lan-ip>:5000` | Same bind note; debug cleartext allowed |

Override any time:

```bash
LINGOLINQ_API_HOST=http://10.0.2.2:5000 PACKAGE_SOURCE=prod npm run package
npx cap sync android
```

`package:local` still uses `PACKAGE_SOURCE=prod` for the Ember bundle (local Sprockets trees are often missing vendor). Point only the **API** at localhost.

## Production-pointing package

```bash
npm install
npm run package          # api_host → https://app.lingolinq.com
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Layout

| Path | Role |
|------|------|
| `www/` | Web assets Capacitor loads |
| `www/init.js` | Sets `capabilities.installed_app` + `api_host` before Ember |
| `bin/package_from_lingolinq` | Copies Ember assets; rewrites `api_host` from `LINGOLINQ_API_HOST` |
| `android/` / `ios/` | Native projects (`npx cap sync`) |

## Deferred (not kickoff)

SQLite offline adapter, `@capacitor/filesystem`, custom `LingoLinqMisc` plugin, Acapela TTS, eye-gaze, IAP (v1.1). See `LingoLinq/docs/native-apps/native-bridge-inventory.md`.

## Cordova

Legacy Cordova shell (`coughdrop_mobile`) is reference-only. Do not extend it for store shipping.
