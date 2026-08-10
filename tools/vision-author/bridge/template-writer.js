'use strict';

const defaultFs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validTemplateId } = require('../../../src/automation/vision/template-loader');

const DEFAULT_GRANT_TTL_MS = 30000;

function writerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isInsideOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (
    relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
  );
}

function statIdentity(stat, targetPath) {
  return Object.freeze({
    path: path.resolve(targetPath).toLowerCase(),
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  });
}

function sameIdentity(left, right) {
  return !!left && !!right &&
    left.path === right.path && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function createTemplateWriter(options) {
  const opts = options || {};
  if (!opts.catalog || typeof opts.catalog.resolve !== 'function') throw new TypeError('catalog is required');
  const fs = opts.fs || defaultFs;
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const scriptsRoot = path.join(repoRoot, 'automation-scripts');
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const grantTtlMs = Number.isInteger(opts.grantTtlMs) ? opts.grantTtlMs : DEFAULT_GRANT_TTL_MS;
  const grants = new Map();
  const ready = new Map();

  function bindingKey(request) {
    return [
      request.sessionId,
      request.frozenFrameId,
      request.previewId,
      request.scriptId,
      request.templateId
    ].join('\u0000');
  }

  function validateBinding(request) {
    if (
      !request || typeof request !== 'object' ||
      typeof request.sessionId !== 'string' || !request.sessionId ||
      typeof request.frozenFrameId !== 'string' || !request.frozenFrameId ||
      typeof request.previewId !== 'string' || !request.previewId ||
      typeof request.scriptId !== 'string' || !request.scriptId
    ) {
      throw writerError('invalid-request');
    }
    if (!validTemplateId(request.templateId)) throw writerError('template-id-invalid');
  }

  function assertSafeExistingDirectory(directory, parent) {
    const lexical = path.resolve(directory);
    if (!isInsideOrEqual(path.resolve(parent), lexical)) throw writerError('target-boundary-invalid');
    if (!fs.existsSync(lexical)) return false;
    try {
      const lstat = fs.lstatSync(lexical);
      if (lstat.isSymbolicLink() || !lstat.isDirectory()) throw new Error('unsafe-directory');
      const real = fs.realpathSync(lexical);
      const parentReal = fs.realpathSync(parent);
      if (!isInsideOrEqual(parentReal, real)) throw new Error('directory-escape');
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw writerError('target-boundary-invalid');
    }
  }

  function locateTarget(visionRoot, filename) {
    if (!fs.existsSync(visionRoot)) return null;
    let entryName;
    try {
      const entries = fs.readdirSync(visionRoot);
      entryName = entries.find(function (name) { return name.toLowerCase() === filename.toLowerCase(); });
    } catch (_) {
      throw writerError('target-boundary-invalid');
    }
    if (!entryName) return null;
    const targetPath = path.join(visionRoot, entryName);
    try {
      const lstat = fs.lstatSync(targetPath);
      if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error('unsafe-target');
      const targetReal = fs.realpathSync(targetPath);
      const visionReal = fs.realpathSync(visionRoot);
      if (!isInsideOrEqual(visionReal, targetReal)) throw new Error('target-escape');
      const stat = fs.statSync(targetReal);
      return Object.freeze({
        path: targetPath,
        name: entryName,
        identity: statIdentity(stat, targetPath)
      });
    } catch (_) {
      throw writerError('target-boundary-invalid');
    }
  }

  function prepare(request) {
    validateBinding(request);
    const record = opts.catalog.resolve(request.scriptId);
    const packageRoot = path.resolve(record.packageRoot);
    if (!isInsideOrEqual(scriptsRoot, packageRoot)) throw writerError('target-boundary-invalid');
    assertSafeExistingDirectory(scriptsRoot, repoRoot);
    if (!assertSafeExistingDirectory(packageRoot, scriptsRoot)) throw writerError('target-boundary-invalid');
    const assetsRoot = path.join(packageRoot, 'assets');
    const visionRoot = path.join(assetsRoot, 'vision');
    if (fs.existsSync(assetsRoot)) assertSafeExistingDirectory(assetsRoot, packageRoot);
    if (fs.existsSync(visionRoot)) assertSafeExistingDirectory(visionRoot, assetsRoot);
    const filename = request.templateId + '.png';
    const desiredPath = path.join(visionRoot, filename);
    if (!isInsideOrEqual(packageRoot, assetsRoot) || !isInsideOrEqual(assetsRoot, visionRoot) || !isInsideOrEqual(visionRoot, desiredPath)) {
      throw writerError('target-boundary-invalid');
    }
    const existing = locateTarget(visionRoot, filename);
    const targetPath = existing ? existing.path : desiredPath;
    const relativePath = path.relative(repoRoot, targetPath).split(path.sep).join('/');
    if (!relativePath.startsWith('automation-scripts/')) throw writerError('target-boundary-invalid');
    return Object.freeze({
      packageRoot: packageRoot,
      assetsRoot: assetsRoot,
      visionRoot: visionRoot,
      desiredPath: desiredPath,
      targetPath: targetPath,
      relativePath: relativePath,
      existing: existing
    });
  }

  function createGrant(request, prepared) {
    const grantId = crypto.randomBytes(24).toString('hex');
    grants.set(grantId, Object.freeze({
      id: grantId,
      key: bindingKey(request),
      targetIdentity: prepared.existing.identity,
      expiresAt: now() + grantTtlMs
    }));
    return grantId;
  }

  function preflight(request) {
    const prepared = prepare(request);
    const key = bindingKey(request);
    ready.delete(key);
    if (prepared.existing) {
      const replacementGrant = createGrant(request, prepared);
      return {
        status: 'confirmation-required',
        relativePath: prepared.relativePath,
        replacementGrant: replacementGrant
      };
    }
    ready.set(key, Object.freeze({ createdAt: now(), relativePath: prepared.relativePath }));
    return { status: 'ready', relativePath: prepared.relativePath };
  }

  function ensureDirectories(prepared) {
    if (!fs.existsSync(prepared.assetsRoot)) fs.mkdirSync(prepared.assetsRoot);
    assertSafeExistingDirectory(prepared.assetsRoot, prepared.packageRoot);
    if (!fs.existsSync(prepared.visionRoot)) fs.mkdirSync(prepared.visionRoot);
    assertSafeExistingDirectory(prepared.visionRoot, prepared.assetsRoot);
  }

  function writeAtomic(prepared, bytes, expectedIdentity, replacing) {
    ensureDirectories(prepared);
    const current = locateTarget(prepared.visionRoot, path.basename(prepared.desiredPath));
    if (replacing) {
      if (!current || !sameIdentity(current.identity, expectedIdentity)) {
        throw writerError('replacement-confirmation-invalid');
      }
    } else if (current) {
      throw writerError('target-conflict');
    }
    const targetPath = current ? current.path : prepared.desiredPath;
    const tempPath = path.join(
      prepared.visionRoot,
      '.vision-author-' + process.pid + '-' + crypto.randomBytes(12).toString('hex')
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(tempPath, 'wx');
      let offset = 0;
      while (offset < bytes.length) {
        offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      }
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      const beforeRename = locateTarget(prepared.visionRoot, path.basename(prepared.desiredPath));
      if (replacing) {
        if (!beforeRename || !sameIdentity(beforeRename.identity, expectedIdentity)) {
          throw writerError('replacement-confirmation-invalid');
        }
      } else if (beforeRename) {
        throw writerError('target-conflict');
      }
      fs.renameSync(tempPath, targetPath);
      return targetPath;
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) { /* cleanup remains best effort */ }
      }
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { /* cleanup remains best effort */ }
      if (error && error.code && [
        'target-conflict',
        'replacement-confirmation-invalid',
        'target-boundary-invalid'
      ].indexOf(error.code) !== -1) throw error;
      throw writerError('storage-write-failed');
    }
  }

  function commit(request, bytes, imageSize) {
    validateBinding(request);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || !imageSize || !Number.isInteger(imageSize.width) || imageSize.width <= 0 || !Number.isInteger(imageSize.height) || imageSize.height <= 0) {
      throw writerError('invalid-request');
    }
    const key = bindingKey(request);
    let prepared = prepare(request);
    let replacing = false;
    let expectedIdentity = null;
    if (request.replacementGrant !== undefined) {
      const grant = grants.get(request.replacementGrant);
      grants.delete(request.replacementGrant);
      if (!grant || grant.key !== key || grant.expiresAt < now() || !prepared.existing || !sameIdentity(grant.targetIdentity, prepared.existing.identity)) {
        throw writerError('replacement-confirmation-invalid');
      }
      replacing = true;
      expectedIdentity = grant.targetIdentity;
    } else {
      const readiness = ready.get(key);
      ready.delete(key);
      if (!readiness || prepared.existing) throw writerError('target-conflict');
    }
    const targetPath = writeAtomic(prepared, bytes, expectedIdentity, replacing);
    prepared = Object.assign({}, prepared, { targetPath: targetPath });
    return {
      saved: true,
      replaced: replacing,
      relativePath: path.relative(repoRoot, targetPath).split(path.sep).join('/'),
      imageSize: { width: imageSize.width, height: imageSize.height }
    };
  }

  function clearSession(sessionId) {
    grants.forEach(function (grant, id) {
      if (grant.key.split('\u0000')[0] === sessionId) grants.delete(id);
    });
    ready.forEach(function (_value, key) {
      if (key.split('\u0000')[0] === sessionId) ready.delete(key);
    });
  }

  return Object.freeze({
    clearSession: clearSession,
    commit: commit,
    preflight: preflight
  });
}

module.exports = {
  DEFAULT_GRANT_TTL_MS: DEFAULT_GRANT_TTL_MS,
  createTemplateWriter: createTemplateWriter,
  sameIdentity: sameIdentity,
  writerError: writerError
};
