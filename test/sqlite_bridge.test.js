// Tests for www/sqlite_bridge.js, run with `npm test` (Node's built-in test runner).
// The bridge is a browser script, so each test loads it into a fresh VM context with a
// fake window.Capacitor whose CapacitorSQLite plugin returns a fixed query result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'www', 'sqlite_bridge.js'), 'utf8');

function loadBridge(queryValues) {
  const plugin = {
    checkConnectionsConsistency: async () => ({ result: true }),
    closeConnection: async () => {},
    createConnection: async () => {},
    open: async () => {},
    query: async () => ({ values: queryValues }),
    run: async () => ({ changes: { changes: 0 } })
  };
  const window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { CapacitorSQLite: plugin }
    }
  };
  const context = vm.createContext({ window, console: { log() {} }, setTimeout, Promise });
  vm.runInContext(BRIDGE, context);
  return window.sqlitePlugin;
}

function select(sqlitePlugin, sql) {
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  return new Promise((resolve, reject) => {
    db.executeSql(sql, [], resolve, reject);
  });
}

// dbman reads the schema version this way (LingoLinq-AAC app/frontend/app/utils/dbman.js:639-648).
function selectInTransaction(sqlitePlugin, sql) {
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  return new Promise((resolve, reject) => {
    let result = null;
    db.transaction(function(tx) {
      tx.executeSql(sql, [], function(_tx, rs) { result = rs; });
    }, reject, function() { resolve(result); });
  });
}

function rowsOf(resultSet) {
  const rows = [];
  for (let i = 0; i < resultSet.rows.length; i++) { rows.push(resultSet.rows.item(i)); }
  return rows;
}

// iOS (UtilsSQLCipher.swift in @capacitor-community/sqlite) puts a column-list row first
// in every non-empty query result; the plugin's own JS wrapper drops it (reorderRows).
test('iOS-shaped result: the ios_columns row is not returned as data', async () => {
  const sqlitePlugin = loadBridge([{ ios_columns: ['version'] }, { version: '4' }]);
  const rs = await select(sqlitePlugin, 'SELECT * FROM version');
  assert.equal(rs.rows.length, 1);
  assert.deepEqual(rowsOf(rs), [{ version: '4' }]);
});

test('iOS-shaped result with several rows keeps every real row in order', async () => {
  const sqlitePlugin = loadBridge([
    { ios_columns: ['ref_id', 'data'] },
    { ref_id: 'a', data: '{"id":"a"}' },
    { ref_id: 'b', data: '{"id":"b"}' }
  ]);
  const rs = await select(sqlitePlugin, 'SELECT * FROM board');
  assert.deepEqual(rowsOf(rs), [
    { ref_id: 'a', data: '{"id":"a"}' },
    { ref_id: 'b', data: '{"id":"b"}' }
  ]);
});

test('iOS-shaped result read inside a transaction (the version check) has no ios_columns row', async () => {
  const sqlitePlugin = loadBridge([{ ios_columns: ['version'] }, { version: '4' }]);
  const rs = await selectInTransaction(sqlitePlugin, 'SELECT * FROM version');
  assert.equal(rs.rows.length, 1);
  assert.equal(rs.rows.item(0).version, '4');
});

test('PRAGMA results get the same handling', async () => {
  const sqlitePlugin = loadBridge([{ ios_columns: ['name'] }, { name: 'data' }]);
  const rs = await select(sqlitePlugin, 'PRAGMA table_info(board)');
  assert.deepEqual(rowsOf(rs), [{ name: 'data' }]);
});

test('Android-shaped result (no ios_columns row) is returned unchanged', async () => {
  const rows = [{ ref_id: 'a', data: '{"id":"a"}' }, { ref_id: 'b', data: '{"id":"b"}' }];
  const sqlitePlugin = loadBridge(rows.map((r) => ({ ...r })));
  const rs = await select(sqlitePlugin, 'SELECT * FROM board');
  assert.deepEqual(rowsOf(rs), rows);
});

test('a real column named ios_columns (not the iOS marker) is kept as data', async () => {
  const rows = [{ ios_columns: 'a real value' }, { ios_columns: 'another' }];
  const sqlitePlugin = loadBridge(rows.map((r) => ({ ...r })));
  const rs = await select(sqlitePlugin, 'SELECT note AS ios_columns FROM t');
  assert.deepEqual(rowsOf(rs), rows);
});

test('missing, non-array or null-first values do not throw', async () => {
  for (const values of [undefined, null, 'not an array', [null, { version: '4' }]]) {
    const sqlitePlugin = loadBridge(values);
    const rs = await select(sqlitePlugin, 'SELECT * FROM version');
    const expected = Array.isArray(values) ? values.length : 0;
    assert.equal(rs.rows.length, expected);
  }
});

test('empty result stays empty', async () => {
  const sqlitePlugin = loadBridge([]);
  const rs = await select(sqlitePlugin, 'SELECT * FROM version');
  assert.equal(rs.rows.length, 0);
});
