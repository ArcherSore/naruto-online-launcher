/**
 * Preload Script
 * v2.0.0 — Simplified, only exposes APIs with registered handlers
 *
 * Exposes a minimal API to the renderer process via contextBridge.
 * No nodeIntegration, no direct require — safe and auditable.
 *
 * v4.1 (Sprint 5): Removed 4 unhandled IPC channels that caused silent
 * promise hangs (launcher:get-version, launcher:update-available,
 * launcher:clear-cache, launcher:screenshot). None of these had
 * ipcMain.handle() registered anywhere, so any call would hang forever.
 *
 * Now only exposes what actually works. Game pages can call these from
 * their JavaScript if needed.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { DEBUG } = require('./main/debug');

// v5.0 (Fase 3, Decisão B): expõe a feature flag SHINOBI_DEBUG para o renderer.
// UI de debug (aba Dev, DevTools, inspector, tempmail inbox, JWT decoder) só
// renderiza quando isto é true (env var) OU quando o atalho Ctrl+Shift+D
// (hold 2s) destrava o runtime no renderer (localStorage).
contextBridge.exposeInMainWorld('__SHINOBI_DEBUG__', DEBUG);

contextBridge.exposeInMainWorld('narutoLauncher', {
  /**
   * Get the launcher version from package.json
   * @returns {Promise<string>} version string (e.g. "4.1.0")
   */
  getVersion: function() {
    return ipcRenderer.invoke('launcher:get-version');
  },
  /**
   * v5.0: Whether the launcher was booted with SHINOBI_DEBUG=1.
   * @returns {boolean}
   */
  isDebug: function () { return DEBUG; },
});
