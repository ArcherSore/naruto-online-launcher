'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('asar');
const fixtures = require('../../../tests/helpers/automation-fixtures');

const repoRoot = path.join(__dirname, '..', '..', '..');
const scriptsRoot = path.join(repoRoot, 'automation-scripts');

function packageFiles() {
  const files = [];
  fs.readdirSync(scriptsRoot, { withFileTypes: true }).forEach(function (packageEntry) {
    if (!packageEntry.isDirectory()) return;
    const packageRoot = path.join(scriptsRoot, packageEntry.name);
    function walk(directory) {
      fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(candidate);
        else if (entry.isFile()) files.push(path.relative(scriptsRoot, candidate).replace(/\\/g, '/'));
      });
    }
    walk(packageRoot);
  });
  return files.sort();
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

describe('built-in package discovery parity', () => {
  let asarPath;

  beforeAll(async function () {
    const configured = process.env.AUTOMATION_ASAR_PATH;
    if (configured) {
      asarPath = path.resolve(configured);
      return;
    }
    const tempRoot = fixtures.createTempRoot('automation-discovery-asar-');
    asarPath = path.join(tempRoot, 'automation-scripts.asar');
    await asar.createPackage(scriptsRoot, asarPath);
  });

  afterAll(function () {
    fixtures.cleanupTempRoots();
  });

  test('electron-builder includes the complete immutable script resource root', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.build.files).toContain('automation-scripts/**');
    expect(pkg.build.extraResources || []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ from: expect.stringContaining('automation-scripts') })
    ]));
    expect(packageFiles()).toContain('demo/assets/vision/entry-activity.png');
  });

  test('manifest, entry, relative modules, and assets match the ASAR byte-for-byte', () => {
    expect(fs.existsSync(asarPath)).toBe(true);
    const expected = packageFiles();
    const prefix = process.env.AUTOMATION_ASAR_PATH ? 'automation-scripts/' : '';
    const packaged = asar.listPackage(asarPath)
      .map(function (entry) {
        const apiPath = entry.replace(/^[/\\]+/, '');
        const normalized = apiPath.replace(/\\/g, '/');
        const stat = asar.statFile(asarPath, apiPath);
        return stat && stat.files ? null : normalized;
      })
      .filter(function (entry) {
        if (!entry) return false;
        return prefix ? entry.startsWith(prefix) && entry.split('/').length > 2 : entry.split('/').length > 1;
      })
      .map(function (entry) { return prefix ? entry.slice(prefix.length) : entry; })
      .sort();
    expect(packaged).toEqual(expected);
    expected.forEach(function (relativePath) {
      const development = fs.readFileSync(path.join(scriptsRoot, relativePath));
      const archiveEntry = (prefix + relativePath).split('/').join(path.sep);
      expect(digest(asar.extractFile(asarPath, archiveEntry))).toBe(digest(development));
    });
  });
});
