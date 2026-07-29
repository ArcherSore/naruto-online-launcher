/**
 * User-level Flash debugger configuration (mm.cfg) for the research probe.
 *
 * This is deliberately separate from mms.js. mm.cfg is a debugger/player
 * configuration file; mms.cfg is an administrator policy file.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKUP_FILE = 'mm.cfg.original';
const STATE_FILE = 'mm.cfg.state.json';

function getMmCfgPath(platform, homeDir) {
  const currentPlatform = platform || process.platform;
  const home = homeDir || os.homedir();
  if (currentPlatform === 'win32') return path.join(home, 'mm.cfg');
  if (currentPlatform === 'linux') {
    return path.join(home, '.macromedia', 'Flash_Player', 'mm.cfg');
  }
  if (currentPlatform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Macromedia', 'mm.cfg');
  }
  throw new Error('unsupported-platform');
}

function normalizePreloadPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function appendPreloadSwf(original, preloadPath, parameters) {
  const content = original || '';
  const separator = content.length === 0 || /(?:\r?\n)$/.test(content) ? '' : '\n';
  const query =
    parameters && Number.isInteger(parameters.port) ? '?port=' + parameters.port : '';
  return content + separator + 'PreloadSwf=' + normalizePreloadPath(preloadPath) + query + '\n';
}

class MmCfgSession {
  constructor(options) {
    const opts = options || {};
    this.fs = opts.fs || fs;
    this.cfgPath = opts.cfgPath || getMmCfgPath(opts.platform, opts.homeDir);
    this.stateDir = opts.stateDir;
    this.backupPath = path.join(this.stateDir, BACKUP_FILE);
    this.statePath = path.join(this.stateDir, STATE_FILE);
    this.active = false;
  }

  recoverStaleBackup() {
    if (!this.fs.existsSync(this.statePath)) return false;
    const state = JSON.parse(this.fs.readFileSync(this.statePath, 'utf8'));
    this._restoreState(state);
    return true;
  }

  apply(preloadPath, parameters) {
    if (this.active) return this.cfgPath;
    if (!this.stateDir) throw new Error('missing-state-dir');
    if (!this.fs.existsSync(preloadPath)) throw new Error('probe-swf-missing');

    this.fs.mkdirSync(this.stateDir, { recursive: true });
    this.fs.mkdirSync(path.dirname(this.cfgPath), { recursive: true });
    this.recoverStaleBackup();

    const existed = this.fs.existsSync(this.cfgPath);
    const original = existed ? this.fs.readFileSync(this.cfgPath) : Buffer.alloc(0);
    if (existed) this.fs.copyFileSync(this.cfgPath, this.backupPath);
    const state = {
      cfgPath: this.cfgPath,
      existed: existed,
      backupPath: existed ? this.backupPath : null
    };
    this.fs.writeFileSync(this.statePath, JSON.stringify(state), 'utf8');

    const lastByte = original.length > 0 ? original[original.length - 1] : null;
    const separator =
      original.length === 0 || lastByte === 10 || lastByte === 13 ? Buffer.alloc(0) : Buffer.from('\n');
    const query =
      parameters && Number.isInteger(parameters.port) ? '?port=' + parameters.port : '';
    const directive = Buffer.from(
      'PreloadSwf=' + normalizePreloadPath(preloadPath) + query + '\n',
      'utf8'
    );
    this.fs.writeFileSync(this.cfgPath, Buffer.concat([original, separator, directive]));
    this.active = true;
    return this.cfgPath;
  }

  restore() {
    if (!this.fs.existsSync(this.statePath)) {
      this.active = false;
      return false;
    }
    const state = JSON.parse(this.fs.readFileSync(this.statePath, 'utf8'));
    this._restoreState(state);
    this.active = false;
    return true;
  }

  _restoreState(state) {
    if (
      !state ||
      state.cfgPath !== this.cfgPath ||
      (state.existed && state.backupPath !== this.backupPath)
    ) {
      throw new Error('invalid-mm-cfg-state');
    }
    if (state.existed) {
      if (!state.backupPath || !this.fs.existsSync(state.backupPath)) {
        throw new Error('mm-cfg-backup-missing');
      }
      this.fs.copyFileSync(state.backupPath, this.cfgPath);
    } else if (this.fs.existsSync(this.cfgPath)) {
      this.fs.unlinkSync(this.cfgPath);
    }
    if (state.backupPath && this.fs.existsSync(state.backupPath)) {
      this.fs.unlinkSync(state.backupPath);
    }
    this.fs.unlinkSync(this.statePath);
  }
}

module.exports = {
  getMmCfgPath: getMmCfgPath,
  normalizePreloadPath: normalizePreloadPath,
  appendPreloadSwf: appendPreloadSwf,
  MmCfgSession: MmCfgSession
};
