'use strict';

const fs = require('fs');
const path = require('path');

describe('Vision Author release boundary', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');

  test('electron-builder allowlist excludes tools while retaining automation scripts', () => {
    const packageJson = require('../../../package.json');
    expect(packageJson.build.files).toContain('automation-scripts/**');
    expect(packageJson.build.files.some(entry => /tools[\\/]vision-author/i.test(entry))).toBe(false);
    expect(Object.keys(packageJson.scripts).some(name => /vision|author/i.test(name))).toBe(false);
  });

  test('formal src/main.js has zero Author require, flag or environment hook', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
    expect(source).not.toMatch(/vision-author|launcher-bootstrap|VISION_AUTHOR|naruto-vision-author/i);
  });

  test('packaged bootstrap fails closed before listener creation', () => {
    const bootstrap = require('../launcher-bootstrap');
    const result = bootstrap.validateDeveloperEnvironment({
      app: { isPackaged: true, getAppPath: function () { return repoRoot; } },
      processObject: { type: 'browser', defaultApp: true },
      repoRoot: repoRoot
    });
    expect(result).toEqual({ ok: false, code: 'packaged' });
  });

  test('simulated app.asar manifest rejects every tool/entry/protocol marker and requires automation assets', () => {
    const verifier = require('../scripts/assert-package-excluded');
    expect(function () {
      verifier.assertPackageEntries([
        '/src/main.js',
        '/src/automation/backend.js',
        '/automation-scripts/demo-click/manifest.json',
        '/automation-scripts/demo-click/assets/vision/sample-target.png'
      ]);
    }).not.toThrow();
    [
      '/tools/vision-author/app/main.js',
      '/launcher-bootstrap.js',
      '/src/naruto-vision-author-protocol.js'
    ].forEach(function (entry) {
      expect(function () {
        verifier.assertPackageEntries(['/src/main.js', '/automation-scripts/demo-click/manifest.json', entry]);
      }).toThrow(expect.objectContaining({ code: 'vision-author-release-boundary' }));
    });
  });
});

