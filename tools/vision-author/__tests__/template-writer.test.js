'use strict';

const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../../src/automation/registry');
const helpers = require('./helpers');

function binding(overrides) {
  return Object.assign({
    sessionId: 'session-a',
    frozenFrameId: 'frame-a',
    previewId: 'preview-a',
    scriptId: 'manifest-script',
    templateId: 'battle-button'
  }, overrides || {});
}

describe('registry-rooted atomic template writer', () => {
  let root;
  let fixture;
  let writer;
  let now;

  beforeEach(function () {
    root = helpers.createTempRoot('vision-author-writer-');
    fixture = helpers.createScriptPackage(root, {
      directoryName: 'actual-package-dir',
      id: 'manifest-script'
    });
    const registry = createRegistry({ rootDir: fixture.scriptsRoot });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    now = 1000;
    const { createTemplateWriter } = require('../bridge/template-writer');
    writer = createTemplateWriter({ catalog: catalog, repoRoot: root, now: function () { return now; } });
  });

  afterEach(function () { helpers.cleanup(root); });

  function target(templateId) {
    return path.join(fixture.packageRoot, 'assets', 'vision', (templateId || 'battle-button') + '.png');
  }

  test('uses formal templateId validation and real packageRoot for the repo-relative path', () => {
    const result = writer.preflight(binding());
    expect(result).toEqual({
      status: 'ready',
      relativePath: 'automation-scripts/actual-package-dir/assets/vision/battle-button.png'
    });
    expect(function () { writer.preflight(binding({ templateId: '../Bad.png' })); }).toThrow(
      expect.objectContaining({ code: 'template-id-invalid' })
    );
    expect(fs.existsSync(target())).toBe(false);
  });

  test('treats case-only names as conflict and requires the exact one-time grant', () => {
    fs.mkdirSync(path.dirname(target()), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(target()), 'Battle-Button.PNG'), Buffer.from('old'));
    const preflight = writer.preflight(binding());
    expect(preflight).toEqual(expect.objectContaining({
      status: 'confirmation-required',
      replacementGrant: expect.any(String)
    }));
    expect(function () {
      writer.commit(binding(), Buffer.from('new'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'target-conflict' }));
    const saved = writer.commit(
      binding({ replacementGrant: preflight.replacementGrant }),
      Buffer.from('new'),
      { width: 1, height: 1 }
    );
    expect(saved.replaced).toBe(true);
    expect(fs.readFileSync(path.join(path.dirname(target()), 'Battle-Button.PNG'))).toEqual(Buffer.from('new'));
    expect(function () {
      writer.commit(binding({ replacementGrant: preflight.replacementGrant }), Buffer.from('again'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'replacement-confirmation-invalid' }));
  });

  test('rejects absent-to-existing races with zero overwrite and requires a new confirmation', () => {
    expect(writer.preflight(binding()).status).toBe('ready');
    fs.mkdirSync(path.dirname(target()), { recursive: true });
    fs.writeFileSync(target(), Buffer.from('racer'));
    expect(function () {
      writer.commit(binding(), Buffer.from('new'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'target-conflict' }));
    expect(fs.readFileSync(target())).toEqual(Buffer.from('racer'));
    expect(writer.preflight(binding()).status).toBe('confirmation-required');
  });

  test('invalidates grants on TTL expiry or target stat drift', () => {
    fs.mkdirSync(path.dirname(target()), { recursive: true });
    fs.writeFileSync(target(), Buffer.from('old'));
    const expired = writer.preflight(binding());
    now += 31 * 1000;
    expect(function () {
      writer.commit(binding({ replacementGrant: expired.replacementGrant }), Buffer.from('new'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'replacement-confirmation-invalid' }));

    now = 2000;
    const drift = writer.preflight(binding());
    fs.writeFileSync(target(), Buffer.from('changed-size'));
    expect(function () {
      writer.commit(binding({ replacementGrant: drift.replacementGrant }), Buffer.from('new'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'replacement-confirmation-invalid' }));
    expect(fs.readFileSync(target())).toEqual(Buffer.from('changed-size'));
  });

  test('rejects symlink/junction/reparse boundaries', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(fixture.packageRoot, 'assets'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const vision = path.join(fixture.packageRoot, 'assets', 'vision');
    fs.symlinkSync(outside, vision, 'junction');
    expect(function () { writer.preflight(binding()); }).toThrow(
      expect.objectContaining({ code: 'target-boundary-invalid' })
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('same-directory exclusive temp + flush + rename leaves no temp and preserves old file on failure', () => {
    fs.mkdirSync(path.dirname(target()), { recursive: true });
    fs.writeFileSync(target(), Buffer.from('old'));
    const registry = createRegistry({ rootDir: fixture.scriptsRoot });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    const failingFs = Object.assign({}, fs, {
      renameSync: jest.fn(function () { const error = new Error('raw secret path'); error.code = 'EACCES'; throw error; })
    });
    const { createTemplateWriter } = require('../bridge/template-writer');
    const failing = createTemplateWriter({ catalog: catalog, repoRoot: root, fs: failingFs, now: function () { return now; } });
    const preflight = failing.preflight(binding());
    expect(function () {
      failing.commit(binding({ replacementGrant: preflight.replacementGrant }), Buffer.from('new'), { width: 1, height: 1 });
    }).toThrow(expect.objectContaining({ code: 'storage-write-failed' }));
    expect(fs.readFileSync(target())).toEqual(Buffer.from('old'));
    expect(fs.readdirSync(path.dirname(target())).filter(name => name.indexOf('.vision-author-') === 0)).toEqual([]);
  });
});

