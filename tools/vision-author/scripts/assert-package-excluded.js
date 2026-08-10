'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('asar');

const FORBIDDEN_ENTRY = /(^|\/)(tools\/vision-author|launcher-bootstrap(?:\.js)?|[^/]*naruto-vision-author[^/]*)($|\/)/i;
const FORBIDDEN_SOURCE = /vision-author|launcher-bootstrap|VISION_AUTHOR|naruto-vision-author/i;

function boundaryError(message) {
  const error = new Error(message || 'vision-author-release-boundary');
  error.code = 'vision-author-release-boundary';
  return error;
}

function normalizeEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assertPackageEntries(entries) {
  if (!Array.isArray(entries)) throw boundaryError('asar-manifest-invalid');
  const normalized = entries.map(normalizeEntry);
  const forbidden = normalized.find(function (entry) { return FORBIDDEN_ENTRY.test(entry); });
  if (forbidden) throw boundaryError('forbidden-entry:' + forbidden);
  if (normalized.indexOf('src/main.js') === -1) throw boundaryError('formal-main-missing');
  if (!normalized.some(function (entry) {
    return /^automation-scripts\/[^/]+\/manifest\.json$/i.test(entry);
  })) {
    throw boundaryError('automation-scripts-missing');
  }
  return Object.freeze({ entries: normalized.length, forbidden: 0 });
}

function verifyAsar(asarPath) {
  const resolved = path.resolve(asarPath || '');
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw boundaryError('app-asar-missing');
  }
  const entries = asar.listPackage(resolved);
  const result = assertPackageEntries(entries);
  const mainSource = asar.extractFile(resolved, 'src/main.js').toString('utf8');
  if (FORBIDDEN_SOURCE.test(mainSource)) throw boundaryError('formal-main-author-hook');
  return result;
}

function run(argv) {
  const target = argv[2];
  const result = verifyAsar(target);
  process.stdout.write('VISION_AUTHOR_PACKAGE_EXCLUSION ' + JSON.stringify({
    ok: true,
    entries: result.entries,
    forbidden: result.forbidden
  }) + '\n');
}

if (require.main === module) {
  try {
    run(process.argv);
  } catch (error) {
    process.stderr.write('VISION_AUTHOR_PACKAGE_EXCLUSION ' + JSON.stringify({
      ok: false,
      error: error && error.code ? error.code : 'vision-author-release-boundary'
    }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  assertPackageEntries: assertPackageEntries,
  boundaryError: boundaryError,
  verifyAsar: verifyAsar
};

