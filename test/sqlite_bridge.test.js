// Tests for www/sqlite_bridge.js, run with `npm test` (Node's built-in test runner).
// The bridge is a browser script, so each test loads it into a fresh VM context with a
// fake window.Capacitor whose CapacitorSQLite plugin returns a fixed query result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'www', 'sqlite_bridge.js'), 'utf8');

function loadBridge(queryValues, calls, failQuery) {
  const plugin = {
    checkConnectionsConsistency: async () => ({ result: true }),
    closeConnection: async () => {},
    createConnection: async () => {},
    open: async () => {},
    // Like the real plugin, refuse anything but an array of values
    // ("Query: Must provide an Array of value", seen on the iOS simulator).
    query: async (opts) => {
      if (calls) { calls.push(opts); }
      if (!Array.isArray(opts.values)) { throw new Error('Query: Must provide an Array of value'); }
      if (failQuery) { throw new Error('no such table: board'); }
      return { values: queryValues };
    },
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

// LingoLinq-AAC's sync checks the database with the short Cordova form
// executeSql(sql, success, error) (app/frontend/app/services/persistence.js:2078).
test('short form executeSql(sql, success, error) runs with no values and calls success', async () => {
  const calls = [];
  const sqlitePlugin = loadBridge([{ ios_columns: ['id'] }, { id: 1 }], calls);
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  const rs = await new Promise((resolve, reject) => {
    db.executeSql('SELECT * FROM board LIMIT 1', resolve, reject);
  });
  assert.equal(rs.rows.length, 1);
  assert.ok(Array.isArray(calls[0].values));
  assert.equal(calls[0].values.length, 0);
});

test('short form executeSql calls its error callback (third argument) on failure', async () => {
  const sqlitePlugin = loadBridge([], null, true);
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  const outcome = await new Promise((resolve) => {
    db.executeSql('SELECT * FROM board LIMIT 1',
      function() { resolve('success'); },
      function(err) { resolve('error: ' + err.message); });
  });
  assert.equal(outcome, 'error: no such table: board');
});

test('full form with a non-array values argument reports through the error callback', async () => {
  const sqlitePlugin = loadBridge([]);
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  const err = await new Promise((resolve) => {
    db.executeSql('SELECT * FROM board', 'not-an-array', function() { resolve(null); }, resolve);
  });
  assert.ok(err && /Array/.test(err.message));
});

// The same sync check calls db.abortAllPendingTransactions() when the check is slow
// (persistence.js:2088); it must exist and must not throw.
test('abortAllPendingTransactions exists and does not throw', () => {
  const sqlitePlugin = loadBridge([]);
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  assert.equal(typeof db.abortAllPendingTransactions, 'function');
  assert.doesNotThrow(() => db.abortAllPendingTransactions());
});

test('empty result stays empty', async () => {
  const sqlitePlugin = loadBridge([]);
  const rs = await select(sqlitePlugin, 'SELECT * FROM version');
  assert.equal(rs.rows.length, 0);
});
