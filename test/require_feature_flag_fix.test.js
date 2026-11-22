// Packaging must refuse a bundle that still forces flags onto a signed-in user,
// and it must keep the compiled list. Logged-out Basic Access reads that list.
// Deleting the guard, or deleting the package script's call to it, fails this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'require_feature_flag_fix.py');
const PACKAGE = fs.readFileSync(path.join(__dirname, '..', 'bin', 'package_from_lingolinq'), 'utf8');

function run(appText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-'));
  const app = path.join(dir, 'app.js');
  fs.writeFileSync(app, appText);
  const result = spawnSync('python3', [SCRIPT, app], { encoding: 'utf8' });
  return {
    status: result.status,
    stderr: result.stderr,
    app: fs.readFileSync(app, 'utf8')
  };
}

test('the package script runs the signed-in flag guard', () => {
  assert.match(PACKAGE, /require_feature_flag_fix\.py/);
});

test('a bundle without resolve_feature_flags is refused and left unchanged', () => {
  const original = 'window.enabled_frontend_features = ["emergency_boards"];\n';
  const result = run(original);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /resolve_feature_flags/);
  assert.equal(result.app, original);
});

test('a bundle with the signed-in fix keeps its compiled flag list', () => {
  const original = 'function resolve_feature_flags() {}\nwindow.enabled_frontend_features = ["emergency_boards","goals"];\n';
  const result = run(original);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.app, original);
});
