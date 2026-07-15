/**
 * Tracker and Analytics Blocker
 * v1.3.0 — Idempotência anti-vazamento (cron-review-1)
 */

'use strict';

const logger = require('../utils/logger');

// Idempotência: sessions já configuradas (onBeforeRequest substitui, mas
// evitamos trabalho redundante em reabertura de perfis)
const _configuredSessions = new WeakSet();

// Blocked domains
const BLOCKED_DOMAINS = new Set([
  // Analytics
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',

  // Ads
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',

  // Social tracking
  // NOTE: connect.facebook.net is NOT blocked — the game's Facebook tools
  // (oas_facebook_tools.js) require the real SDK to avoid infinite retry loops.
  // Only the tracking pixel endpoint is blocked.
  'pixel.facebook.net',
  'pixel.facebook.com',

  // OAS Games tracking ONLY
  // WARNING: odp3.oasgames.com is the GAME API (servers, VIP) — DO NOT BLOCK
  // WARNING: vipsac.oasgames.com is needed for VIP store features
  'collect.mdata.cool',
  'mdata.cool',
  'pin.mdata.cool',
  'pin.oasgames.com',
  'track.oasgames.com',
  'log.oasgames.com',
  'track.narutowebgame.com',
  // 'odp3.oasgames.com'  ← GAME API: get-user-servers, getvip — CRITICAL
  // 'vipsac.oasgames.com' ← VIP store — needed for purchase features
  'dmp.oasgames.com',

  // NOTE: huoying.qq.com (Tencent CDN) is NOT blocked — the game loads
  // critical SWF files from res.huoying.qq.com (UI, empty.swf, etc.)
  // Previously blocked due to timeouts, but that was caused by Mixed Content
  // policy — now fixed with --allow-running-insecure-content.

  // Telemetry
  'sentry.io',

  // General
  'hotjar.com',
  'clarity.ms',
  'cdn.mxpnl.com'
]);

/**
 * Check if a hostname matches any blocked domain
 * @param {string} hostname - Hostname to check
 * @returns {boolean} True if blocked
 */
function isBlockedDomain(hostname) {
  for (const domain of BLOCKED_DOMAINS) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a URL should be blocked
 * @param {string} url - URL to check
 * @returns {boolean} True if should be blocked
 */
function shouldBlock(url) {
  try {
    const hostname = new URL(url).hostname;
    return isBlockedDomain(hostname);
  } catch (e) {
    return false;
  }
}

/**
 * Setup request blocker on a session.
 * Idempotente (cron-review-1): skipa se já configurada.
 * @param {Electron.Session} session - Browser session
 * @returns {boolean} true se configurou agora
 */
function setupBlocker(session) {
  if (_configuredSessions.has(session)) {
    logger.debug('Blocker: session já configurada — skip');
    return false;
  }
  _configuredSessions.add(session);

  session.webRequest.onBeforeRequest(function (details, callback) {
    if (shouldBlock(details.url)) {
      logger.debug('Bloqueado: ' + details.url);
      return callback({ cancel: true });
    }

    // Replace logintype=3 with logintype=4
    // Use boundary-aware match to avoid replacing logintype=30, logintype=301, etc.
    let url = details.url;
    if (url.includes('logintype=3')) {
      url = url.replace(/logintype=3(?=&|$)/g, 'logintype=4');
      return callback({ redirectURL: url });
    }

    callback({ cancel: false });
  });

  logger.info('Blocker: ' + BLOCKED_DOMAINS.size + ' domínios');
  return true;
}

/**
 * Reseta o estado de idempotência de uma session.
 * @param {Electron.Session} session
 */
function forgetSession(session) {
  _configuredSessions.delete(session);
}

module.exports = {
  BLOCKED_DOMAINS: BLOCKED_DOMAINS,
  isBlockedDomain: isBlockedDomain,
  shouldBlock: shouldBlock,
  setupBlocker: setupBlocker,
  forgetSession: forgetSession
};
