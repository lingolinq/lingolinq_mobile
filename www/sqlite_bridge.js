/**
 * Cordova-compatible window.sqlitePlugin shim for @capacitor-community/sqlite.
 * Must load before Ember app.js so dbman.setup_database selects sqlite_plugin.
 */
(function() {
  function isNative() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  if (!isNative() || window.sqlitePlugin) {
    return;
  }

  function plugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite;
  }

  function sanitizeDbName(name) {
    return String(name || 'lingolinq').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  // A native call that never settles would leave the caller's queue waiting, and every
  // later read and write with it. Bound each plugin call. On timeout the caller's error
  // callback runs and the queue moves on. The plugin has no cancel, so that call may
  // still be in flight when the next statement closes and reopens the connection
  // (openPromise cleared). abortAllPendingTransactions stays a no-op: cancelling a
  // write that might still land is not safe.
  var NATIVE_CALL_TIMEOUT_MS = 60000;

  function isTimeoutError(err) {
    return !!(err && typeof err.message === 'string' &&
      err.message.indexOf('sqlite plugin call timed out:') === 0);
  }

  function withTimeout(promise, label) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (settled) { return; }
        settled = true;
        reject(new Error('sqlite plugin call timed out: ' + label));
      }, NATIVE_CALL_TIMEOUT_MS);
      Promise.resolve(promise).then(function(value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function(err) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function toResultSet(values) {
    var rows = Array.isArray(values) ? values : [];
    // On iOS the plugin puts a column-list row ({ios_columns: [...]}) first in every
    // non-empty query result (ios/Plugin/Utils/UtilsSQLCipher.swift); its own JS wrapper
    // drops it (reorderRows in dist/plugin.js). This bridge calls the raw plugin, so drop it
    // here. Android never sends it.
    var first = rows[0];
    if (first && typeof first === 'object' && Array.isArray(first.ios_columns)) {
      rows = rows.slice(1);
    }
    return {
      rows: {
        length: rows.length,
        item: function(i) {
          return rows[i];
        }
      }
    };
  }

  var databases = {};
  // Sanitized name -> function that drops that db's cached connection after a timeout
  // on deleteDatabase, which does not run on the db queue.
  var connectionResets = {};

  function makeDb(rawName) {
    var dbName = sanitizeDbName(rawName);
    var openPromise = null;
    var queue = Promise.resolve();

    // keepConnection: a timeout during the open preamble is swallowed by the caller,
    // and the open chain is still the promise stored in openPromise. Clearing it here
    // would let a second open start before the first chain finishes.
    function callPlugin(p, method, args, keepConnection) {
      var pending = withTimeout(p[method](args), method);
      if (keepConnection) { return pending; }
      return pending.catch(function(err) {
        if (isTimeoutError(err)) { openPromise = null; }
        throw err;
      });
    }

    function ensureOpen() {
      if (openPromise) { return openPromise; }
      var p = plugin();
      if (!p) {
        return Promise.reject(new Error('CapacitorSQLite plugin missing'));
      }
      // Native CapacitorSQLitePlugin has createConnection/open/closeConnection —
      // not isConnection (that lives on the npm SQLiteConnection JS helper only).
      openPromise = Promise.resolve()
        .then(function() {
          if (typeof p.checkConnectionsConsistency === 'function') {
            return callPlugin(p, 'checkConnectionsConsistency', {
              dbNames: [dbName],
              openModes: ['RW']
            }, true).catch(function() {
              return { result: false };
            });
          }
          return { result: false };
        })
        .then(function(consistency) {
          if (consistency && consistency.result === false && typeof p.closeConnection === 'function') {
            return callPlugin(p, 'closeConnection', {
              database: dbName,
              readonly: false
            }, true).catch(function() {});
          }
        })
        .then(function() {
          return callPlugin(p, 'createConnection', {
            database: dbName,
            version: 1,
            encrypted: false,
            mode: 'no-encryption',
            readonly: false
          }).catch(function(err) {
            var msg = String((err && err.message) || err || '');
            // Re-open path: connection already registered from a prior open.
            if (/already|exist/i.test(msg)) { return; }
            throw err;
          });
        })
        .then(function() {
          return callPlugin(p, 'open', { database: dbName, readonly: false });
        })
        .catch(function(err) {
          openPromise = null;
          throw err;
        });
      return openPromise;
    }

    function runSql(sql, params) {
      params = params || [];
      var p = plugin();
      var trimmed = String(sql || '').replace(/^\s+/, '');
      var isSelect = /^\s*SELECT\b/i.test(trimmed) || /^\s*PRAGMA\b/i.test(trimmed);
      return ensureOpen().then(function() {
        if (isSelect) {
          return callPlugin(p, 'query', {
            database: dbName,
            statement: sql,
            values: params
          }).then(function(res) {
            return toResultSet(res && res.values);
          });
        }
        return callPlugin(p, 'run', {
          database: dbName,
          statement: sql,
          values: params,
          transaction: false
        }).then(function() {
          return toResultSet([]);
        });
      });
    }

    connectionResets[dbName] = function() { openPromise = null; };

    function enqueue(fn) {
      var result = queue.then(fn, fn);
      queue = result.catch(function() {});
      return result;
    }

    return {
      executeSql: function(sql, params, success, error) {
        // LingoLinq's sync calls the short form executeSql(sql, success, error), with no
        // values, to check the database (services/persistence.js), so accept it here.
        if (typeof params === 'function') {
          error = success;
          success = params;
          params = [];
        }
        enqueue(function() {
          return runSql(sql, params).then(function(rs) {
            if (typeof success === 'function') { success(rs); }
            return rs;
          }, function(err) {
            if (typeof error === 'function') {
              error(err && err.message ? err : { message: String(err) });
            }
          });
        });
      },
      // Cordova API. LingoLinq's sync calls it when its database check has not answered within
      // a second (services/persistence.js). Statements here run in order on one queue, so there
      // is nothing safe to cancel without risking a lost write: do nothing, and never throw.
      // A call that never returns is bounded by the native-call timeout, which fails that
      // call and lets the queue continue.
      abortAllPendingTransactions: function() {},
      transaction: function(fn, error, success) {
        enqueue(function() {
          var p = plugin();
          var ops = [];
          var tx = {
            executeSql: function(sql, params, ok, fail) {
              // Same short form as db.executeSql: executeSql(sql, success, error).
              if (typeof params === 'function') {
                fail = ok;
                ok = params;
                params = [];
              }
              ops.push({ sql: sql, params: params || [], ok: ok, fail: fail });
            }
          };
          try {
            fn(tx);
          } catch (e) {
            if (typeof error === 'function') { error({ message: e.message || String(e) }); }
            return Promise.resolve();
          }
          return ensureOpen()
            .then(function() {
              if (typeof p.beginTransaction === 'function') {
                return callPlugin(p, 'beginTransaction', { database: dbName });
              }
            })
            .then(function() {
              // A success callback may call tx.executeSql (Cordova / Web SQL). Those
              // statements are pushed after this function starts, so walk the queue one
              // statement at a time and look again after each callback. A statement
              // error still rolls the transaction back; the error callback cannot
              // continue it.
              var index = 0;
              function step() {
                if (index >= ops.length) { return Promise.resolve(); }
                var op = ops[index++];
                return runSql(op.sql, op.params).then(function(rs) {
                  if (typeof op.ok === 'function') { op.ok(tx, rs); }
                  return step();
                }, function(err) {
                  var wrapped = err && err.message ? err : { message: String(err) };
                  if (typeof op.fail === 'function') { op.fail(tx, wrapped); }
                  throw wrapped;
                });
              }
              return step();
            })
            .then(function() {
              if (typeof p.commitTransaction === 'function') {
                return callPlugin(p, 'commitTransaction', { database: dbName });
              }
            })
            .then(function() {
              if (typeof success === 'function') { success(); }
            })
            .catch(function(err) {
              var rollback = Promise.resolve();
              if (typeof p.rollbackTransaction === 'function') {
                rollback = callPlugin(p, 'rollbackTransaction', { database: dbName }).catch(function() {});
              }
              return rollback.then(function() {
                if (typeof error === 'function') {
                  error(err && err.message ? err : { message: String(err) });
                }
              });
            });
        });
      }
    };
  }

  window.sqlitePlugin = {
    openDatabase: function(opts, success, error) {
      var name = (opts && opts.name) || opts;
      if (typeof name !== 'string') {
        name = opts && opts.name;
      }
      try {
        var db = databases[name] || makeDb(name);
        databases[name] = db;
        if (typeof success === 'function') {
          setTimeout(function() { success(db); }, 0);
        }
        return db;
      } catch (e) {
        if (typeof error === 'function') { error(e); }
        return null;
      }
    },
    deleteDatabase: function(opts, success, error) {
      var name = (opts && opts.name) || opts;
      var dbName = sanitizeDbName(name);
      var p = plugin();
      if (!p) {
        if (typeof error === 'function') { error({ message: 'CapacitorSQLite plugin missing' }); }
        return;
      }
      Promise.resolve()
        .then(function() {
          return withTimeout(
            p.closeConnection({ database: dbName, readonly: false }),
            'closeConnection'
          ).catch(function() {});
        })
        .then(function() {
          return withTimeout(p.deleteDatabase({ database: dbName }), 'deleteDatabase');
        })
        .then(function() {
          delete databases[name];
          delete connectionResets[dbName];
          if (typeof success === 'function') { success(); }
        })
        .catch(function(err) {
          if (isTimeoutError(err) && connectionResets[dbName]) {
            connectionResets[dbName]();
          }
          if (typeof error === 'function') {
            error(err && err.message ? err : { message: String(err) });
          }
        });
    }
  };

  console.log('LINGOLINQ: Capacitor sqlitePlugin shim ready');
})();
