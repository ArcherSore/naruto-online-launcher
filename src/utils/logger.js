/**
 * 集中式安全日志边界。
 *
 * 消息在进入 electron-log 前删除 URL query/fragment 与常见认证材料；结构化
 * 数据只接受契约 allowlist，未知字段默认丢弃。
 */

'use strict';

const log = require('electron-log');

const __SHINOBI_DEBUG = process.env.SHINOBI_DEBUG === '1' || process.env.SHINOBI_DEBUG === 'true';
log.transports.file.level = 'info';
log.transports.console.level = (
  process.env.LOG_LEVEL || (__SHINOBI_DEBUG ? 'debug' : 'info')
).toLowerCase();
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.maxFiles = 3;

const ICONS = Object.freeze({
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]'
});

const SAFE_LOG_FIELDS = Object.freeze([
  'runId',
  'profileId',
  'profileLabel',
  'scriptId',
  'packageName',
  'registeredCount',
  'issueCount',
  'status',
  'action',
  'durationMs',
  'stage',
  'event',
  'role',
  'origin',
  'pathname',
  'resourceType',
  'statusCode',
  'errorCode',
  'retryCount',
  'retryLimit',
  'timestamp'
]);

const SAFE_LOG_FIELD_SET = new Set(SAFE_LOG_FIELDS);

function safeUrlText(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '[redacted-url]';
    return parsed.origin + parsed.pathname;
  } catch (_) {
    return '[redacted-url]';
  }
}

function sanitizeMessage(value) {
  let message = typeof value === 'string' ? value : String(value === undefined ? '' : value);

  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, function (url) {
    return safeUrlText(url);
  });
  message = message.replace(
    /\b(set-cookie|cookie)\s*:\s*.*?(?=\s+(?:authorization|set-cookie|cookie)\s*:|$)/gi,
    '$1: [redacted]'
  );
  message = message.replace(
    /\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi,
    'Authorization: [redacted]'
  );
  message = message.replace(
    /\b(openid|access_token|ticket|skey|p_skey|uin|qqidentity|jwt)\s*=\s*[^\s&#,;]+/gi,
    '$1=[redacted]'
  );
  message = message.replace(/\b[1-9]\d{4,11}\b/g, '[identity-redacted]');

  return message;
}

function sanitizeOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function sanitizePathname(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value, 'https://safe.invalid').pathname;
  } catch (_) {
    return null;
  }
}

function sanitizeFields(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object' || Array.isArray(data)) return sanitizeMessage(data);

  const safe = {};
  Object.keys(data).forEach(function (field) {
    if (!SAFE_LOG_FIELD_SET.has(field)) return;
    if (field === 'origin') {
      const origin = sanitizeOrigin(data[field]);
      if (origin !== null) safe[field] = origin;
      return;
    }
    if (field === 'pathname') {
      const pathname = sanitizePathname(data[field]);
      if (pathname !== null) safe[field] = pathname;
      return;
    }

    const value = data[field];
    if (typeof value === 'string') safe[field] = sanitizeMessage(value).slice(0, 512);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[field] = value;
    }
  });
  return safe;
}

function formatMessage(level, msg) {
  const icon = ICONS[level] || '';
  return icon + ' [Launcher] ' + sanitizeMessage(msg);
}

function write(level, msg, data) {
  const formatted = formatMessage(level, msg);
  try {
    if (data !== undefined) log[level](formatted, sanitizeFields(data));
    else log[level](formatted);
  } catch (_) {
    // Logging must never interrupt launcher or trusted script execution.
  }
}

function createBoundLogger(boundFields) {
  const safeBound = sanitizeFields(boundFields || {}) || {};

  function boundWrite(level, event, fields) {
    const safeFields = sanitizeFields(fields || {}) || {};
    Object.keys(safeBound).forEach(function (key) {
      safeFields[key] = safeBound[key];
    });
    write(level, event, safeFields);
  }

  return Object.freeze({
    debug: function (event, fields) {
      boundWrite('debug', event, fields);
    },
    info: function (event, fields) {
      boundWrite('info', event, fields);
    },
    warn: function (event, fields) {
      boundWrite('warn', event, fields);
    },
    error: function (event, fields) {
      boundWrite('error', event, fields);
    }
  });
}

const logger = {
  debug: function (msg, data) {
    write('debug', msg, data);
  },
  info: function (msg, data) {
    write('info', msg, data);
  },
  warn: function (msg, data) {
    write('warn', msg, data);
  },
  error: function (msg, data) {
    write('error', msg, data);
  },
  sanitizeMessage: sanitizeMessage,
  sanitizeFields: sanitizeFields,
  createBoundLogger: createBoundLogger,
  SAFE_LOG_FIELDS: SAFE_LOG_FIELDS
};

module.exports = logger;
