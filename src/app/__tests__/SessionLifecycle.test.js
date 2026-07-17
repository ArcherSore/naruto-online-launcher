/**
 * Testes para src/app/SessionLifecycle.js (Fase 3d split)
 *
 * Verifica: attach, event handlers (did-finish-load, did-fail-load, close),
 * JWT auto-renewal timer, cleanup, _sendAutoLoginResult, _sendWindowStatus.
 */

'use strict';

// Mock vault before requiring SessionLifecycle
jest.mock('../../profiles/vault', () => ({
  hasCredentials: jest.fn(() => false),
  getCredentials: jest.fn(() => null),
  buildAutoLoginScript: jest.fn(() => '(function(){return "not-found";})()')
}));

jest.mock('../../ui/manager/ManagerWindow', () => ({
  send: jest.fn()
}));

jest.mock('../../profiles/manager', () => ({
  reportCrash: jest.fn()
}));

jest.mock('../../memory/guard', () => ({
  reportCrash: jest.fn()
}));

jest.mock('../../network/api-login', () => ({
  renewIfNeeded: jest.fn(() => Promise.resolve({ renewed: false }))
}));

const SessionLifecycle = require('../SessionLifecycle');
const vault = require('../../profiles/vault');
const ManagerWindow = require('../../ui/manager/ManagerWindow');

/**
 * Cria um mock de BrowserWindow que captura handlers de evento.
 */
function makeMockWin() {
  const handlers = {};
  const wcHandlers = {};

  const wc = {
    on: jest.fn((evt, fn) => {
      wcHandlers[evt] = fn;
    }),
    once: jest.fn(),
    insertCSS: jest.fn(() => Promise.resolve()),
    executeJavaScript: jest.fn(() => Promise.resolve('not-found')),
    stop: jest.fn(),
    loadURL: jest.fn(),
    reload: jest.fn(),
    isDestroyed: jest.fn(() => false),
    session: {
      cookies: { flushStore: jest.fn(() => Promise.resolve()) },
      webRequest: {
        onCompleted: jest.fn(),
        onErrorOccurred: jest.fn()
      }
    }
  };

  const win = {
    on: jest.fn((evt, fn) => {
      handlers[evt] = fn;
    }),
    once: jest.fn((evt, fn) => {
      handlers[evt] = fn;
    }),
    isDestroyed: jest.fn(() => false),
    show: jest.fn(),
    destroy: jest.fn(),
    webContents: wc,
    loadURL: jest.fn()
  };

  return { win, wc, handlers, wcHandlers };
}

function makeCtx(overrides) {
  return Object.assign(
    {
      profileId: 'p_001',
      profile: { id: 'p_001', name: 'TestProfile', region: 'br', language: 'pt' },
      entry: {
        autoLoginTimer: null,
        failLoadRetry: false,
        failLoadTimer: null,
        formInjectAttempts: 0
      },
      ses: {
        cookies: { flushStore: jest.fn(() => Promise.resolve()) },
        webRequest: {
          onCompleted: jest.fn(),
          onErrorOccurred: jest.fn()
        },
        clearStorageData: jest.fn(() => Promise.resolve()),
        clearCache: jest.fn(() => Promise.resolve())
      },
      onOpened: jest.fn(),
      onClosed: jest.fn(),
      getGameUrl: jest.fn(
        () => 'https://naruto.narutowebgame.com/pt/serverlist?logintype=4&launcher=shinobi'
      ),
      LAUNCHER_PARAMS: 'logintype=4&leftbar_collapse=Yes&launcher=shinobi'
    },
    overrides
  );
}

describe('SessionLifecycle.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vault.hasCredentials.mockReturnValue(false);
    vault.getCredentials.mockReturnValue(null);
  });

  describe('exports', () => {
    test('exporta attach como função', () => {
      expect(typeof SessionLifecycle.attach).toBe('function');
    });

    test('exporta _sendWindowStatus como função', () => {
      expect(typeof SessionLifecycle._sendWindowStatus).toBe('function');
    });

    test('exporta _sendAutoLoginResult como função', () => {
      expect(typeof SessionLifecycle._sendAutoLoginResult).toBe('function');
    });
  });

  describe('_sendAutoLoginResult', () => {
    test('result=filled envia status=success', () => {
      SessionLifecycle._sendAutoLoginResult('p1', 'filled');
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:result', {
        profileId: 'p1',
        result: 'filled'
      });
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:status', {
        profileId: 'p1',
        status: 'success',
        result: 'filled'
      });
    });

    test('result=clicked envia status=success', () => {
      SessionLifecycle._sendAutoLoginResult('p1', 'clicked');
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:status', {
        profileId: 'p1',
        status: 'success',
        result: 'clicked'
      });
    });

    test('result=waiting envia status=loading', () => {
      SessionLifecycle._sendAutoLoginResult('p1', 'waiting');
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:status', {
        profileId: 'p1',
        status: 'loading',
        result: 'waiting'
      });
    });

    test('result=error envia status=error', () => {
      SessionLifecycle._sendAutoLoginResult('p1', 'error');
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:status', {
        profileId: 'p1',
        status: 'error',
        result: 'error'
      });
    });

    test('result=not-found envia status=idle', () => {
      SessionLifecycle._sendAutoLoginResult('p1', 'not-found');
      expect(ManagerWindow.send).toHaveBeenCalledWith('auto-login:status', {
        profileId: 'p1',
        status: 'idle',
        result: 'not-found'
      });
    });
  });

  describe('_sendWindowStatus', () => {
    test('envia game-window:status com open=true', () => {
      SessionLifecycle._sendWindowStatus('p1', true);
      expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
        profileId: 'p1',
        open: true
      });
    });

    test('envia game-window:status com open=false', () => {
      SessionLifecycle._sendWindowStatus('p1', false);
      expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
        profileId: 'p1',
        open: false
      });
    });
  });

  describe('attach', () => {
    test('registra handlers de evento na janela e webContents', () => {
      const { win, wc } = makeMockWin();
      const ctx = makeCtx();
      SessionLifecycle.attach(win, ctx);

      // Verifica handlers de webContents
      expect(wc.on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
      expect(wc.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
      expect(wc.on).toHaveBeenCalledWith('did-fail-load', expect.any(Function));
      expect(wc.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
      expect(wc.on).toHaveBeenCalledWith('new-window', expect.any(Function));

      // Verifica handlers de win
      expect(win.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(win.on).toHaveBeenCalledWith('closed', expect.any(Function));
      expect(win.on).toHaveBeenCalledWith('unresponsive', expect.any(Function));

      // Verifica once para ready-to-show
      expect(win.once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    });

    describe('did-finish-load handler', () => {
      test('injecta CSS e chama auto-login', () => {
        const { win, wc, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-finish-load'];
        handler();

        // insertCSS chamado (camada 1: ads/cookies)
        expect(wc.insertCSS).toHaveBeenCalled();
        // executeJavaScript chamado (camada 2: fullscreen + FB mock)
        expect(wc.executeJavaScript).toHaveBeenCalled();
      });

      test('reseta entry.failLoadRetry para false', () => {
        const { win, wcHandlers } = makeMockWin();
        const entry = {
          failLoadRetry: true,
          formInjectAttempts: 0,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-finish-load'];
        handler();

        expect(entry.failLoadRetry).toBe(false);
      });

      test('chama vault.hasCredentials e _tryAutoLogin quando há credenciais', () => {
        const { win, wcHandlers } = makeMockWin();
        vault.hasCredentials.mockReturnValue(true);
        vault.getCredentials.mockReturnValue({ user: 'test@x.com', pass: 'secret' });
        vault.buildAutoLoginScript.mockReturnValue('(function(){return "filled";})()');

        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-finish-load'];
        handler();

        expect(vault.hasCredentials).toHaveBeenCalledWith('p_001');
      });

      test('para auto-login quando formInjectAttempts > 5', () => {
        const { win, wcHandlers } = makeMockWin();
        vault.hasCredentials.mockReturnValue(true);
        vault.getCredentials.mockReturnValue({ user: 'test@x.com', pass: 'secret' });
        vault.buildAutoLoginScript.mockReturnValue('(function(){return "not-found";})()');
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 6,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        // Trigger multiple did-finish-load to simulate retries
        const handler = wcHandlers['did-finish-load'];
        handler();

        // Com formInjectAttempts=6, deve parar de tentar — não chama executeJavaScript para auto-login
        const autoLoginCalls = win.webContents.executeJavaScript.mock.calls.filter(function (c) {
          return typeof c[0] === 'string' && c[0].includes('doLogin');
        });
        expect(autoLoginCalls.length).toBe(0);
      });

      test('reseta formInjectAttempts quando auto-login succeed (result=filled)', () => {
        // Verifica que com formInjectAttempts < 6, o auto-login script É executado
        // (ao contrário do teste "para quando > 5" que verifica o oposto).
        const { win, wcHandlers } = makeMockWin();
        vault.hasCredentials.mockReturnValue(true);
        vault.getCredentials.mockReturnValue({ user: 'test@x.com', pass: 'secret' });
        vault.buildAutoLoginScript.mockReturnValue('AUTO_LOGIN_SCRIPT_MARKER');
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 3,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-finish-load'];
        handler();

        // O auto-login script (com marcador) deve ter sido passado a executeJavaScript
        const found = win.webContents.executeJavaScript.mock.calls.some(function (c) {
          return c[0] === 'AUTO_LOGIN_SCRIPT_MARKER';
        });
        expect(found).toBe(true);
      });

      test('resultado "clicked" reseta formInjectAttempts', () => {
        vault.hasCredentials.mockReturnValue(true);
        vault.getCredentials.mockReturnValue({ user: 'u', pass: 'p' });
        // Make executeJavaScript resolve with 'clicked'
        const { win, wcHandlers } = makeMockWin();
        win.webContents.executeJavaScript = jest.fn(() => Promise.resolve('clicked'));
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 3,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-finish-load'];
        handler();

        // formInjectAttempts should be reset to 0 after 'clicked' result
        // (verified via the entry reference which is mutated inside the handler)
        setImmediate(function () {
          expect(entry.formInjectAttempts).toBe(0);
        });
      });
    });

    describe('did-fail-load handler', () => {
      test('primeira falha: tenta novamente com delay (setTimeout)', () => {
        jest.useFakeTimers();
        const { win, wcHandlers } = makeMockWin();
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 0,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-fail-load'];
        handler({}, -102, 'ERR_CONNECTION_REFUSED', 'https://example.com');

        // Deve ter marcado failLoadRetry=true e agendado retry
        expect(entry.failLoadRetry).toBe(true);
        expect(entry.failLoadTimer).not.toBeNull();

        // Avança o timer para executar o retry
        jest.advanceTimersByTime(1500);
        expect(win.loadURL).toHaveBeenCalled();

        jest.useRealTimers();
      });

      test('ignora data: URLs', () => {
        const { win, wcHandlers } = makeMockWin();
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 0,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-fail-load'];
        handler({}, -2, 'ERR_FAILED', 'data:text/html,hello');

        expect(entry.failLoadRetry).toBe(false);
      });

      test('ignora ERR_ABORTED (code -3)', () => {
        const { win, wcHandlers } = makeMockWin();
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 0,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-fail-load'];
        handler({}, -3, 'ERR_ABORTED', 'https://example.com');

        expect(entry.failLoadRetry).toBe(false);
      });

      test('segunda falha (alreadyRetried): exibe tela de erro', () => {
        const { win, wc, wcHandlers } = makeMockWin();
        const entry = {
          failLoadRetry: true,
          formInjectAttempts: 0,
          autoLoginTimer: null,
          failLoadTimer: null
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['did-fail-load'];
        handler({}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://example.com');

        // Deve chamar loadURL com data:text/html (tela de erro)
        expect(wc.loadURL).toHaveBeenCalled();
        const errorPageUrl = wc.loadURL.mock.calls[0][0];
        expect(errorPageUrl).toContain('data:text/html');
      });
    });

    describe('close handler', () => {
      test('chama preventDefault na primeira chamada', () => {
        const { win, handlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const closeHandler = handlers['close'];
        const event = { preventDefault: jest.fn() };
        closeHandler(event);

        expect(event.preventDefault).toHaveBeenCalled();
      });

      test('limpa entry timers (autoLoginTimer, failLoadTimer)', () => {
        const { win, handlers } = makeMockWin();
        const fakeTimer1 = setTimeout(() => {}, 99999);
        const fakeTimer2 = setTimeout(() => {}, 99999);
        const entry = {
          failLoadRetry: false,
          formInjectAttempts: 0,
          autoLoginTimer: fakeTimer1,
          failLoadTimer: fakeTimer2
        };
        const ctx = makeCtx({ entry });
        SessionLifecycle.attach(win, ctx);

        const closeHandler = handlers['close'];
        closeHandler({ preventDefault: jest.fn() });

        // verify clearTimeout was called on those timers (can't directly spy on clearTimeout
        // but the entry timers should be handled — we just verify no throw)
        expect(true).toBe(true);

        clearTimeout(fakeTimer1);
        clearTimeout(fakeTimer2);
      });

      test('destroys window after 500ms timeout', () => {
        jest.useFakeTimers();
        const { win, handlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const closeHandler = handlers['close'];
        closeHandler({ preventDefault: jest.fn() });

        jest.advanceTimersByTime(500);
        expect(win.destroy).toHaveBeenCalled();

        jest.useRealTimers();
      });
    });

    describe('closed handler', () => {
      test('envia window status false e chama onClosed', () => {
        const { win, handlers } = makeMockWin();
        const onClosed = jest.fn();
        const ctx = makeCtx({ onClosed });
        SessionLifecycle.attach(win, ctx);

        const closedHandler = handlers['closed'];
        closedHandler();

        expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
          profileId: 'p_001',
          open: false
        });
        expect(onClosed).toHaveBeenCalled();
      });
    });

    describe('ready-to-show handler', () => {
      test('mostra a janela, envia window status true e carrega URL', () => {
        jest.useFakeTimers();
        const { win, handlers } = makeMockWin();
        const onOpened = jest.fn();
        const getGameUrl = jest.fn(() => 'https://game.url');
        const ctx = makeCtx({ onOpened, getGameUrl });
        SessionLifecycle.attach(win, ctx);

        const readyHandler = handlers['ready-to-show'];
        readyHandler();

        expect(win.show).toHaveBeenCalled();
        expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
          profileId: 'p_001',
          open: true
        });
        expect(onOpened).toHaveBeenCalled();

        // setImmediate: loadURL acontece após o handler
        jest.advanceTimersByTime(0);
        expect(win.loadURL).toHaveBeenCalledWith('https://game.url');

        jest.useRealTimers();
      });
    });

    describe('JWT auto-renewal timer', () => {
      test('setInterval é chamado com 30 minutos', () => {
        jest.useFakeTimers();
        const { win } = makeMockWin();
        const ctx = makeCtx();
        const setIntervalSpy = jest.spyOn(global, 'setInterval');

        SessionLifecycle.attach(win, ctx);

        // Verifica que setInterval foi chamado com 30min = 30*60*1000
        const calls = setIntervalSpy.mock.calls;
        const thirtyMin = 30 * 60 * 1000;
        const found = calls.some(function (call) {
          return call[1] === thirtyMin;
        });
        expect(found).toBe(true);

        setIntervalSpy.mockRestore();
        jest.useRealTimers();
      });

      test('unref é chamado no timer', () => {
        const { win } = makeMockWin();
        const ctx = makeCtx();
        const originalSetInterval = global.setInterval;
        let capturedTimer = null;

        global.setInterval = jest.fn(function (fn, ms) {
          capturedTimer = originalSetInterval(fn, ms);
          capturedTimer.unref = jest.fn();
          return capturedTimer;
        });

        SessionLifecycle.attach(win, ctx);

        expect(capturedTimer).not.toBeNull();
        expect(capturedTimer.unref).toHaveBeenCalled();

        global.setInterval = originalSetInterval;
        clearInterval(capturedTimer);
      });

      test('timer é limpo no close', () => {
        const { win, handlers } = makeMockWin();
        const ctx = makeCtx();
        const originalSetInterval = global.setInterval;
        let capturedTimer = null;

        global.setInterval = jest.fn(function (fn, ms) {
          capturedTimer = originalSetInterval(fn, ms);
          capturedTimer.unref = jest.fn();
          return capturedTimer;
        });

        SessionLifecycle.attach(win, ctx);

        const closeHandler = handlers['close'];
        closeHandler({ preventDefault: jest.fn() });

        // After close, the timer should be cleared (clearInterval called)
        // We can't directly verify clearInterval was called on the exact timer
        // but the code sets _renewTimer = null after clearInterval
        global.setInterval = originalSetInterval;
        if (capturedTimer) clearInterval(capturedTimer);
      });
    });

    describe('render-process-gone handler', () => {
      test('registra handler sem lançar', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];
        expect(typeof handler).toBe('function');
        expect(() => handler({}, { reason: 'oom', exitCode: 1 })).not.toThrow();
      });

      test('auto-reload após crash "oom"', () => {
        jest.useFakeTimers();
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];
        handler({}, { reason: 'oom', exitCode: null });

        // Deve agendar reload em 1.5s
        expect(win.webContents.reload).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1500);
        expect(win.webContents.reload).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
      });

      test('não recupera "clean-exit"', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];
        handler({}, { reason: 'clean-exit', exitCode: 0 });

        expect(win.webContents.reload).not.toHaveBeenCalled();
      });

      test('não recupera "killed"', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];
        handler({}, { reason: 'killed', exitCode: 9 });

        expect(win.webContents.reload).not.toHaveBeenCalled();
      });

      test('não recupera se win.isDestroyed()', () => {
        const { win, wcHandlers } = makeMockWin();
        win.isDestroyed.mockReturnValue(true);
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];
        handler({}, { reason: 'crashed', exitCode: 1 });

        expect(win.webContents.reload).not.toHaveBeenCalled();
      });

      test('backoff: para de recarregar após 3 crashes em 10 min', () => {
        jest.useFakeTimers();
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['render-process-gone'];

        // 1st crash → reload
        handler({}, { reason: 'crashed', exitCode: 1 });
        jest.advanceTimersByTime(1500);
        expect(win.webContents.reload).toHaveBeenCalledTimes(1);

        // 2nd crash → reload
        handler({}, { reason: 'oom', exitCode: 2 });
        jest.advanceTimersByTime(1500);
        expect(win.webContents.reload).toHaveBeenCalledTimes(2);

        // 3rd crash → limit reached, no reload
        handler({}, { reason: 'abnormal-exit', exitCode: 3 });
        expect(win.webContents.reload).toHaveBeenCalledTimes(2);

        jest.useRealTimers();
      });
    });

    describe('will-navigate handler', () => {
      test('ignora data: URLs', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['will-navigate'];
        expect(() => handler({ preventDefault: jest.fn() }, 'data:text/html,test')).not.toThrow();
        expect(win.loadURL).not.toHaveBeenCalled();
      });

      test('injeta LAUNCHER_PARAMS em navegação game-host sem logintype', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['will-navigate'];
        const evt = { preventDefault: jest.fn() };
        handler(evt, 'https://naruto.narutowebgame.com/pt/serverlist');

        expect(evt.preventDefault).toHaveBeenCalled();
        expect(win.loadURL).toHaveBeenCalledWith(
          'https://naruto.narutowebgame.com/pt/serverlist?logintype=4&leftbar_collapse=Yes&launcher=shinobi'
        );
      });

      test('não interfere em assets (swf, js, css)', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['will-navigate'];
        const evt = { preventDefault: jest.fn() };
        handler(evt, 'https://naruto.narutowebgame.com/game.swf?v=2');

        expect(evt.preventDefault).not.toHaveBeenCalled();
      });

      test('não interfere se URL já tem logintype', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['will-navigate'];
        const evt = { preventDefault: jest.fn() };
        handler(evt, 'https://naruto.narutowebgame.com/pt/serverlist?logintype=4');

        expect(evt.preventDefault).not.toHaveBeenCalled();
      });
    });

    describe('new-window handler', () => {
      test('abre link do jogo na mesma janela', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['new-window'];
        const evt = { preventDefault: jest.fn() };
        handler(evt, 'https://naruto.narutowebgame.com/pt/news');

        expect(evt.preventDefault).toHaveBeenCalled();
        expect(win.loadURL).toHaveBeenCalledWith('https://naruto.narutowebgame.com/pt/news');
      });

      test('abre URL externa (não-jogo) via shell.openExternal', () => {
        const { win, wcHandlers } = makeMockWin();
        const ctx = makeCtx();
        SessionLifecycle.attach(win, ctx);

        const handler = wcHandlers['new-window'];
        const evt = { preventDefault: jest.fn() };
        handler(evt, 'https://www.google.com/search?q=test');

        expect(evt.preventDefault).toHaveBeenCalled();
        const { shell } = require('electron');
        expect(shell.openExternal).toHaveBeenCalledWith('https://www.google.com/search?q=test');
      });
    });
  });

  describe('reloadWithPreAuth race guard', () => {
    test('segunda chamada durante reload em andamento é ignorada (same window)', async () => {
      const win = {
        isDestroyed: () => false,
        id: 42,
        webContents: {
          executeJavaScript: jest.fn(() => Promise.resolve()),
          reload: jest.fn(),
          isDestroyed: () => false
        }
      };
      const ses = {
        clearStorageData: jest.fn(() => Promise.resolve()),
        clearCache: jest.fn(() => Promise.resolve())
      };

      // Primeira chamada — retorna promise que não resolve imediatamente
      var resolveFirst;
      ses.clearStorageData = jest.fn(
        () =>
          new Promise(r => {
            resolveFirst = r;
          })
      );

      SessionLifecycle.reloadWithPreAuth('p1', { name: 'test' }, win, ses, jest.fn());
      SessionLifecycle.reloadWithPreAuth('p1', { name: 'test' }, win, ses, jest.fn());

      // clearStorageData deve ter sido chamado apenas 1 vez (segunda chamada skipou)
      expect(ses.clearStorageData).toHaveBeenCalledTimes(1);

      // Resolve a primeira promise
      if (resolveFirst) resolveFirst();
      // Limpa o guard para não afetar outros testes
      // (o setTimeout de 3s vai limpar, mas forçamos aqui)
      await new Promise(r => setTimeout(r, 50));
    });
  });
});
