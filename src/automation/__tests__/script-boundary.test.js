'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..', 'automation-scripts');
const forbiddenModules = new Set([
  'electron', 'child_process', 'cluster', 'dgram', 'fs', 'http', 'https', 'net', 'path', 'tls',
  'worker_threads'
]);

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce(function (files, entry) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return files.concat(javascriptFiles(candidate));
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.js') files.push(candidate);
    return files;
  }, []);
}

describe('trusted built-in script review boundary', () => {
  test('uses only relative package imports and the minimal context boundary', () => {
    const violations = [];
    javascriptFiles(root).forEach(function (filePath) {
      const source = fs.readFileSync(filePath, 'utf8');
      const packageRoot = path.dirname(path.dirname(filePath)) === root
        ? path.dirname(filePath)
        : path.join(root, path.relative(root, filePath).split(path.sep)[0]);
      const imports = Array.from(source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g));
      imports.forEach(function (match) {
        const request = match[1];
        if (forbiddenModules.has(request) || path.isAbsolute(request) || /^[A-Za-z]:[\\/]/.test(request)) {
          violations.push(path.relative(root, filePath) + ': forbidden import ' + request);
          return;
        }
        if (request.startsWith('.')) {
          const resolved = path.resolve(path.dirname(filePath), request);
          const relative = path.relative(packageRoot, resolved);
          if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            violations.push(path.relative(root, filePath) + ': import outside package');
          }
        } else {
          violations.push(path.relative(root, filePath) + ': non-relative import ' + request);
        }
      });
      if (/\b(?:BrowserWindow|webContents|profileStore|child_process)\b|\.debugger\b|\b(?:exec|spawn)\s*\(/.test(source)) {
        violations.push(path.relative(root, filePath) + ': launcher/CDP/process access');
      }
    });
    expect(violations).toEqual([]);
  });

  test('documents this as a review boundary rather than an adversarial sandbox claim', () => {
    const contract = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'specs', '003-builtin-automation-framework',
        'contracts', 'manifest-contract.md'),
      'utf8'
    );
    expect(contract).toContain('not represented as an adversarial runtime sandbox');
  });

  test('keeps profileId read-only and requires visual assets to use context.vision', () => {
    const guide = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(guide).toContain('context.profileId');
    expect(guide).toContain('context.vision');
    expect(guide).toContain('assets/vision');
    expect(guide).toMatch(/不得.*(?:覆盖|伪造).*profileId/);
    expect(guide).toMatch(/assets\/vision.*只能.*Vision API/);
  });
});
