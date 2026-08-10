'use strict';

const path = require('path');
const { createRegistry } = require('../../../src/automation/registry');
const helpers = require('./helpers');

describe('Author registry catalog', () => {
  let root;
  afterEach(function () { helpers.cleanup(root); root = null; });

  test('uses the formal registry startup snapshot and returns only ScriptOption fields', () => {
    root = helpers.createTempRoot('vision-author-catalog-');
    helpers.createScriptPackage(root, { directoryName: 'actual-package-dir', id: 'manifest-script-id' });
    const registry = createRegistry({ rootDir: path.join(root, 'automation-scripts') });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });

    expect(catalog.listScripts()).toEqual({
      scripts: [{
        id: 'manifest-script-id',
        name: '可信脚本',
        version: '1.0.0',
        apiVersion: 1,
        description: null
      }]
    });
    expect(JSON.stringify(catalog.listScripts())).not.toMatch(/packageRoot|entryPath|actual-package-dir|\\|\//);
    expect(catalog.resolve('manifest-script-id').packageRoot).toBe(
      path.join(root, 'automation-scripts', 'actual-package-dir')
    );
  });

  test('rejects forged ids and does not hot-add packages after the startup snapshot', () => {
    root = helpers.createTempRoot('vision-author-catalog-');
    helpers.createScriptPackage(root, { directoryName: 'first', id: 'first-script' });
    const registry = createRegistry({ rootDir: path.join(root, 'automation-scripts') });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    expect(function () { catalog.resolve('forged-script'); }).toThrow(
      expect.objectContaining({ code: 'script-not-found' })
    );
    helpers.createScriptPackage(root, { directoryName: 'later', id: 'later-script' });
    expect(catalog.listScripts().scripts.map(item => item.id)).toEqual(['first-script']);
  });

  test('revalidates the registry package record at save time', () => {
    root = helpers.createTempRoot('vision-author-catalog-');
    const fixture = helpers.createScriptPackage(root, { id: 'target-script' });
    const registry = createRegistry({ rootDir: fixture.scriptsRoot });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    helpers.cleanup(fixture.packageRoot);
    expect(function () { catalog.resolve('target-script'); }).toThrow(
      expect.objectContaining({ code: 'script-not-found' })
    );
  });
});

