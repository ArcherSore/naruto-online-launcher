/**
 * profiles/ProfileVault.js — CRUD de credenciais + auto-login script (Fase 3e split)
 *
 * Responsabilidade ÚNICA (SRP): persistir credenciais (user/pass) criptografadas
 * em vault.json e gerar o script de auto-login injetado no jogo. Delega a
 * criptografia ao CryptoService e a derivação de chave ao PasswordManager.
 *
 * Histórico: era parte do God Object vault.js (571 linhas). Split em 3:
 *   - CryptoService.js   — primitivas cripto puras
 *   - PasswordManager.js — chave de máquina + senha mestre
 *   - ProfileVault.js    (este) — CRUD + buildAutoLoginScript
 *
 * vault.js permanece como facade re-exportando os 3 módulos (API preservada).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');
const CryptoService = require('./CryptoService');
const PasswordManager = require('./PasswordManager');

const VAULT_FILE = 'vault.json';
const MAX_VAULT_BYTES = 256 * 1024; // 256KB sane limit

// In-memory cache: profileId -> { user, pass (encrypted), updatedAt }
let _store = null;
let _listeners = [];

function _getVaultPath() {
  return path.join(app.getPath('userData'), VAULT_FILE);
}

/**
 * Encrypt com a chave de máquina (conveniência sobre CryptoService.encrypt).
 * @param {string} plaintext
 * @returns {string}
 */
function _encryptWithMachineKey(plaintext) {
  try {
    return CryptoService.encrypt(plaintext, PasswordManager.getMachineKey());
  } catch (e) {
    logger.error('ProfileVault: encrypt falhou: ' + e.message);
    return '';
  }
}

/**
 * Decrypt com a chave de máquina.
 * @param {string} payload
 * @returns {string}
 */
function _decryptWithMachineKey(payload) {
  try {
    return CryptoService.decrypt(payload, PasswordManager.getMachineKey());
  } catch (e) {
    logger.debug('ProfileVault: decrypt falhou: ' + e.message);
    return '';
  }
}

function _ensureLoaded() {
  if (_store !== null) return;
  const file = _getVaultPath();
  try {
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.size > MAX_VAULT_BYTES) throw new Error('oversized');
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      _store = parsed && typeof parsed === 'object' ? parsed : {};
    } else {
      _store = {};
    }
  } catch (e) {
    logger.error('ProfileVault: falha ao ler vault.json: ' + e.message + ' — iniciando vazio');
    _store = {};
  }
}

function _persist() {
  _ensureLoaded();
  const file = _getVaultPath();
  const tmp = file + '.tmp';
  try {
    const json = JSON.stringify(_store, null, 2);
    if (Buffer.byteLength(json, 'utf8') > MAX_VAULT_BYTES) {
      logger.error('ProfileVault: recusa salvar — excede 256KB');
      return false;
    }
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file);
    _listeners.forEach(function (cb) {
      try {
        cb();
      } catch (_) {
        /* ignore */
      }
    });
    return true;
  } catch (e) {
    logger.error('ProfileVault: falha ao salvar: ' + e.message);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    return false;
  }
}

/**
 * Save credentials for a profile (encrypted at rest).
 * @param {string} profileId
 * @param {string} user
 * @param {string} pass
 * @returns {boolean}
 */
function setCredentials(profileId, user, pass) {
  _ensureLoaded();
  _store[profileId] = {
    user: _encryptWithMachineKey(user || ''),
    pass: _encryptWithMachineKey(pass || ''),
    updatedAt: Date.now()
  };
  logger.info('ProfileVault: credenciais salvas para ' + profileId);
  return _persist();
}

/**
 * Get decrypted credentials for a profile.
 * @param {string} profileId
 * @returns {{user: string, pass: string}|null}
 */
function getCredentials(profileId) {
  _ensureLoaded();
  const entry = _store[profileId];
  if (!entry) return null;
  return {
    user: _decryptWithMachineKey(entry.user),
    pass: _decryptWithMachineKey(entry.pass)
  };
}

/**
 * Check if a profile has stored credentials.
 * @param {string} profileId
 * @returns {boolean}
 */
function hasCredentials(profileId) {
  _ensureLoaded();
  return !!_store[profileId];
}

/**
 * Remove credentials for a profile.
 * @param {string} profileId
 * @returns {boolean}
 */
function removeCredentials(profileId) {
  _ensureLoaded();
  if (!_store[profileId]) return false;
  delete _store[profileId];
  logger.info('ProfileVault: credenciais removidas para ' + profileId);
  return _persist();
}

/**
 * The JS to inject into the game page for auto-login.
 * Cobertura: 3 designs de página de login da Oasis (NEW serverlist hd_oasun,
 * OLD serverlist oasun, redirected /login user_email) + MutationObserver +
 * polling fallback + delayed retry + verification.
 *
 * @param {string} user
 * @param {string} pass
 * @returns {string} executable JS string
 */
function buildAutoLoginScript(user, pass) {
  const u = JSON.stringify(String(user));
  const p = JSON.stringify(String(pass));
  return (
    '(function(){try{' +
    'var u=' +
    u +
    ',p=' +
    p +
    ';' +
    'var attempts=0,maxAttempts=60;' +
    'var setVal=function(el,v){try{' +
    '  var proto=window.HTMLInputElement&&HTMLInputElement.prototype;' +
    '  var desc=proto&&Object.getOwnPropertyDescriptor(proto,"value");' +
    '  var setter=desc&&desc.set?desc.set:function(v){this.value=v;};' +
    '  setter.call(el,v);' +
    '  el.dispatchEvent(new Event("input",{bubbles:true}));' +
    '  el.dispatchEvent(new Event("change",{bubbles:true}));' +
    '}catch(e){el.value=v;}};' +
    'var doLogin=function(){' +
    '  try{' +
    '    var unames=document.querySelectorAll("input[name=oasun],input[name=hd_oasun],input[name=user_email],input#user_email");' +
    '    var pwds=document.querySelectorAll("input[name=oaspd],input[name=hd_oaspd],input[name=user_password],input#user_password");' +
    '    if(!unames.length||!pwds.length)return "not-found";' +
    '    for(var i=0;i<unames.length;i++)setVal(unames[i],u);' +
    '    for(var j=0;j<pwds.length;j++)setVal(pwds[j],p);' +
    '    var cbs=document.querySelectorAll("#checkbox,#hd_checkbox,#checkbox_pwd,#checked_pwd");' +
    '    for(var k=0;k<cbs.length;k++){try{cbs[k].checked=true;cbs[k].dispatchEvent(new Event("change",{bubbles:true}));}catch(e){}}' +
    '    try{if(typeof window.dlFlag!=="undefined")window.dlFlag=true;}catch(e){}' +
    '    try{' +
    '      if(typeof window.hd_ajax_login==="function"){window.hd_ajax_login();return "filled";}' +
    '    }catch(e){}' +
    '    try{' +
    '      if(typeof window.ajax_login==="function"){window.ajax_login();return "filled";}' +
    '    }catch(e){}' +
    '    var btn=document.querySelector("a.hd_login_btn,a.na_l_btn.hd_login_btn,a.login_btn,.login_btn,a[class*=login_btn]");' +
    '    if(btn){try{btn.click();return "clicked";}catch(e){}}' +
    '    return "filled";' +
    '  }catch(err){try{console.error("[doLogin]",err);}catch(_){}return "not-found";}' +
    '};' +
    'var r=doLogin();' +
    'if(r!=="not-found")return r;' +
    'var obs=new MutationObserver(function(_m,o){' +
    '  attempts++;' +
    '  var res=doLogin();' +
    '  if(res!=="not-found"){o.disconnect();return;}' +
    '  if(attempts>=maxAttempts)o.disconnect();' +
    '});' +
    'obs.observe(document.documentElement||document.body,{childList:true,subtree:true});' +
    'var poll=setInterval(function(){' +
    '  attempts++;' +
    '  var res=doLogin();' +
    '  if(res!=="not-found"){clearInterval(poll);return;}' +
    '  if(attempts>=maxAttempts){clearInterval(poll);' +
    '    setTimeout(function(){' +
    '      try{var retry=doLogin();' +
    '        if(retry!=="not-found"){' +
    '          try{console.log("[auto-login] delayed retry succeeded:",retry);}catch(_){}' +
    '        }else{' +
    '          try{console.warn("[auto-login] delayed retry: form still not found after 18s");}catch(_){}' +
    '        }' +
    '      }catch(e){try{console.error("[auto-login] delayed retry error:",e);}catch(_){}}' +
    '    },3000);' +
    '  }' +
    '},250);' +
    'var verifyLogin=function(){' +
    '  var startUrl=window.location.href;' +
    '  setTimeout(function(){' +
    '    try{' +
    '      var currentUrl=window.location.href;' +
    '      var errEl=document.querySelector(".login-error,.error-msg,.alert-error,[class*=error_msg]");' +
    '      if(currentUrl!==startUrl){' +
    '        try{console.log("[auto-login] verification: URL changed — login likely succeeded");}catch(_){}' +
    '      }else if(errEl){' +
    '        try{console.warn("[auto-login] verification: error element found — login may have failed:",errEl.textContent.trim());}catch(_){}' +
    '      }else{' +
    '        try{console.warn("[auto-login] verification: URL unchanged and no error element — login status uncertain (server may be slow)");}catch(_){}' +
    '      }' +
    '    }catch(e){try{console.error("[auto-login] verification error:",e);}catch(_){}}' +
    '  },5000);' +
    '};' +
    'if(r==="filled"){verifyLogin();} ' +
    'return "waiting";' +
    '}catch(e){return "error:"+e.message;}})()'
  );
}

function onChange(cb) {
  if (typeof cb === 'function') _listeners.push(cb);
}

module.exports = {
  setCredentials: setCredentials,
  getCredentials: getCredentials,
  hasCredentials: hasCredentials,
  removeCredentials: removeCredentials,
  buildAutoLoginScript: buildAutoLoginScript,
  onChange: onChange,
  // exposto p/ testes
  _getVaultPath: _getVaultPath,
  MAX_VAULT_BYTES: MAX_VAULT_BYTES
};
