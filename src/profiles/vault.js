/**
 * profiles/vault.js — Cofre de credenciais criptografado (auto-login real)
 * v3.0.0 — INOVAÇÃO DISRUPTIVA
 *
 * PROBLEMA QUE RESOLVE:
 *   Nenhum launcher de Naruto Online existente faz auto-login por CREDENCIAIS.
 *   Todos contam apenas com cookies de sessão (que expiram). Quando o cookie
 *   expira, o usuário refaz login manualmente. Chato.
 *
 *   O Shinobi Launcher guarda credenciais (user/senha) criptografadas e as
 *   injeta no formulário de login do jogo via executeJavaScript quando a
 *   sessão cookie expira. Belt-and-suspenders: cookie partition é o primário,
 *   o vault é o fallback que evita re-login manual.
 *
 * CRIPTOGRAFIA (Electron 11 NÃO tem safeStorage — introduzido em v15):
 *   AES-256-GCM com chave derivada de identificador de máquina:
 *     key = SHA-256(hostname + username + userDataPath)
 *   IV aleatório de 12 bytes por credencial. Tag GCM de 16 bytes.
 *   Storage: base64({ iv, ct, tag }) em vault.json (SEPARADO de profiles.json).
 *
 *   Modelo de ameaça: protege contra leitura offline do arquivo vault.json
 *   em outra máquina/usuário. NÃO protege contra attacker com acesso ao
 *   processo rodando (nesse caso qualquer keychain OS também cederia).
 *   Suficiente para um launcher de jogo (não é banking).
 *
 * AUTO-LOGIN FLOW:
 *   1. Profile tem vaultEnabled=true e credenciais salvas.
 *   2. game-launcher abre a janela com a partition do perfil.
 *   3. Após did-finish-load, injectAutoLogin() roda:
 *      a. Detecta formulário de login (input[name*=user], input[type=password]).
 *      b. Se encontrado → preenche + submete.
 *      c. Se não encontrado (já logado via cookie) → no-op.
 *   4. Tudo envolto em try/catch — nunca quebra o jogo se a UI mudar.
 */

'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');

const VAULT_FILE = 'vault.json';
const VAULT_SALT_FILE = 'vault.salt';
const MAX_VAULT_BYTES = 256 * 1024; // 256KB sane limit

// v3.6: Key derivation com salt aleatório persistido (fix S2)
// ANTES: SHA-256(hostname+username+userDataPath) — determinístico, zero entropia
// AGORA: SHA-256(machineSeed + saltAleatório) — salt único por instalação
// O salt é gerado uma única vez e persistido em vault.salt no userData.
let _cachedKey = null;
let _cachedSalt = null;

function _getSaltPath() {
  return path.join(app.getPath('userData'), VAULT_SALT_FILE);
}

function _getSalt() {
  if (_cachedSalt) return _cachedSalt;
  const saltPath = _getSaltPath();
  try {
    if (fs.existsSync(saltPath)) {
      _cachedSalt = fs.readFileSync(saltPath);
    } else {
      // Gera salt aleatório de 32 bytes e persiste
      _cachedSalt = crypto.randomBytes(32);
      fs.writeFileSync(saltPath, _cachedSalt);
      logger.info('vault: salt aleatório gerado e persistido');
    }
  } catch (e) {
    logger.error('vault: erro ao carregar salt: ' + e.message);
    _cachedSalt = crypto.randomBytes(32); // fallback in-memory (não persiste)
  }
  return _cachedSalt;
}

function _machineKey() {
  if (_cachedKey) return _cachedKey;
  let userDataPath = '';
  try { userDataPath = app.getPath('userData'); } catch (_) { /* before ready */ }
  let username = '';
  try { username = os.userInfo().username; } catch (_) { /* ignore */ }
  // v3.6: machineSeed + salt aleatório (não mais determinístico puro)
  const machineSeed = os.hostname() + '|' + username + '|' + userDataPath + '|shinobi-vault-v2';
  const salt = _getSalt();
  // PBKDF2 com machineSeed + salt = chave não previsível sem acesso ao salt
  _cachedKey = crypto.pbkdf2Sync(machineSeed, salt, 100000, 32, 'sha512');
  return _cachedKey;
}

function _getVaultPath() {
  return path.join(app.getPath('userData'), VAULT_FILE);
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} base64({iv, ct, tag})
 */
function encrypt(plaintext) {
  try {
    const key = _machineKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  } catch (e) {
    logger.error('vault: encrypt falhou: ' + e.message);
    return '';
  }
}

/**
 * Decrypt a base64 payload produced by encrypt().
 * @param {string} payload
 * @returns {string} plaintext, or '' on failure
 */
function decrypt(payload) {
  try {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 12 + 16) return '';
    const iv = buf.slice(0, 12);
    const tag = buf.slice(buf.length - 16);
    const ct = buf.slice(12, buf.length - 16);
    const key = _machineKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    logger.debug('vault: decrypt falhou: ' + e.message);
    return '';
  }
}

// ── In-memory cache of vault entries: profileId -> { user, pass (encrypted) } ──
let _store = null;
let _listeners = [];

function _ensureLoaded() {
  if (_store !== null) return;
  const file = _getVaultPath();
  try {
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.size > MAX_VAULT_BYTES) throw new Error('oversized');
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      _store = (parsed && typeof parsed === 'object') ? parsed : {};
    } else {
      _store = {};
    }
  } catch (e) {
    logger.error('vault: falha ao ler vault.json: ' + e.message + ' — iniciando vazio');
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
      logger.error('vault: recusa salvar — excede 256KB');
      return false;
    }
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file);
    _listeners.forEach(function (cb) { try { cb(); } catch (_) { /* ignore */ } });
    return true;
  } catch (e) {
    logger.error('vault: falha ao salvar: ' + e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
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
    user: encrypt(user || ''),
    pass: encrypt(pass || ''),
    updatedAt: Date.now(),
  };
  logger.info('vault: credenciais salvas para ' + profileId);
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
    user: decrypt(entry.user),
    pass: decrypt(entry.pass),
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
  logger.info('vault: credenciais removidas para ' + profileId);
  return _persist();
}

/**
 * The JS to inject into the game page for auto-login.
 *
 * v4.1 (Sprint 5): REWRITE baseado na EXTRAÇÃO REAL DO HTML das 8 regiões.
 * Antes (v3.5.2 → v4.0.2) usava seletores genéricos (input[name*=user i], etc.)
 * que também batiam em campos errados. Agora usa seletores ESPECÍFICOS da Oasis:
 *   - input[name="oasun"]   / input[name="oaspd"]   → OLD design (pt, de)
 *   - input[name="hd_oasun"]/ input[name="hd_oaspd"] → NEW design (en, es, pl, fr)
 *
 * Login function calls (extraídas dos JS das próprias páginas — Sprint 5):
 *   1. hd_ajax_login()  → NEW design (en/es/pl/fr) — JSONP GET para passport.oasgames.com
 *   2. ajax_login()     → OLD design (pt/de)       — JSONP GET para passport.oasgames.com
 *   3. click no botão   → fallback genérico
 *
 * JSONP GET não sofre CORS (é <script src=>). Cookie é gravado pela própria página
 * em .narutowebgame.com (host da página), não em .oasgames.com (host do passport).
 *
 * dlFlag guard: NEW design checa `if(dlFlag){dlFlag=false;...}` em hd_ajax_login.
 * Se uma tentativa anterior falhou e deixou dlFlag=false, a próxima chamada é
 * silenciosamente ignorada. Resetamos dlFlag=true antes de chamar.
 *
 * @param {string} user
 * @param {string} pass
 * @returns {string} executable JS string (executado via webContents.executeJavaScript)
 */
function buildAutoLoginScript(user, pass) {
  // Escape for safe embedding into a JS string literal
  const u = JSON.stringify(String(user));
  const p = JSON.stringify(String(pass));
  // v4.2: Auto-login CORRIGIDO — cobre TODAS as 3 estruturas de página de login:
  //
  //   1. Serverlist NEW design (en/es/pl/fr): hd_oasun + hd_oaspd + hd_ajax_login()
  //   2. Serverlist OLD design (pt/de):        oasun + oaspd + ajax_login()
  //   3. REDIRECTED /login page (TODAS regiões): user_email + user_password + ajax_login()
  //
  // BUG v4.1: quando o usuário acessava /serverlist/sN sem sessão, o servidor
  // redirecionava (302) para /{lang}/login?server_id=N — uma página DIFERENTE
  // com campos user_email/user_password. O script v4.1 só procurava oasun/hd_oasun
  // → nunca encontrava o form → MutationObserver esperava infinitamente →
  // "login automatico nao funcionou, so fica parado na pagina".
  //
  // FIX v4.2: seletores expandidos para incluir user_email/user_password.
  // A função ajax_login() existe em AMBAS as páginas (OLD serverlist + /login redirect),
  // então o mesmo código funciona para todas.
  return '(function(){try{' +
    'var u=' + u + ',p=' + p + ';' +
    'var attempts=0,maxAttempts=60;' + // 60 x 250ms = 15s max (v4.4: increased from 40/10s for slow connections)

    // setVal: native value setter (compatível com jQuery .val() e React controlled inputs).
    // Dispara input+change para acordar listeners.
    'var setVal=function(el,v){try{' +
    '  var proto=window.HTMLInputElement&&HTMLInputElement.prototype;' +
    '  var desc=proto&&Object.getOwnPropertyDescriptor(proto,"value");' +
    '  var setter=desc&&desc.set?desc.set:function(v){this.value=v;};' +
    '  setter.call(el,v);' +
    '  el.dispatchEvent(new Event("input",{bubbles:true}));' +
    '  el.dispatchEvent(new Event("change",{bubbles:true}));' +
    '}catch(e){el.value=v;}};' +

    // doLogin: orquestra preenchimento + submit.
    'var doLogin=function(){' +
    '  try{' +
    // 1. Acha TODOS os campos de user/pass (3 designs possíveis):
    //    a) Serverlist NEW: hd_oasun / hd_oaspd
    //    b) Serverlist OLD: oasun / oaspd
    //    c) Redirected /login page: user_email / user_password (TODAS regiões)
    '    var unames=document.querySelectorAll("input[name=oasun],input[name=hd_oasun],input[name=user_email],input#user_email");' +
    '    var pwds=document.querySelectorAll("input[name=oaspd],input[name=hd_oaspd],input[name=user_password],input#user_password");' +
    '    if(!unames.length||!pwds.length)return "not-found";' +
    // 2. Preenche TODOS os campos (header + main form em NEW design + /login page)
    '    for(var i=0;i<unames.length;i++)setVal(unames[i],u);' +
    '    for(var j=0;j<pwds.length;j++)setVal(pwds[j],p);' +
    // 3. Marca checkboxes "remember me" conhecidas da Oasis (3 variants)
    '    var cbs=document.querySelectorAll("#checkbox,#hd_checkbox,#checkbox_pwd,#checked_pwd");' +
    '    for(var k=0;k<cbs.length;k++){try{cbs[k].checked=true;cbs[k].dispatchEvent(new Event("change",{bubbles:true}));}catch(e){}}' +
    // 4. Reseta dlFlag guard (NEW design hd_ajax_login checa isso)
    '    try{if(typeof window.dlFlag!=="undefined")window.dlFlag=true;}catch(e){}' +
    // 5. Chama função de submit da própria página (JSONP GET, sem CORS)
    //    hd_ajax_login() → NEW serverlist design
    //    ajax_login()    → OLD serverlist design AND redirected /login page
    '    try{' +
    '      if(typeof window.hd_ajax_login==="function"){window.hd_ajax_login();return "filled";}' +
    '    }catch(e){}' +
    '    try{' +
    '      if(typeof window.ajax_login==="function"){window.ajax_login();return "filled";}' +
    '    }catch(e){}' +
    // 6. Fallback: clica no botão de submit (específicos da Oasis — 3 designs)
    '    var btn=document.querySelector("a.hd_login_btn,a.na_l_btn.hd_login_btn,a.login_btn,.login_btn,a[class*=login_btn]");' +
    '    if(btn){try{btn.click();return "clicked";}catch(e){}}' +
    '    return "filled";' +
    '  }catch(err){try{console.error("[doLogin]",err);}catch(_){}return "not-found";}' +
    '};' +

    // Tentativa imediata
    'var r=doLogin();' +
    'if(r!=="not-found")return r;' +

    // MutationObserver: vigia DOM até form aparecer (forms em modal/iframe demoram)
    'var obs=new MutationObserver(function(_m,o){' +
    '  attempts++;' +
    '  var res=doLogin();' +
    '  if(res!=="not-found"){o.disconnect();return;}' +
    '  if(attempts>=maxAttempts)o.disconnect();' +
    '});' +
    'obs.observe(document.documentElement||document.body,{childList:true,subtree:true});' +

    // Polling fallback (caso MutationObserver não dispare em páginas estáticas)
    'var poll=setInterval(function(){' +
    '  attempts++;' +
    '  var res=doLogin();' +
    '  if(res!=="not-found"){clearInterval(poll);return;}' +
    '  if(attempts>=maxAttempts){clearInterval(poll);' +
    // v4.4: delayed retry — after MutationObserver+polling expire, try once more
    // after 3s (page may still be loading after a redirect on slow connections)
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

    // v4.4: Verification check — after calling ajax_login/hd_ajax_login, verify
    // that the login actually progressed within 5 seconds. Checks if URL changed
    // (redirect to serverlist = success) or if error elements appeared.
    // This runs only if the immediate doLogin returned "filled".
    // Note: this is a fire-and-forget check, it does not block the return value.
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

    // Run verification after immediate attempt
    'if(r==="filled"){verifyLogin();} ' +

    'return "waiting";' +
    '}catch(e){return "error:"+e.message;}})()';
}

function onChange(cb) { if (typeof cb === 'function') _listeners.push(cb); }

// ═══════════════════════════════════════════════════════════════════════════
// v3.4: BACKUP CRIPTOGRAFADO COM SENHA MESTRE (AES-256-GCM + PBKDF2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Permite que o usuário exporte todos os perfis (+ credenciais) em um único
// arquivo de texto criptografado, protegido por uma senha mestre digitada.
// Seguro para migrar entre Windows ↔ Linux.
//
// CRIPTOGRAFIA:
//   - Algoritmo: AES-256-GCM (authenticated encryption)
//   - Key derivation: PBKDF2 com SHA-512, 200000 iterações, salt aleatório 32 bytes
//   - IV aleatório 12 bytes por arquivo
//   - Auth tag 16 bytes (integridade)
//   - Formato: base64({ version, salt, iv, ct, tag, kdfInfo })
//
// SEGURANÇA:
//   - 200k iterações PBKDF2 = ~1s por derivada → resistente a brute-force
//   - Salt único por arquivo → rainbow tables inúteis
//   - AES-GCM detecta tampering (auth tag) → corrupção = falha na decrypt
//   - Senha NUNCA é armazenada — apenas o hash derivado é usado momentaneamente

const PBKDF2_ITERATIONS = 200000;
const PBKDF2_KEYLEN = 32; // 256 bits = AES-256
const PBKDF2_SALT_LEN = 32;
const GCM_IV_LEN = 12;
const BACKUP_VERSION = 1;

/**
 * Deriva chave AES-256 a partir de senha mestre usando PBKDF2-SHA512.
 * @param {string} password - senha mestre digitada pelo usuário
 * @param {Buffer} salt - salt aleatório de 32 bytes
 * @returns {Buffer} chave de 32 bytes
 */
function _deriveKey(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha512');
}

/**
 * Exporta perfis + credenciais em arquivo criptografado com senha mestre.
 * @param {Array} profiles - lista de perfis do store
 * @param {Object} credentialsMap - { profileId: { user, pass } }
 * @param {string} password - senha mestre digitada pelo usuário
 * @returns {string} base64 do arquivo criptografado (pronto para salvar)
 */
function exportEncryptedBackup(profiles, credentialsMap, password) {
  if (!password || String(password).length < 4) {
    throw new Error('Senha mestre deve ter pelo menos 4 caracteres');
  }
  if (!Array.isArray(profiles)) {
    throw new Error('Lista de perfis inválida');
  }

  // Monta payload com perfis + credenciais
  const payload = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    profiles: profiles,
    credentials: credentialsMap || {},
  };

  const plaintext = JSON.stringify(payload);
  const salt = crypto.randomBytes(PBKDF2_SALT_LEN);
  const iv = crypto.randomBytes(GCM_IV_LEN);
  const key = _deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Formato: base64(JSON({ version, kdf, salt, iv, ct, tag }))
  const envelope = {
    version: BACKUP_VERSION,
    kdf: {
      algorithm: 'pbkdf2',
      hash: 'sha512',
      iterations: PBKDF2_ITERATIONS,
      keyLength: PBKDF2_KEYLEN,
    },
    cipher: {
      algorithm: 'aes-256-gcm',
      ivLength: GCM_IV_LEN,
    },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };

  const result = Buffer.from(JSON.stringify(envelope)).toString('base64');
  logger.info('vault: backup criptografado gerado — ' + profiles.length + ' perfis, ' + result.length + ' bytes');
  return result;
}

/**
 * Importa arquivo criptografado com senha mestre.
 * @param {string} encryptedBase64 - base64 do arquivo criptografado
 * @param {string} password - senha mestre digitada pelo usuário
 * @returns {{profiles:Array, credentials:Object, exportedAt:number}} payload descriptografado
 * @throws {Error} se senha incorreta, arquivo corrompido, ou versão incompatível
 */
function importEncryptedBackup(encryptedBase64, password) {
  if (!encryptedBase64 || !password) {
    throw new Error('Arquivo e senha são obrigatórios');
  }

  let envelope;
  try {
    const envelopeJson = Buffer.from(encryptedBase64, 'base64').toString('utf8');
    envelope = JSON.parse(envelopeJson);
  } catch (e) {
    throw new Error('Arquivo de backup inválido ou corrompido');
  }

  if (!envelope || envelope.version !== BACKUP_VERSION) {
    throw new Error('Versão de backup incompatível (esperada ' + BACKUP_VERSION + ')');
  }

  let salt, iv, ct, tag;
  try {
    salt = Buffer.from(envelope.salt, 'base64');
    iv = Buffer.from(envelope.iv, 'base64');
    ct = Buffer.from(envelope.ct, 'base64');
    tag = Buffer.from(envelope.tag, 'base64');
  } catch (e) {
    throw new Error('Estrutura do arquivo de backup inválida');
  }

  // Valida tamanhos esperados
  if (salt.length !== PBKDF2_SALT_LEN) {
    throw new Error('Salt inválido (' + salt.length + ' bytes, esperado ' + PBKDF2_SALT_LEN + ')');
  }
  if (iv.length !== GCM_IV_LEN) {
    throw new Error('IV inválido (' + iv.length + ' bytes, esperado ' + GCM_IV_LEN + ')');
  }

  // Deriva chave com a senha fornecida
  const key = _deriveKey(password, salt);

  // Tenta descriptografar — AES-GCM lança se senha incorreta (auth tag mismatch)
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    // Auth tag mismatch = senha incorreta OU arquivo corrompido/tampered
    throw new Error('Senha incorreta ou arquivo corrompido');
  }

  let payload;
  try {
    payload = JSON.parse(plaintext);
  } catch (e) {
    throw new Error('Conteúdo descriptografado inválido');
  }

  if (!Array.isArray(payload.profiles)) {
    throw new Error('Schema do backup inválido: perfis não é array');
  }

  logger.info('vault: backup descriptografado — ' + payload.profiles.length + ' perfis, exportado em ' + new Date(payload.exportedAt).toISOString());
  return payload;
}

module.exports = {
  setCredentials: setCredentials,
  getCredentials: getCredentials,
  hasCredentials: hasCredentials,
  removeCredentials: removeCredentials,
  buildAutoLoginScript: buildAutoLoginScript,
  encrypt: encrypt,
  decrypt: decrypt,
  onChange: onChange,
  // v3.4: Backup criptografado
  exportEncryptedBackup: exportEncryptedBackup,
  importEncryptedBackup: importEncryptedBackup,
};
