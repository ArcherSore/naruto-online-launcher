/**
 * Testes para src/utils/logger.js
 * Testa o wrapper do logger que formata e delega para electron-log
 */

// Requer electron-log mock do setup file
const electronLog = require('electron-log');
const logger = require('../logger');

function lastLogCall(method) {
  const calls = electronLog[method].mock.calls;
  return calls[calls.length - 1];
}

function serializedLastCall(method) {
  return JSON.stringify(lastLogCall(method));
}

describe('logger.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('info', () => {
    test('delega para electron-log.info', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledTimes(1);
    });

    test('inclui prefixo [Launcher] na mensagem', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledWith(expect.stringContaining('[Launcher]'));
    });

    test('inclui a mensagem original', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    test('aceita dados adicionais', () => {
      logger.info('test message', { profileId: 'profile-a' });
      expect(electronLog.info).toHaveBeenCalledWith(expect.stringContaining('test message'), {
        profileId: 'profile-a'
      });
    });
  });

  describe('warn', () => {
    test('delega para electron-log.warn', () => {
      logger.warn('warning message');
      expect(electronLog.warn).toHaveBeenCalledTimes(1);
    });

    test('inclui ícone de aviso', () => {
      logger.warn('warning message');
      expect(electronLog.warn).toHaveBeenCalledWith(expect.stringContaining('[Launcher]'));
    });

    test('aceita dados adicionais', () => {
      logger.warn('warning message', { errorCode: 'SAFE_WARNING' });
      expect(electronLog.warn).toHaveBeenCalledWith(expect.stringContaining('warning message'), {
        errorCode: 'SAFE_WARNING'
      });
    });
  });

  describe('error', () => {
    test('delega para electron-log.error', () => {
      logger.error('error message');
      expect(electronLog.error).toHaveBeenCalledTimes(1);
    });

    test('aceita dados adicionais', () => {
      logger.error('error message', 'extra data');
      expect(electronLog.error).toHaveBeenCalledWith(
        expect.stringContaining('error message'),
        'extra data'
      );
    });
  });

  describe('debug', () => {
    test('delega para electron-log.debug', () => {
      logger.debug('debug message');
      expect(electronLog.debug).toHaveBeenCalledTimes(1);
    });

    test('aceita dados adicionais', () => {
      logger.debug('debug message', { stage: 'SELECTOR_LOADING' });
      expect(electronLog.debug).toHaveBeenCalledWith(expect.stringContaining('debug message'), {
        stage: 'SELECTOR_LOADING'
      });
    });
  });

  describe('腾讯流程安全边界', () => {
    test.each(['debug', 'info', 'warn', 'error'])(
      '%s 从消息中的完整 URL 只保留 origin + pathname',
      level => {
        logger[level](
          'navigate https://huoying.qq.com/server/website/?openid=identity-value#access_token=token-value'
        );

        const output = serializedLastCall(level);
        expect(output).toContain('https://huoying.qq.com/server/website/');
        expect(output).not.toContain('openid');
        expect(output).not.toContain('identity-value');
        expect(output).not.toContain('access_token');
        expect(output).not.toContain('token-value');
      }
    );

    test('Cookie 与 Authorization 内容在进入 electron-log 前被脱敏', () => {
      logger.info('request Cookie: skey=cookie-secret Authorization: Bearer authorization-secret');

      const output = serializedLastCall('info');
      expect(output).not.toContain('cookie-secret');
      expect(output).not.toContain('authorization-secret');
    });

    test.each(['openid=identity-secret', 'access_token=access-secret', 'ticket=ticket-secret'])(
      '已知身份/票据参数默认脱敏：%s',
      fragment => {
        logger.warn('unsafe parameter ' + fragment);
        expect(serializedLastCall('warn')).not.toContain(fragment.split('=')[1]);
      }
    );

    test('疑似 QQ 号不进入普通日志', () => {
      logger.error('official account identity 1234567890');
      expect(serializedLastCall('error')).not.toContain('1234567890');
    });

    test('结构化字段只保留 allowlist 并拒绝未知身份字段', () => {
      logger.info('navigation event', {
        profileId: 'profile-a',
        stage: 'SELECTOR_LOADING',
        event: 'did-finish-load',
        role: 'SELECTOR',
        origin: 'https://huoying.qq.com',
        pathname: '/server/website/',
        statusCode: 200,
        unknownIdentity: 'identity-secret',
        url: 'https://huoying.qq.com/server/website/?ticket=ticket-secret',
        Cookie: 'skey=cookie-secret',
        Authorization: 'Bearer authorization-secret'
      });

      expect(lastLogCall('info')[1]).toEqual({
        profileId: 'profile-a',
        stage: 'SELECTOR_LOADING',
        event: 'did-finish-load',
        role: 'SELECTOR',
        origin: 'https://huoying.qq.com',
        pathname: '/server/website/',
        statusCode: 200
      });
      const output = serializedLastCall('info');
      expect(output).not.toContain('unknownIdentity');
      expect(output).not.toContain('identity-secret');
      expect(output).not.toContain('ticket-secret');
      expect(output).not.toContain('cookie-secret');
      expect(output).not.toContain('authorization-secret');
    });

    test('origin/pathname 字段会被重新解析且不允许 query/fragment 绕过', () => {
      logger.debug('safe location', {
        origin: 'https://game.huoying.qq.com?ticket=origin-secret',
        pathname: '/main.html?openid=path-secret#fragment'
      });

      expect(lastLogCall('debug')[1]).toEqual({
        origin: 'https://game.huoying.qq.com',
        pathname: '/main.html'
      });
      expect(serializedLastCall('debug')).not.toContain('origin-secret');
      expect(serializedLastCall('debug')).not.toContain('path-secret');
    });

    test('导出安全字段 allowlist，供诊断与 IPC 复用', () => {
      expect(logger.SAFE_LOG_FIELDS).toEqual(
        expect.arrayContaining([
          'profileId',
          'stage',
          'event',
          'role',
          'origin',
          'pathname',
          'resourceType',
          'statusCode',
          'errorCode'
        ])
      );
      expect(logger.SAFE_LOG_FIELDS).not.toContain('url');
      expect(logger.SAFE_LOG_FIELDS).not.toContain('Cookie');
    });
  });
});
