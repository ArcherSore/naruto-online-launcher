'use strict';

const defaultFs = require('fs');
const path = require('path');
const { AutomationError } = require('../errors');
const { MAX_PNG_BYTES, PNG_SIGNATURE } = require('./codec');

const TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isInsideOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function validTemplateId(templateId) {
  return typeof templateId === 'string' &&
    templateId.length >= 1 &&
    templateId.length <= 64 &&
    TEMPLATE_ID_PATTERN.test(templateId);
}

function createVisionTemplateLoader(options) {
  const opts = options || {};
  const fs = opts.fs || defaultFs;
  if (!opts.registry || typeof opts.registry.get !== 'function') {
    throw new TypeError('registry is required');
  }
  if (!opts.codec || typeof opts.codec.decodeTemplate !== 'function') {
    throw new TypeError('codec is required');
  }
  const cache = new Map();

  function list(scriptId) {
    const record = opts.registry.get(scriptId);
    if (!record || typeof record.packageRoot !== 'string') {
      throw new AutomationError('vision-template-not-found');
    }
    const packageRoot = path.resolve(record.packageRoot);
    const visionRoot = path.resolve(packageRoot, 'assets', 'vision');
    if (!isInsideOrEqual(packageRoot, visionRoot)) {
      throw new AutomationError('vision-template-read-failed');
    }
    let entries;
    try {
      entries = fs.readdirSync(visionRoot, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return Object.freeze([]);
      }
      throw new AutomationError('vision-template-read-failed');
    }
    return Object.freeze(entries.reduce(function (templateIds, entry) {
      if (!entry || typeof entry.name !== 'string') return templateIds;
      if (typeof entry.isFile === 'function' && !entry.isFile()) return templateIds;
      if (!entry.name.endsWith('.png')) return templateIds;
      const templateId = entry.name.slice(0, -4);
      if (validTemplateId(templateId) && entry.name === templateId + '.png') {
        templateIds.push(templateId);
      }
      return templateIds;
    }, []).sort());
  }

  function load(scriptId, templateId) {
    if (!validTemplateId(templateId)) {
      throw new AutomationError('vision-template-id-invalid');
    }
    const record = opts.registry.get(scriptId);
    if (!record || typeof record.packageRoot !== 'string') {
      throw new AutomationError('vision-template-not-found');
    }
    const cacheKey = record.packageRoot + '\u0000' + templateId;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const packageRoot = path.resolve(record.packageRoot);
    const visionRoot = path.resolve(packageRoot, 'assets', 'vision');
    const filename = templateId + '.png';
    const candidate = path.resolve(visionRoot, filename);
    if (!isInsideOrEqual(packageRoot, visionRoot) || !isInsideOrEqual(visionRoot, candidate)) {
      throw new AutomationError('vision-template-id-invalid');
    }

    let entries;
    try {
      entries = fs.readdirSync(visionRoot, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        throw new AutomationError('vision-template-not-found');
      }
      throw new AutomationError('vision-template-read-failed');
    }
    const entry = entries.find(function (item) { return item.name === filename; });
    if (!entry) throw new AutomationError('vision-template-not-found');
    if (typeof entry.isFile === 'function' && !entry.isFile()) {
      throw new AutomationError('vision-template-read-failed');
    }

    let bytes;
    try {
      const packageReal = fs.realpathSync(packageRoot);
      const rootReal = fs.realpathSync(visionRoot);
      const candidateReal = fs.realpathSync(candidate);
      if (
        !isInsideOrEqual(packageReal, rootReal) ||
        !isInsideOrEqual(rootReal, candidateReal)
      ) {
        throw new AutomationError('vision-template-id-invalid');
      }
      if (typeof fs.lstatSync === 'function' && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new AutomationError('vision-template-id-invalid');
      }
      const stat = fs.statSync(candidateReal);
      if (!stat.isFile()) throw new AutomationError('vision-template-read-failed');
      if (stat.size > MAX_PNG_BYTES) throw new AutomationError('vision-template-invalid');
      bytes = fs.readFileSync(candidateReal);
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      if (error && error.code === 'ENOENT') {
        throw new AutomationError('vision-template-not-found');
      }
      throw new AutomationError('vision-template-read-failed');
    }
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > MAX_PNG_BYTES ||
      bytes.length < PNG_SIGNATURE.length ||
      !bytes.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      throw new AutomationError('vision-template-invalid');
    }

    let decoded;
    try {
      decoded = opts.codec.decodeTemplate(bytes);
    } catch (_) {
      throw new AutomationError('vision-template-invalid');
    }
    const template = Object.freeze({
      identity: Object.freeze({ scriptId: scriptId, templateId: templateId }),
      width: decoded.width,
      height: decoded.height,
      bitmap: Buffer.from(decoded.bitmap)
    });
    cache.set(cacheKey, template);
    return template;
  }

  return Object.freeze({ list: list, load: load });
}

module.exports = {
  TEMPLATE_ID_PATTERN: TEMPLATE_ID_PATTERN,
  createVisionTemplateLoader: createVisionTemplateLoader,
  validTemplateId: validTemplateId
};
