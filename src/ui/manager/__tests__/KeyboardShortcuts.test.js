/**
 * Testes para src/ui/manager/KeyboardShortcuts.js (Fase 3d split)
 * Verifica F5 reload, F12 DevTools, Alt+F4 close, e bloqueios.
 */

const KeyboardShortcuts = require('../KeyboardShortcuts');

function makeMockWin() {
  let handler = null;
  const wc = {
    on: jest.fn((evt, fn) => {
      if (evt === 'before-input-event') handler = fn;
    }),
    reload: jest.fn(),
    toggleDevTools: jest.fn()
  };
  const win = {
    webContents: wc,
    close: jest.fn(),
    isDestroyed: jest.fn(() => false)
  };
  return { win, wc, getHandler: () => handler };
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

  describe('F5 → reload da sessão Flash', () => {
    test('F5 (sem modificadores) chama wc.reload e preventDefault', () => {
      const { win, wc, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F5', control: false, alt: false, shift: false });
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(wc.reload).toHaveBeenCalled();
    });

    test('Ctrl+F5 NÃO recarrega (deixa o Chromium tratar)', () => {
      const { win, wc, getHandler } = makeMockWin();
      KeyboardShortcuts.attach(win, 'TestProfile');
      const ev = fire(getHandler(), { key: 'F5', control: true, alt: false, shift: false });
      expect(ev.preventDefault).not.toHaveBeenCalled();
      expect(wc.reload).not.toHaveBeenCalled();
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
