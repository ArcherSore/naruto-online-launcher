/**
 * Testes para src/ui/manager/KeyboardShortcuts.js (Fase 3d split)
 * Verifica F5 safe role reload, F12 DevTools, Alt+F4 close, e bloqueios.
 */

const KeyboardShortcuts = require('../KeyboardShortcuts');

function makeMockWin() {
  let handler = null;
  const wc = {
    on: jest.fn((evt, fn) => {
      if (evt === 'before-input-event') handler = fn;
    }),
    reload: jest.fn(),
    toggleDevTools: jest.fn(),
    executeJavaScript: jest.fn(() => Promise.resolve())
  };
  const win = {
    webContents: wc,
    close: jest.fn(),
    isDestroyed: jest.fn(() => false)
  };
  return { win, wc, getHandler: () => handler };
}

function makeMockSession() {
  return {
    clearStorageData: jest.fn(() => Promise.resolve()),
    clearCache: jest.fn(() => Promise.resolve())
  };
}

function fire(handler, input) {
  const event = { preventDefault: jest.fn() };
  handler(event, input);
  return event;
}

describe('KeyboardShortcuts.js', () => {
  test('attach registra handler before-input-event no webContents', () => {
    const { win, wc } = makeMockWin();
    KeyboardShortcuts.attach(win, 'TestProfile');
    expect(wc.on).toHaveBeenCalledWith('before-input-event', expect.any(Function));
  });

  test('attach com win nulo não lança', () => {
    expect(() => KeyboardShortcuts.attach(null, 'x')).not.toThrow();
  });

  describe('F5 → safe current-role reload', () => {
    test('F5 delega para o reload seguro do papel atual sem limpar a Session', () => {
      const { win, wc, getHandler } = makeMockWin();
      const ses = makeMockSession();
      const reloadCurrentRole = jest.fn();
      KeyboardShortcuts.attach(win, 'TestProfile', reloadCurrentRole);

      const ev = fire(getHandler(), { key: 'F5', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(reloadCurrentRole).toHaveBeenCalledTimes(1);
      expect(ses.clearStorageData).not.toHaveBeenCalled();
      expect(ses.clearCache).not.toHaveBeenCalled();
      expect(wc.reload).not.toHaveBeenCalled();
    });

    test('F5 com callback que lança não contorna a classificação com reload direto', () => {
      const { win, wc, getHandler } = makeMockWin();
      const reloadCurrentRole = jest.fn(() => {
        throw new Error('mock fail');
      });
      KeyboardShortcuts.attach(win, 'TestProfile', reloadCurrentRole);

      const ev = fire(getHandler(), { key: 'F5', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(reloadCurrentRole).toHaveBeenCalledTimes(1);
      expect(wc.reload).not.toHaveBeenCalled();
    });

    test('F5 sem callback faz reload direto sem clearStorageData, API login ou senha', async () => {
      const { win, wc, getHandler } = makeMockWin();
      const ses = makeMockSession();
      ses.apiLogin = jest.fn();
      ses.passwordPreAuth = jest.fn();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F5', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(ses.clearStorageData).not.toHaveBeenCalled();
      expect(ses.clearCache).not.toHaveBeenCalled();
      expect(ses.apiLogin).not.toHaveBeenCalled();
      expect(ses.passwordPreAuth).not.toHaveBeenCalled();
      await new Promise(function (r) {
        setTimeout(r, 10);
      });
      expect(wc.executeJavaScript).not.toHaveBeenCalled();
      expect(wc.reload).toHaveBeenCalled();
    });

    test('F5 sem session e sem callback faz reload direto (fallback)', () => {
      const { win, wc, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F5', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(wc.reload).toHaveBeenCalled();
    });

    test('Ctrl+F5 NÃO recarrega (deixa o Chromium tratar)', () => {
      const { win, wc, getHandler } = makeMockWin();
      const reloadCurrentRole = jest.fn();
      KeyboardShortcuts.attach(win, 'TestProfile', reloadCurrentRole);
      const ev = fire(getHandler(), { key: 'F5', control: true, alt: false, shift: false });
      expect(ev.preventDefault).not.toHaveBeenCalled();
      expect(wc.reload).not.toHaveBeenCalled();
      expect(reloadCurrentRole).not.toHaveBeenCalled();
    });
  });

  describe('F12 → toggle DevTools', () => {
    test('F12 (sem modificadores) chama toggleDevTools', () => {
      const { win, wc, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F12', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(wc.toggleDevTools).toHaveBeenCalled();
    });
  });

  describe('Alt+F4 → close', () => {
    test('Alt+F4 chama win.close', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F4', alt: true, control: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(win.close).toHaveBeenCalled();
    });
  });

  describe('Bloqueios', () => {
    test('F10 é bloqueado', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F10', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
    });

    test('Ctrl+Shift+I é bloqueado (use F12)', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'I', control: true, alt: false, shift: true });
      expect(ev.preventDefault).toHaveBeenCalled();
    });

    test('Ctrl+Shift+J é bloqueado', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'J', control: true, alt: false, shift: true });
      expect(ev.preventDefault).toHaveBeenCalled();
    });

    test('Alt sozinho (sem F4) é bloqueado (menu toggle)', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'Alt', alt: true, control: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
    });
  });

  describe('teclas normais não são interceptadas', () => {
    test('letra "a" sem modificadores passa direto', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'a', control: false, alt: false, shift: false });
      expect(ev.preventDefault).not.toHaveBeenCalled();
    });

    test('Enter passa direto', () => {
      const { win, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'Enter', control: false, alt: false, shift: false });
      expect(ev.preventDefault).not.toHaveBeenCalled();
    });
  });
});
