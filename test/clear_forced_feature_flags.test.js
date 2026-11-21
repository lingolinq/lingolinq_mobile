// The package step must blank a forced feature-flag list. app.js loads after
// init.js and overwrites the div, so an empty index.html alone does not stop it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'clear_forced_feature_flags.py');

function run(appText, htmlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-'));
  const app = path.join(dir, 'app.js');
  const html = path.join(dir, 'index.html');
  fs.writeFileSync(app, appText);
  fs.writeFileSync(html, htmlText);
  const result = spawnSync('python3', [SCRIPT, app, html], { encoding: 'utf8' });
  return {
    status: result.status,
    stderr: result.stderr,
    app: fs.readFileSync(app, 'utf8'),
    html: fs.readFileSync(html, 'utf8')
  };
}

test('blanks a single forced feature-flag assignment', () => {
  const result = run(
    'before\nwindow.enabled_frontend_features = ["goals"];\nafter\n',
    "<div id='enabled_frontend_features' data-list='goals'></div>\n"
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.app, 'before\nwindow.enabled_frontend_features = [];\nafter\n');
  assert.equal(result.html, "<div id='enabled_frontend_features' data-list=''></div>\n");
});

test('refuses a bundle with two feature-flag assignments', () => {
  const original = 'window.enabled_frontend_features = ["goals"];\nwindow.enabled_frontend_features = ["goals"];\n';
  const result = run(original, "<div id='enabled_frontend_features' data-list='goals'></div>\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one/);
  assert.equal(result.app, original);
});
