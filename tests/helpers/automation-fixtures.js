'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const createdRoots = new Set();

function createTempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'launcher-automation-'));
  createdRoots.add(root);
  return root;
}

function createTempUserData() {
  return createTempRoot('launcher-automation-user-data-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createScriptPackage(root, directoryName, options) {
  const opts = options || {};
  const packageRoot = path.join(root, directoryName);
  const manifest = Object.assign(
    {
      schemaVersion: 1,
      id: directoryName,
      name: directoryName,
      version: '1.0.0',
      entry: 'index.js',
      apiVersion: 1
    },
    opts.manifest || {}
  );

  fs.mkdirSync(packageRoot, { recursive: true });
  if (opts.rawManifest !== undefined) {
    fs.writeFileSync(path.join(packageRoot, 'manifest.json'), opts.rawManifest, 'utf8');
  } else {
    writeJson(path.join(packageRoot, 'manifest.json'), manifest);
  }

  if (opts.entry !== false) {
    const entryPath = path.join(packageRoot, manifest.entry || 'index.js');
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(
      entryPath,
      opts.entrySource || "module.exports = async function () {};\n",
      'utf8'
    );
  }
  return packageRoot;
}

function createClock(startAt) {
  let now = Number.isFinite(startAt) ? startAt : 0;
  return Object.freeze({
    now: function () {
      return now;
    },
    advance: function (milliseconds) {
      now += milliseconds;
      return now;
    }
  });
}

function cleanupTempRoots() {
  createdRoots.forEach(function (root) {
    fs.rmSync(root, { recursive: true, force: true });
  });
  createdRoots.clear();
}

module.exports = {
  createTempRoot: createTempRoot,
  createTempUserData: createTempUserData,
  createScriptPackage: createScriptPackage,
  createClock: createClock,
  cleanupTempRoots: cleanupTempRoots,
  writeJson: writeJson
};
