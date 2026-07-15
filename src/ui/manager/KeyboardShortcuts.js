/**
 * ui/manager/KeyboardShortcuts.js — Atalhos de teclado do jogo (Fase 3d split)
 *
 * Responsabilidade ÚNICA (SRP): interceptar atalhos de teclado nas janelas de
 * jogo via webContents 'before-input-event'. Inclui os pendências herdadas:
 *   - F5  → reload da sessão Flash (sem fechar a janela)
 *   - F12 → toggle DevTools
 *   - Alt+F4 → fecha a janela (kill switch graceful)
 *   - Bloqueia F10/Alt (menu bar Chromium), Ctrl+Shift+I/J (use F12)
 *
 * Histórico: era inline no God Object game-launcher.js (620 linhas). Extraído
 * para isolar a lógica de input. F5/F12 já existiam desde v4.9.1.
 */

'use strict';

const logger = require('../../utils/logger');

/**
 * Anexa o handler de atalhos ao webContents de uma janela de jogo.
 * @param {Electron.BrowserWindow} win
 * @param {string} profileName - para logging
 */
function attach(win, profileName) {
  if (!win || !win.webContents) return;
  const wc = win.webContents;

  wc.on('before-input-event', function (event, input) {
    // Alt+F4 → fecha a janela (o kill switch do SessionLifecycle trata o graceful)
    if (input.alt && input.key === 'F4') {
      event.preventDefault();
      win.close();
      return;
    }
    // F5 → recarrega a página (reload da sessão Flash sem fechar a janela).
    if (input.key === 'F5' && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      logger.info('F5: recarregando sessão Flash para ' + profileName);
      wc.reload();
      return;
    }
    // F12 → toggle DevTools (liberado pra debug).
    // Ctrl+Shift+I continua bloqueado (F12 é mais intuitivo e não conflita com o jogo).
    if (input.key === 'F12' && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      wc.toggleDevTools();
      return;
    }
    // Bloqueia F10 (menu bar do Chromium), Alt (menu toggle)
    if (
      input.key === 'F10' ||
      (input.alt && !input.control && !input.shift && input.key !== 'F4')
    ) {
      event.preventDefault();
      return;
    }
    // Bloqueia Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console) — use F12
    if (input.control && input.shift && (input.key === 'I' || input.key === 'J')) {
      event.preventDefault();
      return;
    }
  });
}

module.exports = {
  attach: attach
};
