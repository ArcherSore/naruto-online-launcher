/**
 * 腾讯启动链 URL 契约测试。
 *
 * 顶层页面只按 URL 解析后的 scheme/hostname/port/pathname 分类；query 与
 * fragment 不参与信任判断，也不得进入安全位置输出。
 */

'use strict';

const urls = require('../urls');

describe('腾讯 URL 配置', () => {
  test('只暴露单一官方选服入口和固定游戏主页面', () => {
    expect(urls.TENCENT_URLS).toEqual({
      SELECTOR: 'https://huoying.qq.com/server/website/',
      GAME_MAIN: 'https://game.huoying.qq.com/main.html'
    });
    expect(urls.getSelectorUrl()).toBe(urls.TENCENT_URLS.SELECTOR);
  });

  test('导出稳定的 URL 角色枚举', () => {
    expect(urls.URL_ROLES).toEqual({
      SELECTOR: 'SELECTOR',
      AUTH: 'AUTH',
      GAME_MAIN: 'GAME_MAIN',
      UNKNOWN: 'UNKNOWN'
    });
  });
});

describe('classifyUrl', () => {
  test.each([
    ['https://huoying.qq.com/server/website/', 'SELECTOR'],
    ['https://huoying.qq.com/server/website/?from=launcher#login', 'SELECTOR'],
    ['https://huoying.qq.com:443/server/website/', 'SELECTOR'],
    ['https://game.huoying.qq.com/main.html', 'GAME_MAIN'],
    ['https://game.huoying.qq.com/main.html?server=masked#game', 'GAME_MAIN'],
    ['https://game.huoying.qq.com:443/main.html', 'GAME_MAIN']
  ])('精确识别可信 scheme/host/default-port/path：%s', (value, expectedRole) => {
    expect(urls.classifyUrl(value)).toBe(expectedRole);
  });

  test.each([
    'http://huoying.qq.com/server/website/',
    'https://huoying.qq.com:8443/server/website/',
    'https://huoying.qq.com/server/website',
    'https://huoying.qq.com/server/website/extra',
    'https://game.huoying.qq.com:8443/main.html',
    'https://game.huoying.qq.com/main.htm',
    'https://game.huoying.qq.com/main.html/extra'
  ])('scheme/port/path 任一不精确时归类 UNKNOWN：%s', (value) => {
    expect(urls.classifyUrl(value)).toBe('UNKNOWN');
  });

  test.each([
    'https://huoying.qq.com.evil.example/server/website/',
    'https://evil-huoying.qq.com/server/website/',
    'https://qq.com/server/website/',
    'https://game.huoying.qq.com.evil.example/main.html',
    'https://game-huoying.qq.com/main.html'
  ])('拒绝仿冒或仅包含可信字符串的 hostname：%s', (value) => {
    expect(urls.classifyUrl(value)).toBe('UNKNOWN');
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///C:/unsafe.html',
    'ftp://huoying.qq.com/server/website/',
    'not a url',
    '',
    null,
    undefined
  ])('未知协议或无效输入默认拒绝：%p', (value) => {
    expect(urls.classifyUrl(value)).toBe('UNKNOWN');
  });
});

describe('toSafeLocation', () => {
  test('只输出 role、origin 和 pathname，丢弃 query/fragment', () => {
    expect(
      urls.toSafeLocation(
        'https://huoying.qq.com/server/website/?openid=never-log#access_token=never-log'
      )
    ).toEqual({
      role: 'SELECTOR',
      origin: 'https://huoying.qq.com',
      pathname: '/server/website/'
    });
  });

  test('GAME_MAIN 安全位置同样不携带 query/fragment', () => {
    const result = urls.toSafeLocation(
      'https://game.huoying.qq.com/main.html?ticket=never-log#fragment'
    );

    expect(result).toEqual({
      role: 'GAME_MAIN',
      origin: 'https://game.huoying.qq.com',
      pathname: '/main.html'
    });
    expect(JSON.stringify(result)).not.toContain('ticket');
    expect(JSON.stringify(result)).not.toContain('fragment');
  });

  test('无效输入返回无地址信息的 UNKNOWN，不回显原始字符串', () => {
    expect(urls.toSafeLocation('not a url?ticket=never-log')).toEqual({
      role: 'UNKNOWN',
      origin: null,
      pathname: null
    });
  });
});
