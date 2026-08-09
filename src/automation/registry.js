'use strict';

const fs = require('fs');
const path = require('path');
const { SAFE_MESSAGES } = require('./errors');

const MANIFEST_LIMIT = 64 * 1024;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function safeIssue(packageName, scriptId, code, scope) {
  const safePackageName = typeof packageName === 'string'
    ? Array.prototype.filter.call(packageName, function (character) {
      const codePoint = character.charCodeAt(0);
      return codePoint > 31 && codePoint !== 127;
    }).join('').slice(0, 80) || null
    : null;
  return Object.freeze({
    scope: scope || 'package',
    packageName: safePackageName,
    scriptId: typeof scriptId === 'string' && scriptId.length <= 64 ? scriptId : null,
    code: code,
    safeMessage: SAFE_MESSAGES[code] || '内置脚本注册失败'
  });
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function validateManifest(manifest, options) {
  const opts = options || {};
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return 'manifest-invalid';
  }
  if (manifest.schemaVersion !== 1) return 'manifest-schema-incompatible';
  if (manifest.apiVersion !== 1) return 'api-version-incompatible';
  if (
    typeof manifest.id !== 'string' ||
    manifest.id.length < 1 ||
    manifest.id.length > 64 ||
    (!opts.ignoreIdSyntax && !ID_PATTERN.test(manifest.id)) ||
    typeof manifest.name !== 'string' ||
    !manifest.name.trim() ||
    manifest.name.length > 80 ||
    typeof manifest.version !== 'string' ||
    !manifest.version.trim() ||
    manifest.version.length > 32 ||
    typeof manifest.entry !== 'string' ||
    !manifest.entry ||
    manifest.entry.length > 240 ||
    path.extname(manifest.entry).toLowerCase() !== '.js' ||
    (manifest.description !== undefined &&
      (typeof manifest.description !== 'string' || manifest.description.length > 500))
  ) {
    return 'manifest-invalid';
  }
  return null;
}

function createRegistry(options) {
  const opts = options || {};
  const rootDir =
    typeof opts.rootDir === 'string'
      ? path.resolve(opts.rootDir)
      : opts.app && typeof opts.app.getAppPath === 'function'
        ? path.join(opts.app.getAppPath(), 'automation-scripts')
        : null;
  if (!rootDir) throw new TypeError('rootDir or app is required');
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const loadModule = typeof opts.loadModule === 'function' ? opts.loadModule : require;
  const records = new Map();
  const registrationIssues = [];
  let scanned = false;

  function scan() {
    if (scanned) return api;
    scanned = true;
    let directories;
    try {
      directories = fs.readdirSync(rootDir, { withFileTypes: true })
        .filter(function (entry) { return entry.isDirectory(); })
        .map(function (entry) { return entry.name; })
        .sort();
    } catch (_) {
      registrationIssues.push(safeIssue(null, null, 'scripts-root-unavailable', 'root'));
      return api;
    }

    const candidates = [];
    directories.forEach(function (directoryName) {
      const packageRoot = path.join(rootDir, directoryName);
      const manifestPath = path.join(packageRoot, 'manifest.json');
      let raw;
      try {
        const stat = fs.statSync(manifestPath);
        if (!stat.isFile() || stat.size > MANIFEST_LIMIT) throw new Error('manifest-size');
        raw = fs.readFileSync(manifestPath, 'utf8');
      } catch (_) {
        registrationIssues.push(safeIssue(directoryName, null, 'manifest-read-failed'));
        return;
      }
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch (_) {
        registrationIssues.push(safeIssue(directoryName, null, 'manifest-json-invalid'));
        return;
      }
      const structuralCode = validateManifest(manifest, { ignoreIdSyntax: true });
      if (structuralCode) {
        registrationIssues.push(safeIssue(directoryName, manifest && manifest.id, structuralCode));
        return;
      }
      candidates.push({
        directoryName: directoryName,
        packageRoot: packageRoot,
        manifest: manifest,
        idSyntaxValid: ID_PATTERN.test(manifest.id),
        canonicalId: manifest.id.normalize('NFKC').toLowerCase()
      });
    });

    const groups = new Map();
    candidates.forEach(function (candidate) {
      if (!groups.has(candidate.canonicalId)) groups.set(candidate.canonicalId, []);
      groups.get(candidate.canonicalId).push(candidate);
    });

    Array.from(groups.keys()).sort().forEach(function (key) {
      const group = groups.get(key);
      if (group.length > 1) {
        group.forEach(function (candidate) {
          registrationIssues.push(
            safeIssue(candidate.directoryName, candidate.manifest.id, 'script-id-conflict')
          );
        });
        return;
      }
      const candidate = group[0];
      if (!candidate.idSyntaxValid) {
        registrationIssues.push(
          safeIssue(candidate.directoryName, candidate.manifest.id, 'manifest-invalid')
        );
        return;
      }
      const entryPath = path.resolve(candidate.packageRoot, candidate.manifest.entry);
      const entrySegments = candidate.manifest.entry.split(/[\\/]/);
      if (
        path.isAbsolute(candidate.manifest.entry) ||
        entrySegments.indexOf('..') !== -1 ||
        !isInside(candidate.packageRoot, entryPath)
      ) {
        registrationIssues.push(
          safeIssue(candidate.directoryName, candidate.manifest.id, 'entry-outside-package')
        );
        return;
      }
      let entryReal;
      try {
        const packageReal = fs.realpathSync(candidate.packageRoot);
        entryReal = fs.realpathSync(entryPath);
        if (!isInside(packageReal, entryReal)) {
          registrationIssues.push(
            safeIssue(candidate.directoryName, candidate.manifest.id, 'entry-outside-package')
          );
          return;
        }
        if (!fs.statSync(entryReal).isFile()) throw new Error('not-file');
      } catch (_) {
        registrationIssues.push(
          safeIssue(candidate.directoryName, candidate.manifest.id, 'entry-missing')
        );
        return;
      }
      let run;
      try {
        run = loadModule(entryReal);
      } catch (_) {
        registrationIssues.push(
          safeIssue(candidate.directoryName, candidate.manifest.id, 'entry-load-failed')
        );
        return;
      }
      if (typeof run !== 'function') {
        registrationIssues.push(
          safeIssue(candidate.directoryName, candidate.manifest.id, 'entry-contract-invalid')
        );
        return;
      }
      const manifest = Object.freeze({
        schemaVersion: 1,
        id: candidate.manifest.id,
        name: candidate.manifest.name.trim(),
        version: candidate.manifest.version.trim(),
        entry: candidate.manifest.entry,
        apiVersion: 1,
        description:
          typeof candidate.manifest.description === 'string'
            ? candidate.manifest.description
            : null
      });
      records.set(manifest.id, Object.freeze({
        manifest: manifest,
        packageRoot: candidate.packageRoot,
        entryPath: entryReal,
        run: run,
        registeredAt: now()
      }));
    });
    return api;
  }

  const api = Object.freeze({
    scan: scan,
    has: function (id) { return records.has(id); },
    get: function (id) { return records.get(id) || null; },
    list: function () {
      return Object.freeze(Array.from(records.values()).map(function (record) {
        return Object.freeze({
          id: record.manifest.id,
          name: record.manifest.name,
          version: record.manifest.version,
          apiVersion: record.manifest.apiVersion,
          description: record.manifest.description
        });
      }));
    },
    issues: function () { return Object.freeze(registrationIssues.slice()); }
  });
  return api;
}

module.exports = {
  MANIFEST_LIMIT: MANIFEST_LIMIT,
  createRegistry: createRegistry,
  validateManifest: validateManifest
};
