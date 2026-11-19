// Tests for www/sqlite_bridge.js, run with `npm test` (Node's built-in test runner).
// The bridge is a browser script, so each test loads it into a fresh VM context with a
// fake window.Capacitor whose CapacitorSQLite plugin returns a fixed query result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'www', 'sqlite_bridge.js'), 'utf8');

function loadBridge(queryValues, calls, failQuery, options) {
  options = options || {};
  const plugin = options.plugin || {
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
  const context = vm.createContext({
    window,
    console: { log() {} },
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    Promise
  });
  vm.runInContext(BRIDGE, context);
  return window.sqlitePlugin;
}

// Plugin double that records open / query / run / transaction calls in order.
// handlers.query / handlers.run may return a result or a promise, or throw.
function recordingPlugin(handlers) {
  handlers = handlers || {};
  const log = [];
  function note(entry) { log.push(entry); }
  const plugin = {
    checkConnectionsConsistency: async () => ({ result: true }),
    closeConnection: async () => { note('close'); },
    createConnection: async () => { note('create'); },
    open: async () => { note('open'); },
    beginTransaction: async () => { note('begin'); },
    commitTransaction: async () => { note('commit'); },
    rollbackTransaction: async () => { note('rollback'); },
    query: async (opts) => {
      if (!Array.isArray(opts.values)) { throw new Error('Query: Must provide an Array of value'); }
      note({ method: 'query', statement: opts.statement, values: opts.values });
      if (handlers.query) { return handlers.query(opts); }
      return { values: [] };
    },
    run: async (opts) => {
      if (!Array.isArray(opts.values)) { throw new Error('Run: Must provide an Array of value'); }
      note({ method: 'run', statement: opts.statement, values: opts.values });
      if (handlers.run) { return handlers.run(opts); }
      return { changes: { changes: 0 } };
    }
  };
  return { plugin, log };
}

function sqlLog(log) {
  return log.filter((entry) => entry === 'begin' || entry === 'commit' || entry === 'rollback' ||
    (entry && entry.statement));
}

function nextTurn() {
  return new Promise((resolve) => { setImmediate(resolve); });
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

test('two statements queued in the transaction function both run, then it commits', async () => {
  const { plugin, log } = recordingPlugin();
  const sqlitePlugin = loadBridge(undefined, undefined, false, { plugin });
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  await new Promise((resolve, reject) => {
    db.transaction(function(tx) {
      tx.executeSql('SELECT * FROM version', []);
      tx.executeSql('SELECT * FROM board', []);
    }, reject, resolve);
  });
  assert.deepEqual(sqlLog(log), [
    'begin',
    { method: 'query', statement: 'SELECT * FROM version', values: [] },
    { method: 'query', statement: 'SELECT * FROM board', values: [] },
    'commit'
  ]);
});

test('a statement queued from a success callback runs before commit', async () => {
  const { plugin, log } = recordingPlugin({
    query: (opts) => {
      if (opts.statement.indexOf('version') !== -1) { return { values: [{ version: '4' }] }; }
      return { values: [] };
    }
  });
  const sqlitePlugin = loadBridge(undefined, undefined, false, { plugin });
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  let seen = null;
  await new Promise((resolve, reject) => {
    db.transaction(function(tx) {
      tx.executeSql('SELECT * FROM version', [], function(_tx, rs) {
        seen = rs.rows.item(0).version;
        tx.executeSql('SELECT * FROM board', []);
      });
    }, reject, resolve);
  });
  assert.equal(seen, '4');
  assert.deepEqual(sqlLog(log), [
    'begin',
    { method: 'query', statement: 'SELECT * FROM version', values: [] },
    { method: 'query', statement: 'SELECT * FROM board', values: [] },
    'commit'
  ]);
});

test('a statement queued from a nested success callback runs before commit', async () => {
  const { plugin, log } = recordingPlugin();
  const sqlitePlugin = loadBridge(undefined, undefined, false, { plugin });
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  await new Promise((resolve, reject) => {
    db.transaction(function(tx) {
      tx.executeSql('SELECT * FROM version', [], function() {
        tx.executeSql('SELECT * FROM board', [], function() {
          tx.executeSql('SELECT * FROM settings', []);
        });
      });
    }, reject, resolve);
  });
  assert.deepEqual(sqlLog(log), [
    'begin',
    { method: 'query', statement: 'SELECT * FROM version', values: [] },
    { method: 'query', statement: 'SELECT * FROM board', values: [] },
    { method: 'query', statement: 'SELECT * FROM settings', values: [] },
    'commit'
  ]);
});

test('short form tx.executeSql(sql, success, error) runs with no values', async () => {
  const { plugin, log } = recordingPlugin();
  const sqlitePlugin = loadBridge(undefined, undefined, false, { plugin });
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  let called = false;
  await new Promise((resolve, reject) => {
    db.transaction(function(tx) {
      tx.executeSql('SELECT * FROM board', function() { called = true; });
    }, reject, resolve);
  });
  assert.equal(called, true);
  const entries = sqlLog(log);
  assert.deepEqual(entries.map((entry) => entry.statement || entry), [
    'begin',
    'SELECT * FROM board',
    'commit'
  ]);
  // The empty values array is created inside the bridge's VM, so compare length
  // rather than the array object.
  assert.equal(Array.isArray(entries[1].values), true);
  assert.equal(entries[1].values.length, 0);
});

test('a failed statement rolls back and does not run later or error-callback statements', async () => {
  const { plugin, log } = recordingPlugin({
    query: (opts) => {
      if (opts.statement.indexOf('missing') !== -1) { throw new Error('no such table: missing'); }
      return { values: [] };
    }
  });
  const sqlitePlugin = loadBridge(undefined, undefined, false, { plugin });
  const db = sqlitePlugin.openDatabase({ name: 'test' });
  const err = await new Promise((resolve) => {
    db.transaction(function(tx) {
      tx.executeSql('SELECT * FROM missing', [], null, function(tx2) {
        tx2.executeSql('SELECT * FROM queued_from_error', []);
      });
      tx.executeSql('SELECT * FROM board', []);
    }, resolve, function() { resolve(null); });
  });
  assert.equal(err && err.message, 'no such table: missing');
  assert.deepEqual(sqlLog(log), [
    'begin',
    { method: 'query', statement: 'SELECT * FROM missing', values: [] },
    'rollback'
  ]);
});

// The bridge's native-call timeout is 60s. These tests pass Node's fake timers into the
// VM so the hang fails without waiting. A following statement is queued before the tick,
// which is the case that used to wait forever.
test('a hung query fails its caller and the next statement still runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let releaseHung;
    const calls = [];
    const { plugin, log } = recordingPlugin({
      query: (opts) => {
        if (opts.statement.indexOf('HANG') !== -1) {
          return new Promise((resolve) => {
            releaseHung = function() { resolve({ values: [{ id: 9 }] }); };
          });
        }
        return { values: [{ id: 1 }] };
      }
    });
    const sqlitePlugin = loadBridge(undefined, undefined, false, {
      plugin: plugin,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    });
    const db = sqlitePlugin.openDatabase({ name: 'test' });
    const first = new Promise((resolve) => {
      db.executeSql('SELECT HANG', [], function() { calls.push('success'); resolve('success'); }, function(err) {
        calls.push('error');
        resolve(err);
      });
    });
    const second = new Promise((resolve, reject) => {
      db.executeSql('SELECT * FROM board', [], resolve, reject);
    });
    await nextTurn();
    t.mock.timers.tick(60000);
    const err = await first;
    const rs = await second;
    assert.equal(err.message, 'sqlite plugin call timed out: query');
    assert.equal(rs.rows.item(0).id, 1);
    assert.equal(log.filter((entry) => entry === 'open').length, 2);
    releaseHung();
    await nextTurn();
    assert.deepEqual(calls, ['error']);
  } finally {
    t.mock.timers.reset();
  }
});

test('a hung query inside a transaction fails the transaction and the next statement still runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { plugin, log } = recordingPlugin({
      query: (opts) => {
        if (opts.statement.indexOf('HANG') !== -1) { return new Promise(function() {}); }
        return { values: [{ id: 1 }] };
      }
    });
    const sqlitePlugin = loadBridge(undefined, undefined, false, {
      plugin: plugin,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    });
    const db = sqlitePlugin.openDatabase({ name: 'test' });
    const first = new Promise((resolve) => {
      db.transaction(function(tx) {
        tx.executeSql('SELECT HANG', []);
      }, function(err) { resolve(err); }, function() { resolve('success'); });
    });
    const second = new Promise((resolve, reject) => {
      db.executeSql('SELECT * FROM board', [], resolve, reject);
    });
    await nextTurn();
    t.mock.timers.tick(60000);
    const err = await first;
    const rs = await second;
    assert.equal(err.message, 'sqlite plugin call timed out: query');
    assert.equal(rs.rows.item(0).id, 1);
    assert.deepEqual(sqlLog(log), [
      'begin',
      { method: 'query', statement: 'SELECT HANG', values: [] },
      'rollback',
      { method: 'query', statement: 'SELECT * FROM board', values: [] }
    ]);
  } finally {
    t.mock.timers.reset();
  }
});
