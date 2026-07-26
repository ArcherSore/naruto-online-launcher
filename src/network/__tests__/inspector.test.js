'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../utils/logger');
const inspector = require('../inspector');

function mockSession() {
  const handlers = {};
  function register(name) {
    return jest.fn((arg1, arg2) => {
      const callback = typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : null;
      handlers[name] = callback;
    });
  }
  return {
    webRequest: {
      onBeforeRequest: register('onBeforeRequest'),
      onResponseStarted: register('onResponseStarted'),
      onErrorOccurred: register('onErrorOccurred'),
      _handlers: handlers
    }
  };
}

describe('inspector.js - G0 安全网络观察边界', () => {
  let session;
  let insp;

  beforeEach(() => {
    jest.clearAllMocks();
    session = mockSession();
    insp = inspector.create(session, 'safe-profile');
  });

  test('只导出五个安全网络字段', () => {
    expect(inspector.SAFE_NETWORK_FIELDS).toEqual([
      'resourceType',
      'origin',
      'pathname',
      'statusCode',
      'errorCode'
    ]);
  });

  test('enable/disable 使用 Electron 11 webRequest API 且幂等', () => {
    insp.enable();
    insp.enable();
    expect(insp.isEnabled()).toBe(true);
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(session.webRequest.onResponseStarted).toHaveBeenCalledTimes(1);
    expect(session.webRequest.onErrorOccurred).toHaveBeenCalledTimes(1);

    insp.disable();
    insp.disable();
    expect(insp.isEnabled()).toBe(false);
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(2);
    expect(session.webRequest.onResponseStarted).toHaveBeenCalledTimes(2);
    expect(session.webRequest.onErrorOccurred).toHaveBeenCalledTimes(2);
  });

  test('请求事件只采集 resourceType/origin/pathname/statusCode/errorCode', () => {
    const captured = jest.fn();
    insp.on('capture', captured);
    insp.enable();

    session.webRequest._handlers.onBeforeRequest({
      id: 7,
      url: 'https://passport.oasgames.com/login?ticket=ticket-secret#fragment-secret',
      method: 'POST',
      resourceType: 'xhr',
      requestHeaders: {
        Cookie: 'oas_user=jwt-secret',
        Authorization: 'Bearer authorization-secret'
      },
      uploadData: [{ bytes: Buffer.from('request-body-secret') }],
      requestBody: 'request-body-secret',
      responseBody: 'response-body-secret',
      pageSource: '<html>page-source-secret</html>',
      unknownIdentity: 'identity-secret'
    });

    expect(captured).toHaveBeenCalledWith({
      resourceType: 'xhr',
      origin: 'https://passport.oasgames.com',
      pathname: '/login',
      statusCode: null,
      errorCode: null
    });
    expect(insp.getEntries()).toEqual([captured.mock.calls[0][0]]);

    const output = JSON.stringify({ entries: insp.getEntries(), stats: insp.getStats() });
    expect(output).not.toMatch(
      /ticket-secret|fragment-secret|jwt-secret|authorization-secret|request-body-secret|response-body-secret|page-source-secret|identity-secret/
    );
    expect(output).not.toMatch(/"url"|"method"|"headers"|"jwt"|capturedCookies|capturedJwts/);
  });

  test('响应事件不采集 Set-Cookie、响应体或未知字段', () => {
    insp.enable();
    session.webRequest._handlers.onResponseStarted({
      id: 8,
      url: 'https://game.huoying.qq.com/main.html?openid=identity-secret',
      resourceType: 'mainFrame',
      statusCode: 200,
      responseHeaders: { 'Set-Cookie': ['skey=cookie-secret'] },
      responseBody: 'response-body-secret',
      unknown: 'unknown-secret'
    });

    expect(insp.getEntries()).toEqual([
      {
        resourceType: 'mainFrame',
        origin: 'https://game.huoying.qq.com',
        pathname: '/main.html',
        statusCode: 200,
        errorCode: null
      }
    ]);
    expect(JSON.stringify(insp.getEntries())).not.toMatch(
      /identity-secret|cookie-secret|response-body-secret|unknown-secret/
    );
  });

  test('错误事件只输出安全位置和 errorCode', () => {
    insp.enable();
    session.webRequest._handlers.onErrorOccurred({
      id: 9,
      url: 'https://cdn.example/game.swf?ticket=ticket-secret#fragment',
      resourceType: 'object',
      error: 'net::ERR_CONNECTION_RESET',
      requestHeaders: { Cookie: 'skey=cookie-secret' }
    });

    expect(insp.getEntries()).toEqual([
      {
        resourceType: 'object',
        origin: 'https://cdn.example',
        pathname: '/game.swf',
        statusCode: null,
        errorCode: 'net::ERR_CONNECTION_RESET'
      }
    ]);
  });

  test('无效 URL 不回显原始输入，未知 detail 字段默认拒绝', () => {
    insp.enable();
    session.webRequest._handlers.onBeforeRequest({
      url: 'not-a-url?ticket=ticket-secret',
      resourceType: 'other',
      arbitrary: 'identity-secret'
    });

    expect(insp.getEntries()).toEqual([
      {
        resourceType: 'other',
        origin: null,
        pathname: null,
        statusCode: null,
        errorCode: null
      }
    ]);
  });

  test('过滤器只接受安全字段，未知字段默认拒绝', () => {
    insp.enable();
    session.webRequest._handlers.onBeforeRequest({
      url: 'https://cdn.example/game.swf',
      resourceType: 'object'
    });

    expect(insp.getEntries({ resourceType: 'object' })).toHaveLength(1);
    expect(insp.getEntries({ url: 'https://cdn.example/game.swf' })).toEqual([]);
    expect(insp.getEntries(['resourceType'])).toEqual([]);
  });

  test('listener 异常只记录安全错误类型，不回显网络详情', () => {
    insp.on('capture', () => { throw new TypeError('callback failed'); });
    insp.enable();
    session.webRequest._handlers.onBeforeRequest({
      url: 'https://cdn.example/game.swf?ticket=ticket-secret',
      resourceType: 'object'
    });

    expect(logger.debug).toHaveBeenCalledWith('Inspector callback failed', {
      profileId: 'safe-profile',
      event: 'inspector-callback-failed',
      errorCode: 'TypeError'
    });
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('ticket-secret');
  });

  test('entries 上限为 500 且 clear 不保留旧数据', () => {
    insp.enable();
    for (let i = 0; i < 505; i++) {
      session.webRequest._handlers.onBeforeRequest({
        url: 'https://cdn.example/' + i + '.swf',
        resourceType: 'object'
      });
    }
    expect(insp.getEntries()).toHaveLength(500);
    expect(insp.getEntries()[0].pathname).toBe('/5.swf');
    insp.clear();
    expect(insp.getEntries()).toEqual([]);
    expect(insp.getStats()).toBeNull();
  });
});
