/**
 * 安全网络元数据观察器。
 *
 * 观察事件在 webRequest 回调入口即收敛为五个字段；完整 URL、headers、
 * Cookie、body、页面源码和未知字段不会进入 entries、listener 或统计对象。
 */

'use strict';

const logger = require('../utils/logger');

const SAFE_NETWORK_FIELDS = Object.freeze([
  'resourceType',
  'origin',
  'pathname',
  'statusCode',
  'errorCode'
]);
const MAX_INSPECTOR_ENTRIES = 500;

function safeLocation(value) {
  if (typeof value !== 'string') return { origin: null, pathname: null };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { origin: null, pathname: null };
    }
    return { origin: parsed.origin, pathname: parsed.pathname };
  } catch (_) {
    return { origin: null, pathname: null };
  }
}

function safeCode(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return value.slice(0, 120).replace(/[?#].*$/, '');
}

function sanitizeNetworkDetails(details) {
  const input = details && typeof details === 'object' ? details : {};
  const location = safeLocation(input.url);
  return {
    resourceType: typeof input.resourceType === 'string' ? input.resourceType : null,
    origin: location.origin,
    pathname: location.pathname,
    statusCode: typeof input.statusCode === 'number' ? input.statusCode : null,
    errorCode: safeCode(input.errorCode !== undefined ? input.errorCode : input.error)
  };
}

function create(electronSession, profileId) {
  if (!electronSession || !electronSession.webRequest) {
    throw new TypeError('session.webRequest is required');
  }

  let entries = [];
  const listeners = [];
  let enabled = false;
  const filter = { urls: ['<all_urls>'] };

  function record(details) {
    const entry = sanitizeNetworkDetails(details);
    entries.push(entry);
    if (entries.length > MAX_INSPECTOR_ENTRIES) entries.shift();
    listeners.slice().forEach(function (callback) {
      try {
        callback(Object.assign({}, entry));
      } catch (error) {
        logger.debug('Inspector callback failed', {
          profileId: profileId,
          event: 'inspector-callback-failed',
          errorCode: error && error.name ? error.name : 'CALLBACK_FAILED'
        });
      }
    });
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    electronSession.webRequest.onBeforeRequest(filter, function (details, callback) {
      record(details);
      if (typeof callback === 'function') callback({ cancel: false });
      return { cancel: false };
    });
    electronSession.webRequest.onResponseStarted(filter, record);
    electronSession.webRequest.onErrorOccurred(filter, record);
    logger.info('Inspector enabled', { profileId: profileId, event: 'inspector-enabled' });
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    try {
      electronSession.webRequest.onBeforeRequest(filter, null);
      electronSession.webRequest.onResponseStarted(filter, null);
      electronSession.webRequest.onErrorOccurred(filter, null);
    } catch (_) {
      // Session 可能已销毁；不记录其原始错误详情。
    }
    logger.info('Inspector disabled', { profileId: profileId, event: 'inspector-disabled' });
  }

  function getEntries(requestedFilter) {
    if (requestedFilter === null || requestedFilter === undefined) {
      return entries.map(function (entry) {
        return Object.assign({}, entry);
      });
    }
    if (typeof requestedFilter !== 'object' || Array.isArray(requestedFilter)) return [];

    const keys = Object.keys(requestedFilter);
    if (
      keys.some(function (key) {
        return SAFE_NETWORK_FIELDS.indexOf(key) === -1;
      })
    )
      return [];
    return entries
      .filter(function (entry) {
        return keys.every(function (key) {
          return entry[key] === requestedFilter[key];
        });
      })
      .map(function (entry) {
        return Object.assign({}, entry);
      });
  }

  function on(event, callback) {
    if (event === 'capture' && typeof callback === 'function') listeners.push(callback);
  }

  function clear() {
    entries = [];
  }

  return {
    enable: enable,
    disable: disable,
    isEnabled: function () {
      return enabled;
    },
    getEntries: getEntries,
    getStats: function () {
      return null;
    },
    on: on,
    clear: clear,
    profileId: profileId
  };
}

module.exports = {
  create: create,
  sanitizeNetworkDetails: sanitizeNetworkDetails,
  SAFE_NETWORK_FIELDS: SAFE_NETWORK_FIELDS
};
