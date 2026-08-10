'use strict';

const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../registry');
const { createVisionTemplateLoader } = require('../vision/template-loader');
const automationFixtures = require('../../../tests/helpers/automation-fixtures');
const visionFixtures = require('./vision-fixtures');

describe('script-owned Vision template loader', () => {
  let root;

  afterEach(function () { automationFixtures.cleanupTempRoots(); });

  function setupPackages() {
    root = automationFixtures.createTempRoot('vision-loader-');
    const a = automationFixtures.createScriptPackage(root, 'directory-a', {
      manifest: { id: 'script-a' }
    });
    const b = automationFixtures.createScriptPackage(root, 'directory-b', {
      manifest: { id: 'script-b' }
    });
    [a, b].forEach(function (packageRoot, index) {
      const visionRoot = path.join(packageRoot, 'assets', 'vision');
      fs.mkdirSync(visionRoot, { recursive: true });
      fs.writeFileSync(
        path.join(visionRoot, 'same-target.png'),
        visionFixtures.encodePng(1, 1, Buffer.from([index + 1, 0, 0, 255]))
      );
    });
    const registry = createRegistry({ rootDir: root });
    registry.scan();
    return { a: a, b: b, registry: registry };
  }

  test('uses registered packageRoot even when directory name differs and isolates cache keys', () => {
    const packages = setupPackages();
    const decodeTemplate = jest.fn(function (png) {
      return Object.freeze({ width: 1, height: 1, bitmap: Buffer.from([png[png.length - 9]]) });
    });
    const loader = createVisionTemplateLoader({
      registry: packages.registry,
      codec: { decodeTemplate: decodeTemplate }
    });
    const a = loader.load('script-a', 'same-target');
    const b = loader.load('script-b', 'same-target');
    expect(a.identity).toEqual({ scriptId: 'script-a', templateId: 'same-target' });
    expect(b.identity).toEqual({ scriptId: 'script-b', templateId: 'same-target' });
    expect(loader.load('script-a', 'same-target')).toBe(a);
    expect(decodeTemplate).toHaveBeenCalledTimes(2);
  });

  test('lists only safe PNG template ids for the registered script without exposing paths', () => {
    const packages = setupPackages();
    const visionRoot = path.join(packages.a, 'assets', 'vision');
    fs.writeFileSync(
      path.join(visionRoot, 'second-target.png'),
      visionFixtures.encodePng(1, 1, Buffer.from([9, 0, 0, 255]))
    );
    fs.writeFileSync(path.join(visionRoot, 'notes.txt'), Buffer.from('ignore'));
    fs.writeFileSync(
      path.join(visionRoot, 'Upper.png'),
      visionFixtures.encodePng(1, 1, Buffer.from([8, 0, 0, 255]))
    );
    const loader = createVisionTemplateLoader({
      registry: packages.registry,
      codec: { decodeTemplate: jest.fn() }
    });

    expect(loader.list('script-a')).toEqual(['same-target', 'second-target']);
    expect(Object.isFrozen(loader.list('script-a'))).toBe(true);
    expect(loader.list('script-b')).toEqual(['same-target']);
    expect(JSON.stringify(loader.list('script-a'))).not.toContain(packages.a);
  });

  test.each(['', '.', '..', '../x', 'x/y', 'x\\y', 'C:target', '%2e%2e', 'http:x', 'Upper', 'x.png', '汉字'])
  ('rejects invalid template id before any filesystem read: %s', templateId => {
    const packages = setupPackages();
    const fsApi = Object.assign({}, fs, {
      readdirSync: jest.fn(fs.readdirSync),
      readFileSync: jest.fn(fs.readFileSync)
    });
    const loader = createVisionTemplateLoader({
      registry: packages.registry,
      codec: { decodeTemplate: jest.fn() },
      fs: fsApi
    });
    const before = fsApi.readdirSync.mock.calls.length + fsApi.readFileSync.mock.calls.length;
    expect(function () { loader.load('script-a', templateId); })
      .toThrow(expect.objectContaining({ code: 'vision-template-id-invalid' }));
    expect(fsApi.readdirSync.mock.calls.length + fsApi.readFileSync.mock.calls.length).toBe(before);
  });

  test('distinguishes missing, fake PNG and exact-case mismatch without exposing paths', () => {
    const packages = setupPackages();
    const visionRoot = path.join(packages.a, 'assets', 'vision');
    fs.writeFileSync(path.join(visionRoot, 'fake.png'), Buffer.from('not png'));
    fs.writeFileSync(path.join(visionRoot, 'Case-target.png'), visionFixtures.encodePng(1, 1, Buffer.alloc(4)));
    const loader = createVisionTemplateLoader({
      registry: packages.registry,
      codec: { decodeTemplate: function () { throw new Error('C:\\secret\\raw decoder'); } }
    });
    expect(function () { loader.load('script-a', 'missing'); })
      .toThrow(expect.objectContaining({ code: 'vision-template-not-found' }));
    expect(function () { loader.load('script-a', 'case-target'); })
      .toThrow(expect.objectContaining({ code: 'vision-template-not-found' }));
    let error;
    try { loader.load('script-a', 'fake'); } catch (caught) { error = caught; }
    expect(error.code).toBe('vision-template-invalid');
    expect(error.message).not.toContain('secret');
  });
});
