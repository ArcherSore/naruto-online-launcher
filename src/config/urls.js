/**
 * 腾讯国服顶层导航 URL 契约。
 *
 * 这里只维护已经由规格批准的精确入口。认证 host/path 在 G1 Windows
 * 发现并完成文档与失败测试同步前保持为空；未知目标一律拒绝。
 */

'use strict';

const TENCENT_URLS = Object.freeze({
  SELECTOR: 'https://huoying.qq.com/server/website/',
  GAME_MAIN: 'https://game.huoying.qq.com/main.html'
});

const URL_ROLES = Object.freeze({
  SELECTOR: 'SELECTOR',
  AUTH: 'AUTH',
  GAME_MAIN: 'GAME_MAIN',
  UNKNOWN: 'UNKNOWN'
});

const TRUSTED_TARGETS = Object.freeze([
  Object.freeze({
    role: URL_ROLES.SELECTOR,
    protocol: 'https:',
    hostname: 'huoying.qq.com',
    port: '',
    pathname: '/server/website/'
  }),
  Object.freeze({
    role: URL_ROLES.GAME_MAIN,
    protocol: 'https:',
    hostname: 'game.huoying.qq.com',
    port: '',
    pathname: '/main.html'
  })
]);

function parseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

/**
 * 按 scheme/hostname/port/pathname 精确分类顶层 URL。
 * query 与 fragment 不参与信任判断；它们也不会进入安全位置输出。
 *
 * @param {string} value
 * @returns {string}
 */
function classifyUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return URL_ROLES.UNKNOWN;
  }

  for (let i = 0; i < TRUSTED_TARGETS.length; i++) {
    const target = TRUSTED_TARGETS[i];
    if (
      parsed.protocol === target.protocol &&
      parsed.hostname === target.hostname &&
      parsed.port === target.port &&
      parsed.pathname === target.pathname
    ) {
      return target.role;
    }
  }

  return URL_ROLES.UNKNOWN;
}

/**
 * 将任意顶层 URL 收敛为可用于日志/诊断的安全位置。
 *
 * @param {string} value
 * @returns {{role:string, origin:string|null, pathname:string|null}}
 */
function toSafeLocation(value) {
  const parsed = parseUrl(value);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return {
      role: URL_ROLES.UNKNOWN,
      origin: null,
      pathname: null
    };
  }

  return {
    role: classifyUrl(value),
    origin: parsed.origin,
    pathname: parsed.pathname
  };
}

function getSelectorUrl() {
  return TENCENT_URLS.SELECTOR;
}

function getGameMainUrl() {
  return TENCENT_URLS.GAME_MAIN;
}

// Launcher 在 T022 接管前仍从该名称取默认入口；参数被有意忽略。
function getGameUrl() {
  return getSelectorUrl();
}

module.exports = {
  TENCENT_URLS: TENCENT_URLS,
  URL_ROLES: URL_ROLES,
  classifyUrl: classifyUrl,
  toSafeLocation: toSafeLocation,
  getSelectorUrl: getSelectorUrl,
  getGameMainUrl: getGameMainUrl,
  getGameUrl: getGameUrl
};
