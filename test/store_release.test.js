// Store-release checks for issue #4: backup exclusion, encryption left off,
// and release allowNavigation. Node's built-in runner (`npm test`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadCapacitorConfig(devNav) {
  const configPath = path.join(ROOT, 'capacitor.config.js');
  if (devNav) {
    process.env.CAP_DEV_NAV = '1';
  } else {
    delete process.env.CAP_DEV_NAV;
  }
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  delete process.env.CAP_DEV_NAV;
  delete require.cache[require.resolve(configPath)];
  return config;
}

const DEV_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];
const LOCALES = ['de', 'es', 'fr', 'ja', 'pl', 'pt', 'ru', 'uk', 'ga', 'ar', 'zh-Hans', 'zh-Hant'];
const USAGE_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription'
];

test('offline files use the no-cloud directory', function() {
  const bridge = read('www/filesystem_bridge.js');
  assert.match(bridge, /DIRECTORY\s*=\s*'LIBRARY_NO_CLOUD'/);
  assert.doesNotMatch(bridge, /DIRECTORY\s*=\s*'DATA'/);
});

test('sqlite stays unencrypted until a device-only key exists', function() {
  const bridge = read('www/sqlite_bridge.js');
  assert.match(bridge, /encrypted:\s*false/);
  assert.match(bridge, /mode:\s*'no-encryption'/);
  const config = loadCapacitorConfig(false);
  assert.equal(config.plugins.CapacitorSQLite.androidIsEncryption, false);
  assert.equal(config.plugins.CapacitorSQLite.iosIsEncryption, false);
  assert.equal(config.plugins.CapacitorSQLite.iosDatabaseLocation, 'Library/CapacitorDatabase');
});

test('a store sync does not grant navigation to local dev hosts', function() {
  const release = loadCapacitorConfig(false);
  for (const host of DEV_HOSTS) {
    assert.equal(release.server.allowNavigation.includes(host), false, host);
  }
  assert.ok(release.server.allowNavigation.includes('app.lingolinq.com'));

  const local = loadCapacitorConfig(true);
  for (const host of DEV_HOSTS) {
    assert.equal(local.server.allowNavigation.includes(host), true, host);
  }
});

function xmlSection(xml, tag) {
  const match = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  assert.ok(match, 'missing <' + tag + '>');
  return match[1];
}

function assertExcluded(section, domain, filePath) {
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    section,
    new RegExp('<exclude domain="' + domain + '" path="' + escaped + '"\\s*/>'),
    domain + ' ' + filePath
  );
}

const BACKUP_EXCLUDES = [
  ['database', '.'],
  ['file', '.'],
  ['sharedpref', '.'],
  ['root', 'app_webview/']
];

test('android backup rules exclude database, files, preferences, and webview storage', function() {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:allowBackup="true"/);
  assert.doesNotMatch(manifest, /android:allowBackup="false"/);

  const full = xmlSection(read('android/app/src/main/res/xml/backup_rules.xml'), 'full-backup-content');
  const extraction = read('android/app/src/main/res/xml/data_extraction_rules.xml');
  const cloud = xmlSection(extraction, 'cloud-backup');
  const transfer = xmlSection(extraction, 'device-transfer');
  for (const pair of BACKUP_EXCLUDES) {
    assertExcluded(full, pair[0], pair[1]);
    assertExcluded(cloud, pair[0], pair[1]);
    assertExcluded(transfer, pair[0], pair[1]);
  }
});

test('ios permission prompts are translated for the web app languages', function() {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const resources = project.match(/\/\* Begin PBXResourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXResourcesBuildPhase section \*\//);
  assert.ok(resources, 'PBXResourcesBuildPhase');
  const files = resources[1].match(/files = \(([\s\S]*?)\);/);
  assert.ok(files, 'Resources files list');
  assert.match(files[1], /B7E4A1C21FED79650016A002 \/\* InfoPlist\.strings in Resources \*\//);
  const plist = read('ios/App/App/Info.plist');
  for (const key of USAGE_KEYS) {
    assert.match(plist, new RegExp('<key>' + key + '</key>'));
  }
  for (const locale of LOCALES) {
    const strings = read('ios/App/App/' + locale + '.lproj/InfoPlist.strings');
    for (const key of USAGE_KEYS) {
      const match = strings.match(new RegExp(key + '\\s*=\\s*"(.+)";'));
      assert.ok(match, locale + ' ' + key);
      assert.ok(match[1].trim().length > 0);
    }
    assert.match(project, new RegExp(locale + '\\.lproj/InfoPlist\\.strings'));
  }
});
