/**
 * Tests the safe logger wrapper, formatting, and electron-log delegation.
 */

// Uses the electron-log mock from the Jest setup file.
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
    test('delegates to electron-log.info', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledTimes(1);
    });

    test('uses the ASCII info prefix', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledWith('[INFO] [Launcher] test message');
    });

    test('includes the original message', () => {
      logger.info('test message');
      expect(electronLog.info).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    test('accepts additional safe data', () => {
      logger.info('test message', { profileId: 'profile-a' });
      expect(electronLog.info).toHaveBeenCalledWith(expect.stringContaining('test message'), {
        profileId: 'profile-a'
      });
    });
  });

  describe('warn', () => {
    test('delegates to electron-log.warn', () => {
      logger.warn('warning message');
      expect(electronLog.warn).toHaveBeenCalledTimes(1);
    });

    test('uses the ASCII warn prefix', () => {
      logger.warn('warning message');
      expect(electronLog.warn).toHaveBeenCalledWith('[WARN] [Launcher] warning message');
    });

    test('accepts additional safe data', () => {
      logger.warn('warning message', { errorCode: 'SAFE_WARNING' });
      expect(electronLog.warn).toHaveBeenCalledWith(expect.stringContaining('warning message'), {
        errorCode: 'SAFE_WARNING'
      });
    });
  });

  describe('error', () => {
    test('delegates to electron-log.error', () => {
      logger.error('error message');
      expect(electronLog.error).toHaveBeenCalledTimes(1);
    });

    test('uses the ASCII error prefix and accepts additional data', () => {
      logger.error('error message', 'extra data');
      expect(electronLog.error).toHaveBeenCalledWith(
        '[ERROR] [Launcher] error message',
        'extra data'
      );
    });
  });

  describe('debug', () => {
    test('delegates to electron-log.debug', () => {
      logger.debug('debug message');
      expect(electronLog.debug).toHaveBeenCalledTimes(1);
    });

    test('uses the ASCII debug prefix and accepts additional safe data', () => {
      logger.debug('debug message', { stage: 'SELECTOR_LOADING' });
      expect(electronLog.debug).toHaveBeenCalledWith('[DEBUG] [Launcher] debug message', {
        stage: 'SELECTOR_LOADING'
      });
    });
  });

  describe('Tencent flow safety boundary', () => {
    test.each(['debug', 'info', 'warn', 'error'])(
      '%s keeps only origin and pathname from a full URL',
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

    test('redacts Cookie and Authorization before electron-log', () => {
      logger.info('request Cookie: skey=cookie-secret Authorization: Bearer authorization-secret');

      const output = serializedLastCall('info');
      expect(output).not.toContain('cookie-secret');
      expect(output).not.toContain('authorization-secret');
    });

    test.each(['openid=identity-secret', 'access_token=access-secret', 'ticket=ticket-secret'])(
      'redacts known identity and ticket parameter %s',
      fragment => {
        logger.warn('unsafe parameter ' + fragment);
        expect(serializedLastCall('warn')).not.toContain(fragment.split('=')[1]);
      }
    );

    test('redacts a likely QQ identity from normal logs', () => {
      logger.error('official account identity 1234567890');
      expect(serializedLastCall('error')).not.toContain('1234567890');
    });

    test('keeps only allowlisted structured fields', () => {
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

    test('reparses origin and pathname without query or fragment bypass', () => {
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

    test('exports the safe field allowlist for diagnostics and IPC', () => {
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

  test('preserves a non-ASCII dynamic message after sanitization', () => {
    logger.info('玩家甲');
    expect(electronLog.info).toHaveBeenCalledWith('[INFO] [Launcher] 玩家甲');
  });

  describe('automation logging boundary', () => {
    test('allows only scalar Vision diagnostics and rejects image, path, and identity data', () => {
      logger.info('vision attempt', {
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        templateId: 'sample-target',
        stage: 'match',
        attempt: 2,
        durationMs: 7,
        errorCode: 'vision-timeout',
        imageWidth: 1920,
        imageHeight: 1080,
        templateWidth: 10,
        templateHeight: 4,
        path: 'C:\\secret\\sample-target.png',
        png: Buffer.from('secret'),
        bitmap: Buffer.from('secret'),
        rawError: 'nativeImage cookie=secret',
        url: 'https://game.invalid/?ticket=secret',
        Cookie: 'secret',
        Session: 'secret'
      });
      expect(lastLogCall('info')[1]).toEqual({
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        templateId: 'sample-target',
        stage: 'match',
        attempt: 2,
        durationMs: 7,
        errorCode: 'vision-timeout',
        imageWidth: 1920,
        imageHeight: 1080,
        templateWidth: 10,
        templateHeight: 4
      });
      expect(serializedLastCall('info')).not.toContain('secret');
    });

    test('allows only safe automation correlation scalar fields', () => {
      logger.info('automation event', {
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        packageName: 'demo-click-package',
        status: 'running',
        action: 'click',
        durationMs: 12,
        retryCount: 1,
        screenshot: Buffer.from('secret'),
        config: { token: 'secret' },
        Cookie: 'skey=secret'
      });
      expect(lastLogCall('info')[1]).toEqual({
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        packageName: 'demo-click-package',
        status: 'running',
        action: 'click',
        durationMs: 12,
        retryCount: 1
      });
      expect(serializedLastCall('info')).not.toContain('secret');
    });

    test('creates a bound logger whose correlation fields cannot be overridden', () => {
      const bound = logger.createBoundLogger({
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click'
      });
      bound.warn('script event', {
        runId: 'forged',
        profileId: 'forged',
        scriptId: 'forged',
        action: 'wait'
      });
      expect(lastLogCall('warn')[1]).toEqual({
        runId: 'run-1',
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        action: 'wait'
      });
      expect(Object.keys(bound).sort()).toEqual(['debug', 'error', 'info', 'warn']);
      expect(Object.isFrozen(bound)).toBe(true);
    });

    test('does not interrupt a script when the underlying logger fails', () => {
      electronLog.error.mockImplementationOnce(function () {
        throw new Error('logger failed');
      });
      const bound = logger.createBoundLogger({ runId: 'run-1' });
      expect(function () {
        bound.error('script event', { action: 'click' });
      }).not.toThrow();
    });

    test('allows only scalar registry summary counts and safe package identity fields', () => {
      logger.info('automation registry summary', {
        action: 'registry-scan',
        registeredCount: 1,
        issueCount: 2,
        packageName: 'broken-package',
        scriptId: 'broken-script',
        errorCode: 'manifest-invalid',
        manifest: '{"ticket":"secret"}',
        entryPath: 'C:\\secret.js',
        stack: 'secret'
      });
      expect(lastLogCall('info')[1]).toEqual({
        action: 'registry-scan',
        registeredCount: 1,
        issueCount: 2,
        packageName: 'broken-package',
        scriptId: 'broken-script',
        errorCode: 'manifest-invalid'
      });
      expect(serializedLastCall('info')).not.toContain('secret');
    });
  });
});
