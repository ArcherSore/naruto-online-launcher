'use strict';

const defaultFs = require('fs');
const path = require('path');

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createAuthorCatalog(options) {
  const opts = options || {};
  const fs = opts.fs || defaultFs;
  if (!opts.registry || typeof opts.registry.list !== 'function' || typeof opts.registry.get !== 'function') {
    throw new TypeError('registry is required');
  }
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const snapshot = Object.freeze(opts.registry.list().map(function (item) {
    return Object.freeze({
      id: item.id,
      name: item.name,
      version: item.version,
      apiVersion: item.apiVersion,
      description: typeof item.description === 'string' ? item.description : null
    });
  }));
  const ids = new Set(snapshot.map(function (item) { return item.id; }));

  function listScripts() {
    return { scripts: snapshot.slice() };
  }

  function resolve(scriptId) {
    if (typeof scriptId !== 'string' || !ids.has(scriptId)) throw catalogError('script-not-found');
    const record = opts.registry.get(scriptId);
    if (
      !record || !record.manifest || record.manifest.id !== scriptId ||
      typeof record.packageRoot !== 'string'
    ) {
      throw catalogError('script-not-found');
    }
    const packageRoot = path.resolve(record.packageRoot);
    const scriptsRoot = path.join(repoRoot, 'automation-scripts');
    const relative = path.relative(scriptsRoot, packageRoot);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw catalogError('script-not-found');
    }
    try {
      if (!fs.statSync(packageRoot).isDirectory()) throw new Error('not-directory');
      if (!fs.statSync(path.join(packageRoot, 'manifest.json')).isFile()) throw new Error('manifest-missing');
      if (!fs.statSync(record.entryPath).isFile()) throw new Error('entry-missing');
    } catch (_) {
      throw catalogError('script-not-found');
    }
    return record;
  }

  return Object.freeze({ listScripts: listScripts, resolve: resolve });
}

module.exports = { catalogError: catalogError, createAuthorCatalog: createAuthorCatalog };

