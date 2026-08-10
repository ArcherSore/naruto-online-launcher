'use strict';

const defaultCrypto = require('crypto');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
const REQUEST_KEYS = Object.freeze(['op', 'payload', 'protocolVersion', 'requestId', 'type']);

const ERROR_DETAILS = Object.freeze({
  'authentication-failed': ['Vision Author 连接认证失败。', '关闭该会话并从开发入口重新启动。'],
  'protocol-invalid': ['Vision Author 连接协议无效。', '关闭该会话并从开发入口重新启动。'],
  'message-too-large': ['Vision Author 消息超过安全上限。', '重新 capture，若持续失败请重启开发会话。'],
  'invalid-request': ['Vision Author 请求无效。', '刷新工具状态后重试。'],
  'profile-not-found': ['所选 Profile 已不存在。', '刷新 Profile 列表并重新选择。'],
  'profile-unavailable': ['所选 Profile 当前无法 capture。', '启动或恢复该 Profile 后重试。'],
  'capture-busy': ['上一轮 capture 尚未完成。', '等待后续计划 tick。'],
  'capture-failed': ['正式 Profile capture 失败。', '确认 Profile 窗口可用后继续 Live。'],
  'clipboard-failed': ['系统剪贴板写入失败。', '保留屏幕文本并手工复制。'],
  'frame-stale': ['目标帧已失效。', '恢复 Live 并重新 Freeze 当前帧。'],
  'frame-contract-invalid': ['当前帧不满足 Vision authoring 合同。', '修复画面尺寸合同后重新 capture。'],
  'selection-invalid': ['选区不是有效截图像素矩形。', '在图像范围内重新框选非零区域。'],
  'preview-stale': ['Template preview 已失效。', '在当前冻结帧重新选择 Template。'],
  'script-not-found': ['Target Script 已失效。', '重启开发会话以刷新可信脚本列表。'],
  'template-id-invalid': ['templateId 格式无效。', '使用 1–64 位小写字母、数字和单连字符。'],
  'target-conflict': ['目标模板已存在或状态已变化。', '核对确切目标并重新确认替换。'],
  'replacement-confirmation-invalid': ['替换确认已失效。', '重新执行保存预检并确认确切目标。'],
  'target-boundary-invalid': ['模板目标不在可信脚本边界内。', '修复脚本目录后重启开发会话。'],
  'storage-write-failed': ['模板写入失败。', '检查目录权限后重试；原文件保持不变。'],
  'connection-closed': ['Vision Author 连接已关闭。', '从开发入口重新启动会话。']
});

const OP_FIELDS = Object.freeze({
  hello: Object.freeze(['token']),
  'profiles.list': Object.freeze([]),
  'scripts.list': Object.freeze([]),
  capture: Object.freeze(['profileId', 'selectionEpoch']),
  'frame.displayed': Object.freeze(['frameId', 'profileId', 'selectionEpoch']),
  'frame.freeze': Object.freeze(['frameId', 'profileId', 'selectionEpoch']),
  'frame.release': Object.freeze(['frameId']),
  'preview.create': Object.freeze(['frozenFrameId', 'templateRect']),
  'template.save.preflight': Object.freeze([
    'frozenFrameId',
    'previewId',
    'scriptId',
    'templateId'
  ]),
  'template.save.commit': Object.freeze([
    'frozenFrameId',
    'previewId',
    'replacementGrant',
    'scriptId',
    'templateId'
  ]),
  'session.close': Object.freeze([])
});

function ProtocolError(code) {
  Error.call(this, code);
  this.name = 'ProtocolError';
  this.code = code;
  this.message = code;
  if (Error.captureStackTrace) Error.captureStackTrace(this, ProtocolError);
}
ProtocolError.prototype = Object.create(Error.prototype);
ProtocolError.prototype.constructor = ProtocolError;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed) {
  const keys = Object.keys(value).sort();
  const expected = allowed.slice().sort();
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] !== expected[index]) return false;
  }
  return true;
}

function nonEmptyString(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validRect(rect) {
  return (
    plainObject(rect) &&
    exactKeys(rect, ['height', 'width', 'x', 'y']) &&
    Number.isInteger(rect.x) &&
    rect.x >= 0 &&
    Number.isInteger(rect.y) &&
    rect.y >= 0 &&
    Number.isInteger(rect.width) &&
    rect.width > 0 &&
    Number.isInteger(rect.height) &&
    rect.height > 0
  );
}

function validatePayload(op, payload) {
  const allowed = OP_FIELDS[op];
  if (!allowed || !plainObject(payload)) return false;
  const required = op === 'template.save.commit'
    ? allowed.filter(function (key) { return key !== 'replacementGrant'; })
    : allowed;
  const keys = Object.keys(payload).sort();
  if (keys.some(function (key) { return allowed.indexOf(key) === -1; })) return false;
  if (required.some(function (key) { return !Object.prototype.hasOwnProperty.call(payload, key); })) {
    return false;
  }
  if (op === 'hello') return /^[a-f0-9]{64}$/.test(payload.token);
  if (op === 'profiles.list' || op === 'scripts.list' || op === 'session.close') {
    return keys.length === 0;
  }
  if (op === 'capture') {
    return nonEmptyString(payload.profileId, 80) && Number.isInteger(payload.selectionEpoch) && payload.selectionEpoch >= 0;
  }
  if (op === 'frame.displayed' || op === 'frame.freeze') {
    return nonEmptyString(payload.frameId, 128) &&
      nonEmptyString(payload.profileId, 80) &&
      Number.isInteger(payload.selectionEpoch) &&
      payload.selectionEpoch >= 0;
  }
  if (op === 'frame.release') return nonEmptyString(payload.frameId, 128);
  if (op === 'preview.create') {
    return nonEmptyString(payload.frozenFrameId, 128) && validRect(payload.templateRect);
  }
  if (op === 'template.save.preflight' || op === 'template.save.commit') {
    return nonEmptyString(payload.frozenFrameId, 128) &&
      nonEmptyString(payload.previewId, 128) &&
      nonEmptyString(payload.scriptId, 64) &&
      nonEmptyString(payload.templateId, 64) &&
      (payload.replacementGrant === undefined || nonEmptyString(payload.replacementGrant, 256));
  }
  return false;
}

function encodeMessage(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > MAX_MESSAGE_BYTES) throw new ProtocolError('message-too-large');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function createFrameDecoder(options) {
  const opts = options || {};
  if (typeof opts.onMessage !== 'function') throw new TypeError('onMessage is required');
  const maximum = Number.isInteger(opts.maxBytes) ? opts.maxBytes : MAX_MESSAGE_BYTES;
  let buffered = Buffer.alloc(0);

  function push(chunk) {
    if (!Buffer.isBuffer(chunk)) throw new ProtocolError('protocol-invalid');
    buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (length === 0) throw new ProtocolError('protocol-invalid');
      if (length > maximum) throw new ProtocolError('message-too-large');
      if (buffered.length < length + 4) return;
      const payload = buffered.slice(4, length + 4);
      buffered = buffered.slice(length + 4);
      let value;
      try {
        value = JSON.parse(payload.toString('utf8'));
      } catch (_) {
        throw new ProtocolError('protocol-invalid');
      }
      if (!plainObject(value)) throw new ProtocolError('protocol-invalid');
      opts.onMessage(value);
    }
  }

  return Object.freeze({ push: push, clear: function () { buffered = Buffer.alloc(0); } });
}

function createConnectionProtocol(options) {
  const opts = options || {};
  if (typeof opts.token !== 'string' || !/^[a-f0-9]{64}$/.test(opts.token)) {
    throw new TypeError('valid token is required');
  }
  const crypto = opts.crypto || defaultCrypto;
  const expected = Buffer.from(opts.token, 'hex');
  const seen = new Set();
  let isAuthenticated = false;

  function accept(message) {
    if (!plainObject(message) || !exactKeys(message, REQUEST_KEYS)) {
      throw new ProtocolError('invalid-request');
    }
    if (
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.type !== 'request' ||
      !nonEmptyString(message.requestId, 128) ||
      !nonEmptyString(message.op, 80)
    ) {
      throw new ProtocolError('protocol-invalid');
    }
    if (seen.has(message.requestId)) throw new ProtocolError('protocol-invalid');
    seen.add(message.requestId);
    if (!Object.prototype.hasOwnProperty.call(OP_FIELDS, message.op)) {
      throw new ProtocolError('invalid-request');
    }
    if (!validatePayload(message.op, message.payload)) throw new ProtocolError('invalid-request');

    if (!isAuthenticated) {
      if (message.op !== 'hello') throw new ProtocolError('authentication-failed');
      const suppliedValid = /^[a-f0-9]{64}$/.test(message.payload.token);
      const supplied = suppliedValid ? Buffer.from(message.payload.token, 'hex') : Buffer.alloc(32);
      let matches = false;
      try {
        matches = crypto.timingSafeEqual(expected, supplied);
      } catch (_) {
        matches = false;
      }
      if (!suppliedValid || !matches) throw new ProtocolError('authentication-failed');
      isAuthenticated = true;
      expected.fill(0);
      return Object.freeze({ kind: 'hello', requestId: message.requestId });
    }
    if (message.op === 'hello') throw new ProtocolError('protocol-invalid');
    return Object.freeze({
      kind: 'request',
      requestId: message.requestId,
      op: message.op,
      payload: message.payload
    });
  }

  return Object.freeze({
    accept: accept,
    authenticated: function () { return isAuthenticated; },
    dispose: function () { expected.fill(0); seen.clear(); }
  });
}

function safeError(error) {
  const code = error && Object.prototype.hasOwnProperty.call(ERROR_DETAILS, error.code)
    ? error.code
    : 'invalid-request';
  const details = ERROR_DETAILS[code];
  return Object.freeze({ code: code, safeMessage: details[0], recovery: details[1] });
}

function successResponse(requestId, result) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: 'response',
    requestId: requestId,
    ok: true,
    result: result || {}
  };
}

function failureResponse(requestId, error) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: 'response',
    requestId: requestId,
    ok: false,
    error: safeError(error)
  };
}

module.exports = {
  ERROR_DETAILS: ERROR_DETAILS,
  MAX_MESSAGE_BYTES: MAX_MESSAGE_BYTES,
  OP_FIELDS: OP_FIELDS,
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  ProtocolError: ProtocolError,
  createConnectionProtocol: createConnectionProtocol,
  createFrameDecoder: createFrameDecoder,
  encodeMessage: encodeMessage,
  failureResponse: failureResponse,
  safeError: safeError,
  successResponse: successResponse,
  validRect: validRect
};
