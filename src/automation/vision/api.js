'use strict';

const { createRunBoundAction } = require('../api');
const { AutomationError, toAutomationError } = require('../errors');
const { mapImagePointToNormalized } = require('../coordinates');
const { validTemplateId } = require('./template-loader');
const { validRect } = require('./matcher');

const FIND_KEYS = Object.freeze(['roi', 'threshold']);
const WAIT_KEYS = Object.freeze(['roi', 'threshold', 'timeoutMs', 'pollIntervalMs']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRect(rect) {
  if (!isPlainObject(rect)) throw new AutomationError('vision-input-invalid');
  const keys = Object.keys(rect).sort();
  if (keys.join(',') !== 'height,width,x,y') throw new AutomationError('vision-input-invalid');
  if (
    !Number.isInteger(rect.x) || rect.x < 0 ||
    !Number.isInteger(rect.y) || rect.y < 0 ||
    !Number.isInteger(rect.width) || rect.width <= 0 ||
    !Number.isInteger(rect.height) || rect.height <= 0
  ) {
    throw new AutomationError('vision-input-invalid');
  }
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function parseOptions(method, value) {
  const options = value === undefined ? {} : value;
  if (!isPlainObject(options)) throw new AutomationError('vision-input-invalid');
  const allowed = method === 'find' ? FIND_KEYS : WAIT_KEYS;
  Object.keys(options).forEach(function (key) {
    if (allowed.indexOf(key) === -1) throw new AutomationError('vision-input-invalid');
  });
  const threshold = options.threshold === undefined ? 0.95 : options.threshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new AutomationError('vision-input-invalid');
  }
  const parsed = {
    threshold: threshold,
    roi: options.roi === undefined ? null : parseRect(options.roi)
  };
  if (method !== 'find') {
    parsed.timeoutMs = options.timeoutMs === undefined ? 10000 : options.timeoutMs;
    parsed.pollIntervalMs = options.pollIntervalMs === undefined ? 250 : options.pollIntervalMs;
    if (
      !Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 1 || parsed.timeoutMs > 60000 ||
      !Number.isInteger(parsed.pollIntervalMs) ||
      parsed.pollIntervalMs < 50 || parsed.pollIntervalMs > 10000 ||
      parsed.pollIntervalMs > parsed.timeoutMs
    ) {
      throw new AutomationError('vision-input-invalid');
    }
    parsed.timeoutExplicit = Object.prototype.hasOwnProperty.call(options, 'timeoutMs');
  }
  return Object.freeze(parsed);
}

function createVisionApi(options) {
  const opts = options || {};
  const gate = createRunBoundAction(opts);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const setTimer = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const clearTimer = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
  if (!opts.loader || !opts.codec || !opts.matcher || !opts.backend) {
    throw new TypeError('loader, codec, matcher and backend are required');
  }

  function checkRunBoundary() {
    gate.preflight();
    if (Number.isFinite(opts.deadlineAt) && now() >= opts.deadlineAt) {
      throw new AutomationError('run-timeout');
    }
  }

  async function checkOnce(template, parsed, boundary) {
    const checkBoundary = boundary || checkRunBoundary;
    checkBoundary();
    let capture;
    try {
      capture = await opts.backend.capture(opts.profileId);
    } catch (error) {
      throw toAutomationError(error, 'capture-failed');
    }
    checkBoundary();
    const image = opts.codec.decodeCapture(capture);
    checkBoundary();
    if (parsed.roi && !validRect(parsed.roi, image.imageSize)) {
      throw new AutomationError('vision-input-invalid');
    }
    const matched = await opts.matcher.match({
      image: image,
      template: template,
      roi: parsed.roi,
      threshold: parsed.threshold,
      checkBoundary: checkBoundary
    });
    checkBoundary();
    if (!matched) return null;
    const rect = Object.freeze({
      x: matched.rect.x,
      y: matched.rect.y,
      width: matched.rect.width,
      height: matched.rect.height
    });
    const center = mapImagePointToNormalized(
      { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      image.imageSize,
      image.contentSize
    );
    return Object.freeze({ rect: rect, center: center, confidence: matched.confidence });
  }

  function prepare(templateId, optionsValue, method) {
    if (!validTemplateId(templateId)) throw new AutomationError('vision-template-id-invalid');
    return parseOptions(method, optionsValue);
  }

  function find(templateId, optionsValue) {
    let parsed;
    try {
      parsed = prepare(templateId, optionsValue, 'find');
    } catch (error) {
      return Promise.reject(error);
    }
    return gate.enqueue(async function () {
      const template = opts.loader.load(opts.scriptId, templateId);
      return checkOnce(template, parsed);
    });
  }

  function abortableSleep(milliseconds, boundary) {
    if (milliseconds <= 0) {
      boundary();
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      let settled = false;
      let timer = null;

      function cleanup() {
        if (timer) clearTimer(timer);
        if (opts.signal && typeof opts.signal.removeEventListener === 'function') {
          opts.signal.removeEventListener('abort', onAbort);
        }
      }

      function finish(callback) {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      }

      function onAbort() {
        finish(function () { reject(gate.cancellationError()); });
      }

      if (opts.signal && opts.signal.aborted) {
        onAbort();
        return;
      }
      if (opts.signal && typeof opts.signal.addEventListener === 'function') {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimer(function () {
        finish(function () {
          try {
            boundary();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }, milliseconds);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
  }

  function wait(method, templateId, optionsValue) {
    let parsed;
    let localDeadlineAt;
    try {
      parsed = prepare(templateId, optionsValue, method);
      const calledAt = now();
      if (!Number.isFinite(opts.deadlineAt) || calledAt >= opts.deadlineAt) {
        throw new AutomationError('run-timeout');
      }
      if (parsed.timeoutExplicit && calledAt + parsed.timeoutMs > opts.deadlineAt) {
        throw new AutomationError('vision-input-invalid');
      }
      localDeadlineAt = parsed.timeoutExplicit
        ? calledAt + parsed.timeoutMs
        : Math.min(calledAt + parsed.timeoutMs, opts.deadlineAt);
    } catch (error) {
      return Promise.reject(error);
    }

    return gate.enqueue(async function () {
      function checkWaitBoundary() {
        checkRunBoundary();
        if (now() >= localDeadlineAt) throw new AutomationError('vision-timeout');
      }

      checkWaitBoundary();
      const template = opts.loader.load(opts.scriptId, templateId);
      while (true) {
        checkWaitBoundary();
        const result = await checkOnce(template, parsed, checkWaitBoundary);
        checkWaitBoundary();
        if (method === 'waitFor' && result) return result;
        if (method === 'waitUntilGone' && !result) return true;
        const remainingLocal = localDeadlineAt - now();
        const remainingRun = opts.deadlineAt - now();
        await abortableSleep(
          Math.min(parsed.pollIntervalMs, remainingLocal, remainingRun),
          checkWaitBoundary
        );
      }
    });
  }

  return Object.freeze({
    find: find,
    waitFor: function (templateId, optionsValue) {
      return wait('waitFor', templateId, optionsValue);
    },
    waitUntilGone: function (templateId, optionsValue) {
      return wait('waitUntilGone', templateId, optionsValue);
    }
  });
}

module.exports = {
  createVisionApi: createVisionApi,
  parseOptions: parseOptions
};
