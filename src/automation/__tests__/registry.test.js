'use strict';

const fs = require('fs');
const path = require('path');
const fixtures = require('../../../tests/helpers/automation-fixtures');
const { createRegistry } = require('../registry');

describe('built-in automation registry happy path', () => {
  afterEach(function () {
    fixtures.cleanupTempRoots();
  });

  test('scans deterministic direct packages and caches a direct CommonJS function export', () => {
    const root = fixtures.createTempRoot();
    fixtures.createScriptPackage(root, 'z-script', { manifest: { name: 'Z Script' } });
    fixtures.createScriptPackage(root, 'a-script', {
      manifest: { name: 'A Script', description: 'safe description' },
      entrySource: 'module.exports = function (context) { return Promise.resolve(context.profileId); };\n'
    });
    const registry = createRegistry({ rootDir: root, now: function () { return 123; } });

    expect(registry.scan()).toBe(registry);
    expect(registry.list().map(function (script) { return script.id; })).toEqual([
      'a-script',
      'z-script'
    ]);
    expect(typeof registry.get('a-script').run).toBe('function');
    expect(registry.get('a-script').registeredAt).toBe(123);
    expect(registry.scan()).toBe(registry);
    expect(registry.issues()).toEqual([]);
  });

  test('returns deeply frozen safe catalog copies without package or entry paths', () => {
    const root = fixtures.createTempRoot();
    fixtures.createScriptPackage(root, 'demo-click', {
      manifest: { name: 'Demo Click', description: 'safe' }
    });
    const registry = createRegistry({ rootDir: root });
    registry.scan();

    const catalog = registry.list();
    expect(catalog).toEqual([
      {
        id: 'demo-click',
        name: 'Demo Click',
        version: '1.0.0',
        apiVersion: 1,
        description: 'safe'
      }
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain(root);
    expect(catalog[0]).not.toHaveProperty('entry');
    expect(catalog[0]).not.toHaveProperty('run');
  });

  test('uses app.getAppPath automation-scripts as the fixed default root', () => {
    const appRoot = fixtures.createTempRoot();
    const scriptsRoot = path.join(appRoot, 'automation-scripts');
    fixtures.createScriptPackage(scriptsRoot, 'demo-click');
    const app = { getAppPath: jest.fn(function () { return appRoot; }) };
    const registry = createRegistry({ app: app });
    registry.scan();
    expect(app.getAppPath).toHaveBeenCalledWith();
    expect(registry.has('demo-click')).toBe(true);
  });
});

describe('built-in automation registry rejection isolation', () => {
  afterEach(function () {
    jest.restoreAllMocks();
    fixtures.cleanupTempRoots();
  });

  function issueCodes(registry) {
    return registry.issues().map(function (issue) {
      return [issue.packageName, issue.scriptId, issue.code];
    });
  }

  test('continues with an empty catalog for missing, unreadable, and empty roots', () => {
    const missing = path.join(fixtures.createTempRoot('registry-missing-parent-'), 'missing');
    const missingRegistry = createRegistry({ rootDir: missing });
    expect(function () { missingRegistry.scan(); }).not.toThrow();
    expect(missingRegistry.list()).toEqual([]);
    expect(missingRegistry.issues()).toEqual([expect.objectContaining({
      scope: 'root', packageName: null, scriptId: null, code: 'scripts-root-unavailable'
    })]);

    const unreadable = fixtures.createTempRoot('registry-unreadable-');
    const originalReadDir = fs.readdirSync;
    jest.spyOn(fs, 'readdirSync').mockImplementation(function (candidate, options) {
      if (path.resolve(candidate) === path.resolve(unreadable)) throw new Error('C:\\secret-root');
      return originalReadDir.call(fs, candidate, options);
    });
    const unreadableRegistry = createRegistry({ rootDir: unreadable });
    expect(function () { unreadableRegistry.scan(); }).not.toThrow();
    expect(unreadableRegistry.list()).toEqual([]);
    expect(JSON.stringify(unreadableRegistry.issues())).not.toContain('secret-root');
    jest.restoreAllMocks();

    const empty = createRegistry({ rootDir: fixtures.createTempRoot('registry-empty-') });
    empty.scan();
    expect(empty.list()).toEqual([]);
    expect(empty.issues()).toEqual([]);
  });

  test('rejects manifest read/json/field/schema/API failures without affecting a valid package', () => {
    const root = fixtures.createTempRoot('registry-invalid-manifests-');
    fixtures.createScriptPackage(root, 'valid-script');
    fixtures.createScriptPackage(root, 'too-large', { rawManifest: 'x'.repeat(64 * 1024 + 1), entry: false });
    fixtures.createScriptPackage(root, 'bad-json', { rawManifest: '{', entry: false });
    fixtures.createScriptPackage(root, 'bad-field', { manifest: { name: '' } });
    fixtures.createScriptPackage(root, 'bad-schema', { manifest: { schemaVersion: 2 } });
    fixtures.createScriptPackage(root, 'bad-api', { manifest: { apiVersion: 2 } });
    const registry = createRegistry({ rootDir: root });
    registry.scan();
    expect(registry.list().map(function (script) { return script.id; })).toEqual(['valid-script']);
    expect(issueCodes(registry)).toEqual(expect.arrayContaining([
      ['too-large', null, 'manifest-read-failed'],
      ['bad-json', null, 'manifest-json-invalid'],
      ['bad-field', 'bad-field', 'manifest-invalid'],
      ['bad-schema', 'bad-schema', 'manifest-schema-incompatible'],
      ['bad-api', 'bad-api', 'api-version-incompatible']
    ]));
  });

  test('rejects absolute, traversal, symlink escape, missing, load, and export failures independently', () => {
    const root = fixtures.createTempRoot('registry-invalid-entries-');
    const outside = fixtures.createTempRoot('registry-outside-');
    fs.writeFileSync(path.join(outside, 'outside.js'), 'module.exports = async function () {};\n');
    fixtures.createScriptPackage(root, 'absolute-entry', {
      manifest: { entry: path.join(outside, 'outside.js') }, entry: false
    });
    fixtures.createScriptPackage(root, 'traversal-entry', {
      manifest: { entry: 'nested/../index.js' }
    });
    fixtures.createScriptPackage(root, 'missing-entry', { entry: false });
    fixtures.createScriptPackage(root, 'load-failed', {
      entrySource: "throw new Error('C:\\\\secret.js cookie=secret');\n"
    });
    fixtures.createScriptPackage(root, 'bad-export', { entrySource: 'module.exports = {};\n' });
    const linkedPackage = fixtures.createScriptPackage(root, 'symlink-entry', {
      manifest: { entry: 'linked/outside.js' }, entry: false
    });
    fs.symlinkSync(outside, path.join(linkedPackage, 'linked'), 'junction');

    const registry = createRegistry({ rootDir: root });
    registry.scan();
    expect(registry.list()).toEqual([]);
    expect(issueCodes(registry)).toEqual(expect.arrayContaining([
      ['absolute-entry', 'absolute-entry', 'entry-outside-package'],
      ['traversal-entry', 'traversal-entry', 'entry-outside-package'],
      ['symlink-entry', 'symlink-entry', 'entry-outside-package'],
      ['missing-entry', 'missing-entry', 'entry-missing'],
      ['load-failed', 'load-failed', 'entry-load-failed'],
      ['bad-export', 'bad-export', 'entry-contract-invalid']
    ]));
    expect(JSON.stringify(registry.issues())).not.toMatch(/secret\.js|cookie/i);
  });

  test('rejects every NFKC/lowercase conflict member regardless of scan order', () => {
    const root = fixtures.createTempRoot('registry-conflicts-');
    fixtures.createScriptPackage(root, 'ascii-demo', { manifest: { id: 'demo' } });
    fixtures.createScriptPackage(root, 'uppercase-demo', { manifest: { id: 'DEMO' } });
    fixtures.createScriptPackage(root, 'fullwidth-demo', { manifest: { id: 'ｄｅｍｏ' } });
    fixtures.createScriptPackage(root, 'unrelated');
    const registry = createRegistry({ rootDir: root });
    registry.scan();
    expect(registry.list().map(function (script) { return script.id; })).toEqual(['unrelated']);
    expect(registry.issues().filter(function (issue) {
      return issue.code === 'script-id-conflict';
    })).toHaveLength(3);
  });
});
