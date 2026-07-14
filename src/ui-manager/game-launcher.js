/**
 * ui-manager/game-launcher.js — Janela de jogo por perfil (isolada)
 * v3.0.0
 *
 * Cada perfil recebe:
 *   - Uma BrowserWindow independente
 *   - Uma Electron Session partition ÚNICA (persist: ou shadow: via partition.js)
 *   - Cookies/localStorage/cache 100% isolados pelo Chromium
 *
 * v3.0 NOVIDADES:
 *   - Shadow Partitions: em Modo Batata, usa partition ephemeral + snapshot
 *     de cookies de auth no fechamento (economiza 30-80MB por perfil em disco/RAM).
 *   - AUTO-LOGIN via vault: se o perfil tem credenciais salvas, injeta no
 *     formulário de login após did-finish-load. Belt-and-suspenders com cookies.
 *   - Regiões corrigidas: br/na/eu/hk (v2.0 tinha pt/en/fr errados).
 *
 * Reaproveita v1.x: Flash PPAPI, blocker, cookies persistentes, shortcuts,
 * CSP, CSS injection, FB mock, navigation handling.
 */

'use strict';

const path = require('path');
const { BrowserWindow, shell } = require('electron');
const logger = require('../utils/logger');
const store = require('../profiles/store');
const partition = require('../profiles/partition');
const vault = require('../profiles/vault');
const { setupBlocker } = require('../network/blocker');
const { setupPersistentCookies } = require('../network/cookies');
// v4.8: shortcuts.js removido — launcher simplificado. Apenas guards de
// segurança (Alt+F4, DevTools) permanecem no before-input-event abaixo.

const WINDOW_TITLE = 'Naruto Online';
const CSP = "default-src 'self' * data: blob: http: https:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; " +
  "object-src 'self' * data: blob: http: https:; " +
  "style-src 'self' 'unsafe-inline' *; " +
  "img-src 'self' * data: blob: http: https:; " +
  "connect-src 'self' * http: https: ws: wss:; " +
  "media-src 'self' * data: blob: http: https:;";

// Map: profileId -> { window, shortcutsCleanup, partitionName, isShadow, autoLoginTimer, failLoadRetry }
const gameWindows = new Map();

// ── URL do portal de login unificado (v3.3) + regional (v3.4) ──
// v3.4: getGameUrl(region, language) retorna URL regional com locale do perfil.
// Sem região → portal unificado (login direto).
const urlConfig = require('../config/urls');
const LAUNCHER_PARAMS = urlConfig.getLauncherParams();

/**
 * Retorna URL do jogo para um perfil específico (região + idioma + servidor).
 * v3.5.1: Se perfil tem servidor (ex: "S799"), vai direto para a página desse servidor.
 * @param {Object} [profile] - perfil com region/language/server
 * @returns {string}
 */
function getGameUrl(profile) {
  if (!profile) return urlConfig.getGameUrl('br');
  return urlConfig.getGameUrl(profile.region, profile.language, profile.server);
}

/**
 * Verifica se há alguma janela de jogo aberta (cron-review-6).
 * Usado pelo controller.js para decidir se fechar o manager deve
 * hide (jogo rodando) ou permitir close → app.quit().
 * @returns {boolean}
 */
function hasOpenWindows() {
  for (const entry of gameWindows.values()) {
    if (entry.window && !entry.window.isDestroyed()) return true;
  }
  return false;
}

function resolveIconPath() {
  const fs = require('fs');
  const packaged = path.join(process.resourcesPath, 'icon.png');
  try { if (fs.existsSync(packaged)) return packaged; } catch (_) { /* ignore */ }
  return path.join(__dirname, '..', '..', 'assets', 'icon.png');
}

/**
 * Launch a game window for a profile.
 * @param {string} profileId
 * @param {Function} [onOpened]
 * @param {Function} [onClosed]
 */
function launchProfile(profileId, onOpened, onClosed) {
  const profile = store.get(profileId);
  if (!profile) {
    logger.error('Perfil não encontrado: ' + profileId);
    return;
  }

  // Already open → focus
  if (gameWindows.has(profileId)) {
    const entry = gameWindows.get(profileId);
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.show();
      entry.window.focus();
      if (onOpened) onOpened();
      return;
    }
  }

  const partName = partition.getPartitionName(profile);
  const isShadow = partition.shouldUseShadow(profile);
  logger.info('Abrindo perfil "' + profile.name + '" • ' + (isShadow ? 'shadow' : 'persist') + ' partition ' + partName);

  // v3.5: User-Agent spoofing — identifica o launcher como Mini-Client oficial
  // Isso faz o servidor tratar a requisição como client nativo (não browser)
  const LAUNCHER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36 ShinobiLauncher/3.5';

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    icon: resolveIconPath(),
    title: WINDOW_TITLE + ' — ' + profile.name,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,                  // Flash PPAPI
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition: partName,           // <- ISOLAMENTO TOTAL por perfil
      preload: path.join(__dirname, '..', 'preload.js'),
      // v3.5: User-Agent spoofing (Mini-Client recognition)
      userAgent: LAUNCHER_UA,
    },
  });

  // v3.5: Override User-Agent via session (garante em todas requests)
  win.webContents.session.setUserAgent(LAUNCHER_UA);

  const ses = win.webContents.session;

  // ── Network layer para ESTA partition ──
  // BUG FIX (cron-review-1): antes, setupPersistentCookies registrava onHeadersReceived
  // para cookie extension, e logo abaixo um SEGUNDO onHeadersReceived (CSP) o sobrescrevia.
  // Electron só permite 1 handler por session/evento → cookie extension ficava morta.
  // AGORA: CSP é passado como option e mesclado no mesmo handler interno do cookies.js.
  setupBlocker(ses);
  setupPersistentCookies(ses, { csp: CSP });

  win.setMenuBarVisibility(false);
  win.setTitle(WINDOW_TITLE + ' — ' + profile.name);

  win.on('page-title-updated', function (e) {
    e.preventDefault();
    win.setTitle(WINDOW_TITLE + ' — ' + profile.name);
  });

  // ── ISOLAMENTO DE CRASH (requisito crítico) ──
  // Se o renderer de uma partition cair (Flash PPAPI crash, OOM, etc.),
  // apenas ESTA janela é afetada. As outras continuam rodando lisa.
  // Reportamos o crash ao ProfileManager para telemetria e NÃO propagamos.
  win.webContents.on('render-process-gone', function (_e, details) {
    logger.error('game-launcher: render-process-gone em "' + profile.name + '" — reason=' + details.reason + ' exitCode=' + details.exitCode);
    try {
      // Lazy require para evitar dependência circular (manager → game-launcher → manager)
      const manager = require('./profiles/manager');
      manager.reportCrash(profileId);
    } catch (_) { /* ignore circular */ }
    try {
      require('../memory/guard').reportCrash();
    } catch (_) { /* ignore */ }
    // v4.9.2: crash reporter removido — logs ficam no disco via electron-log
  });

  // Janela não-responsiva por >30s não derruba o app — apenas log + notifica.
  win.on('unresponsive', function () {
    logger.warn('game-launcher: janela UNRESPONSIVE — "' + profile.name + '" (outras contas continuam ok)');
  });

  win.on('responsive', function () {
    logger.info('game-launcher: janela RESPONSIVE novamente — "' + profile.name + '"');
  });

  // Navigation handling (v1.x logic)
  win.webContents.on('will-navigate', function (e, url) {
    if (url.startsWith('data:')) return;
    try {
      const parsed = new URL(url);
      const isAsset = parsed.pathname.match(/\.(js|css|png|jpg|jpeg|gif|swf|json|xml|ico|svg|woff2?|mp3|mp4|flv|ogg|wav|webm|ttf|eot|otf|map|dat|bin|zip|gz)$/i);
      const isPage = !isAsset;
      const isGameHost = parsed.hostname.includes('naruto') || parsed.hostname.includes('oasgames');
      if (isGameHost && isPage && !parsed.search.includes('logintype')) {
        e.preventDefault();
        const sep = url.includes('?') ? '&' : '?';
        win.loadURL(url + sep + LAUNCHER_PARAMS);
      }
    } catch (_) { /* ignore */ }
  });

  win.webContents.on('new-window', function (e, url) {
    e.preventDefault();
    if (url.includes('naruto') || url.includes('oasgames')) {
      win.loadURL(url);
    } else {
      try {
        const protocol = new URL(url).protocol;
        if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
      } catch (_) { /* ignore */ }
    }
  });

  // On load: CSS injection + FB mock + AUTO-LOGIN (vault)
  win.webContents.on('did-finish-load', function () {
    // cron-review-8: resetar failLoadRetry em sucesso → failures futuras podem retry de novo
    const entry = gameWindows.get(profileId);
    if (entry) entry.failLoadRetry = false;

    ses.cookies.flushStore().catch(function () {});

    // ── v4.3: INJEÇÃO CSS INTELIGENTE (2 camadas) ──
    // CAMADA 1 (sempre): remove ads, cookie banners, popups — seguro em qualquer página.
    // CAMADA 2 (condicional): se há <embed>/<object> (página de jogo), aplica
    //   fullscreen limpo (background #000, hide header/footer/sidebar, stretch embed).
    //
    // BUG v4.2: a CSS antiga aplicava `background:#000 !important` e
    //   `overflow:hidden !important` em TODAS as páginas — incluindo a página
    //   de /login redirecionada. Isso fazia a página de login parecer "quebrada"
    //   (fundo preto, sem header/footer institucional) → usuário via uma página
    //   estranha e achava que o launcher travou ("so fica parado na pagina").
    //   A CAMADA 2 agora só ativa quando há Flash embed (jogo real), não em login.

    // CAMADA 1: limpeza leve (ads, cookies, popups) — sempre segura
    win.webContents.insertCSS(
      // Anúncios e banners
      '.ad, .ads, .banner, .ad-banner, .ad-container, [class*="advertisement"], [id*="advertisement"] { display: none !important; }' +
      // Popups de cookie/consent (GDPR)
      '.cookie-notice, .cookie-banner, #cookieConsent, .gdpr-banner { display: none !important; }' +
      // Links de suporte externo redundantes
      '.support-link, .help-link, .external-link, .social-share, .share-buttons { display: none !important; }'
    ).catch(function () {});

    // CAMADA 2: fullscreen limpo SOMENTE se há Flash embed (página de jogo)
    win.webContents.executeJavaScript(
      'if (document.querySelector("embed") || document.querySelector("object")) {' +
      '  var s = document.createElement("style");' +
      '  s.textContent = ' +
      '    "html, body { margin:0 !important; padding:0 !important; overflow:hidden !important; width:100% !important; height:100% !important; background:#000 !important; }" +' +
      '    "#oas-bar, .oas-bar, .header, .header-wrap, .site-header, .top-bar, .topbar { display:none !important; height:0 !important; min-height:0 !important; }" +' +
      '    "footer, .footer, .site-footer, .footer-wrap, #footer { display:none !important; height:0 !important; }" +' +
      '    ".sidebar, .left-sidebar, .right-sidebar, .nav-sidebar { display:none !important; }" +' +
      '    "embed, object { width:100vw !important; height:100vh !important; display:block !important; }" +' +
      '    "body > div { height:100vh !important; overflow:hidden !important; background:#000 !important; }";' +
      '  document.head.appendChild(s);' +
      '}'
    ).catch(function () {});

    // Mock FB object (v1.x) — fallback se SDK real não carrega
    win.webContents.executeJavaScript(
      'if (typeof window.FB === "undefined") {' +
      '  window.FB = { init: function(){}, login: function(c){c({status:"unknown"});}, getLoginStatus: function(c){c({status:"unknown"});}, api: function(){}, Event: { subscribe: function(){}, unsubscribe: function(){} }, Canvas: { setAutoGrow: function(){} }, AppEvents: { activateApp: function(){}, logEvent: function(){}, logPageView: function(){}, logPurchase: function(){} }, getUserID: function(){return null;}, getAccessToken: function(){return null;} };' +
      '  window.fbAsyncInit = function(){};' +
      '}'
    ).catch(function () {});

    // v4.1: AUTO-POST BYPASS REMOVIDO (causava loop infinito de redirect).
    // O POST main-process para passport.oasgames.com setava cookie no domain
    // errado (.oasgames.com em vez de .narutowebgame.com) — a página não via o
    // cookie e ficava em loop login → serverlist → login.
    // AGORA: apenas _tryAutoLogin() (form injection) que chama a função da
    // própria página (ajax_login/hd_ajax_login) que faz JSONP GET no domain certo.
    // Ver Sprint 5 worklog + /home/z/my-project/login-html/ANALYSIS.md

    // AUTO-LOGIN via vault (v3.0 inovação) — injeta no form e chama hd_ajax_login/ajax_login
    _tryAutoLogin(profileId, win);
  });

  win.webContents.on('did-fail-load', function (_e, code, desc, url) {
    if (url.startsWith('data:')) return;
    if (code === -3) return; // ERR_ABORTED (navegação cancelada — normal)

    // cron-review-3: retry 1x + fallback amigável em vez de tela preta
    const entry = gameWindows.get(profileId);
    const alreadyRetried = entry && entry.failLoadRetry;

    if (!alreadyRetried) {
      logger.warn('Falha ao carregar (' + profile.name + '): ' + code + ' ' + desc + ' — tentando novamente...');
      if (entry) entry.failLoadRetry = true;
      // Retry único após 1.5s — cron-review-8: timer guardo no entry para cancelar no closed
      if (entry) {
        entry.failLoadTimer = setTimeout(function () {
          entry.failLoadTimer = null;
          if (win && !win.isDestroyed()) {
            win.loadURL(getGameUrl(profile));
          }
        }, 1500);
      }
    } else {
      logger.error('Falha ao carregar (' + profile.name + '): ' + code + ' ' + desc + ' — retry esgotado, exibindo tela de erro');
      // Fallback: tela de erro amigável com botão de retry manual
      const safeDesc = String(desc).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeCode = String(code).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const gameUrl = getGameUrl(profile);
      win.webContents.loadURL('data:text/html,' + encodeURIComponent(
        '<html><head><meta charset="utf-8"></head><body style="background:#0f0f14;color:#fff;display:flex;' +
        'align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;flex-direction:column">' +
        '<div style="font-size:48px;margin-bottom:16px">⚠️</div>' +
        '<h2 style="color:#DC2626">Falha na conexão</h2>' +
        '<p style="color:#8a8a96;margin:10px 0;font-size:13px">Erro: ' + safeDesc + ' (' + safeCode + ')</p>' +
        '<p style="color:#5a5a68;font-size:11px;margin-bottom:20px">Perfil: ' + profile.name + '</p>' +
        '<button onclick="location.href=\'' + gameUrl + '\'" ' +
        'style="padding:10px 24px;background:linear-gradient(135deg,#DC2626,#7a1414);color:#fff;' +
        'border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">' +
        '🔄 Tentar Novamente</button>' +
        '</body></html>'
      ));
    }
  });

  // v3.6.2: KILL SWITCH GRACEFUL — sem re-entrada, sem win.close() dentro de close
  // Remove embeds do Flash primeiro, depois destroy com timeout de fallback
  let _isForceClosing = false;
  win.on('close', function (e) {
    e.preventDefault();
    if (_isForceClosing) return;
    _isForceClosing = true;

    logger.info('Kill switch: fechando ' + profile.name + ' (graceful + fallback destroy)');

    // Cancela timers pendentes
    const entry = gameWindows.get(profileId);
    if (entry) {
      if (entry.autoLoginTimer) clearTimeout(entry.autoLoginTimer);
      if (entry.failLoadTimer) clearTimeout(entry.failLoadTimer);
    }

    // GRACEFUL: remove embeds do Flash para permitir cleanup do PPAPI
    try {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.stop();
        win.webContents.executeJavaScript(
          'document.querySelectorAll("embed,object").forEach(function(e){e.remove();});'
        ).catch(function () { /* ignore */ });
      }
    } catch (_) { /* ignore */ }

    // DESTROY após 500ms — dá tempo do PPAPI limpar, garante zero janela zumbi
    // NÃO chama win.close() (evita re-entrada no handler)
    setTimeout(function () {
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch (_) { /* ignore */ }
    }, 500);
  });

  // v3.5.2: Intercepta Alt+F4 e atalhos de browser no nível webContents
  // v4.9.1: F5 (reload sessão Flash) + F12 (DevTools toggle) adicionados.
  // Bloqueia menus contextuais do Chromium antigo (Alt, F10, etc)
  win.webContents.on('before-input-event', function (event, input) {
    // Alt+F4 → fecha a janela (nosso kill switch trata)
    if (input.alt && input.key === 'F4') {
      event.preventDefault();
      win.close();
      return;
    }
    // F5 → recarrega a página (reload da sessão Flash sem fechar a janela).
    // Resolve o problema de "só conseguia recarregar fechando e abrindo".
    if (input.key === 'F5' && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      logger.info('F5: recarregando sessão Flash para ' + profile.name);
      win.webContents.reload();
      return;
    }
    // F12 → toggle DevTools (liberado pra debug em v4.9.1 a pedido do usuário).
    // Ctrl+Shift+I continua bloqueado (F12 é mais intutivo e não conflita com o jogo).
    if (input.key === 'F12' && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    // Bloqueia F10 (menu bar do Chromium), Alt (menu toggle)
    if (input.key === 'F10' || (input.alt && !input.control && !input.shift && input.key !== 'F4')) {
      event.preventDefault();
      return;
    }
    // Bloqueia Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console) — use F12
    if (input.control && input.shift && (input.key === 'I' || input.key === 'J')) {
      event.preventDefault();
      return;
    }
  });

  // Closed → snapshot cookies (shadow) + cleanup final
  win.on('closed', function () {

    // Cancela timers pendentes (double-check)
    const entry = gameWindows.get(profileId);
    if (entry) {
      if (entry.autoLoginTimer) clearTimeout(entry.autoLoginTimer);
      if (entry.failLoadTimer) clearTimeout(entry.failLoadTimer);
    }

    // v4.8.1: snapshot de cookies agora é feito apenas no ProfileManager
    // (onClosedInternal) — antes era duplicado aqui e lá, gerando 2 log lines.
    gameWindows.delete(profileId);
    // v4.5: notifica UI que a janela fechou
    _sendWindowStatus(profileId, false);
    logger.info('Perfil fechado: ' + profile.name);
    if (onClosed) onClosed();
  });

  // Show + load
  win.once('ready-to-show', function () {
    win.show();
    // v4.5: notifica UI que a janela abriu
    _sendWindowStatus(profileId, true);
    if (onOpened) onOpened();
    setImmediate(function () {
      const url = getGameUrl(profile);
      logger.info('Carregando jogo para "' + profile.name + '": ' + url);
      win.loadURL(url);
    });
  });

  // v4.8: Loading screen — sem emoji (fontconfig quebrado em alguns hosts
  // exibia o glifo 🍥 como caractere inválido → "caracteres" estragados).
  // Usa spinner SVG/CSS (zero dependência de fonte) + fundo idêntico ao da
  // janela (#0f0f14) para transição suave overlay→jogo sem flash preto.
  win.loadURL('data:text/html,' + encodeURIComponent(
    '<html><head><meta charset="utf-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{background:#0f0f14;display:flex;align-items:center;justify-content:center;height:100vh;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;flex-direction:column;color:#FF8C00}' +
    '.spin{width:34px;height:34px;border:3px solid rgba(255,140,0,.18);border-top-color:#FF8C00;' +
    'border-radius:50%;animation:sp 1s linear infinite;margin-bottom:18px}' +
    '@keyframes sp{to{transform:rotate(360deg)}}' +
    '.t{font-size:15px;font-weight:600;letter-spacing:.2px;color:#f0ede6}' +
    '.s{font-size:12px;color:#6a6a78;margin-top:6px}' +
    '</style></head><body>' +
    '<div class="spin"></div>' +
    '<div class="t">Carregando ' + String(profile.name).replace(/</g, '&lt;') + '</div>' +
    '<div class="s">' + (isShadow ? 'Sessão efêmera (shadow)' : 'Sessão isolada por perfil') + '</div>' +
    '</body></html>'
  ));

  // v4.8.1: restore de cookies agora é feito apenas no ProfileManager
  // (antes de launchProfile) — antes era duplicado aqui e lá, gerando 2 log
  // lines e uma corrida (o restore daqui corria contra o loadURL real).
  // O restore do manager dispara mais cedo (antes da criação da janela),
  // dando mais tempo pro setCookie concluir antes do loadURL do jogo.

  gameWindows.set(profileId, {
    window: win,
    partitionName: partName,
    isShadow: isShadow,
    autoLoginTimer: null,    // cron-review-3: guard para cancelar no closed
    failLoadRetry: false,    // cron-review-3: evita retry loop infinito
    failLoadTimer: null,     // cron-review-8: guard para cancelar no closed
    bypassAttempts: 0,       // v4.0.2: loop guard para auto-login bypass
    formInjectAttempts: 0,   // v4.0.2: loop guard para form injection
  });
}

// v4.1 (Sprint 5): _tryAutoPostBypass REMOVIDO completamente.
// O POST main-process para passport.oasgames.com setava cookie no domain errado
// (.oasgames.com em vez de .narutowebgame.com) — a página não via o cookie e
// ficava em loop infinito login → serverlist → login.
// A análise REAL do HTML das 8 regiões mostrou que o login da página usa JSONP
// GET (não POST) e grava cookie em .narutowebgame.com. A função _tryAutoLogin()
// abaixo já chama a função da própria página (hd_ajax_login/ajax_login) que faz
// tudo corretamente. Ver /home/z/my-project/login-html/ANALYSIS.md + Sprint 5
// worklog. Para histórico do código removido, ver git blame deste arquivo.

function _tryAutoLogin(profileId, win) {
  if (!vault.hasCredentials(profileId)) return;
  if (!win || win.isDestroyed()) return;

  // v4.0.2 LOOP GUARD: max 5 tentativas de form injection por perfil por sessão.
  // O MutationObserver interno já faz retry, mas se a página fica em loop de
  // redirect (login → serverlist → login), did-finish-load dispara repetidamente.
  // v4.4 FIX: só conta como tentativa quando o form foi encontrado (result='filled'
  // ou 'clicked'). Páginas sem form (serverlist com cookie, loading, etc.) não
  // contam — antes, 5 navegações sem form esgotavam o counter sem nunca tentar.
  // Resetamos o counter quando o auto-login sucede (result='filled'/'clicked').
  const entry = gameWindows.get(profileId);
  if (entry) {
    if (entry.formInjectAttempts > 5) {
      logger.debug('Auto-login form: max attempts atingido para ' + profileId + ' — parando (possível loop de redirect)');
      return;
    }
  }

  const creds = vault.getCredentials(profileId);
  if (!creds || !creds.user || !creds.pass) return;

  const script = vault.buildAutoLoginScript(creds.user, creds.pass);
  win.webContents.executeJavaScript(script).then(function (result) {
    // v4.4: granular logging por tipo de resultado
    // v4.5: todos os estados são propagados via _sendAutoLoginResult para a UI
    if (result === 'filled') {
      logger.info('Auto-login: credenciais injetadas + login chamado para ' + profileId);
      // v4.4 FIX: Reset counter on success — future page navigations can auto-login again.
      // Only actual failed attempts (not pages without forms) should count toward the limit.
      if (entry) entry.formInjectAttempts = 0;
      _sendAutoLoginResult(profileId, 'filled');
    } else if (result === 'clicked') {
      logger.info('Auto-login: botão fallback clicado para ' + profileId);
      // Reset counter on success
      if (entry) entry.formInjectAttempts = 0;
      _sendAutoLoginResult(profileId, 'clicked');
    } else if (result === 'waiting') {
      logger.info('Auto-login: MutationObserver aguardando form para ' + profileId);
      _sendAutoLoginResult(profileId, 'waiting');
    } else if (result === 'not-found') {
      logger.debug('Auto-login: form não encontrado (página sem login) para ' + profileId);
      _sendAutoLoginResult(profileId, 'not-found');
    } else if (typeof result === 'string' && result.indexOf('error:') === 0) {
      logger.warn('Auto-login: erro no script para ' + profileId + ' — ' + result);
      _sendAutoLoginResult(profileId, 'error');
    } else {
      logger.debug('Auto-login: resultado inesperado para ' + profileId + ' — ' + result);
    }
  }).catch(function (e) {
    logger.debug('Auto-login falhou (ok se já logado por cookie): ' + e.message);
  });
}

/**
 * Send auto-login result IPC to the manager window for UI feedback.
 * v4.4: allows the launcher UI to show a toast when auto-login succeeds or fails.
 * v4.5: also sends intermediate states (waiting, not-found) for real-time status badge.
 * @param {string} profileId
 * @param {string} result - 'filled', 'clicked', 'waiting', 'not-found', or 'error'
 */
function _sendAutoLoginResult(profileId, result) {
  try {
    const ctrl = require('./controller');
    const mgrWin = ctrl.getManagerWindow();
    if (mgrWin && !mgrWin.isDestroyed()) {
      mgrWin.webContents.send('auto-login:result', { profileId: profileId, result: result });
      // v4.5: also send as status for the live badge on the card
      // Map result to a UI-friendly status: filled/clicked → success, waiting → loading,
      // not-found → idle, error → error
      var status;
      if (result === 'filled' || result === 'clicked') status = 'success';
      else if (result === 'waiting') status = 'loading';
      else if (result === 'error') status = 'error';
      else status = 'idle';
      mgrWin.webContents.send('auto-login:status', { profileId: profileId, status: status, result: result });
    }
  } catch (_) { /* ignore if controller not available */ }
}

/**
 * v4.5: Send game window open/close status to the manager window.
 * Allows the UI to show a live "aberta" badge on cards whose game window is open.
 * @param {string} profileId
 * @param {boolean} isOpen
 */
function _sendWindowStatus(profileId, isOpen) {
  try {
    const ctrl = require('./controller');
    const mgrWin = ctrl.getManagerWindow();
    if (mgrWin && !mgrWin.isDestroyed()) {
      mgrWin.webContents.send('game-window:status', { profileId: profileId, open: isOpen });
    }
  } catch (_) { /* ignore if controller not available */ }
}

function focusProfile(profileId) {
  if (!gameWindows.has(profileId)) return;
  const entry = gameWindows.get(profileId);
  if (entry.window && !entry.window.isDestroyed()) {
    entry.window.show();
    entry.window.focus();
  }
}

function closeProfile(profileId) {
  if (!gameWindows.has(profileId)) return;
  const entry = gameWindows.get(profileId);
  if (entry.window && !entry.window.isDestroyed()) entry.window.close();
}

/**
 * Verifica se um perfil tem janela aberta (e não destruída).
 * @param {string} profileId
 * @returns {boolean}
 */
function isProfileOpen(profileId) {
  if (!gameWindows.has(profileId)) return false;
  const entry = gameWindows.get(profileId);
  return !!(entry && entry.window && !entry.window.isDestroyed());
}

/**
 * Retorna o webContents de uma janela aberta, ou null.
 * Usado pelo ProfileManager para registrar no MemoryGuard (injeção de window.gc()).
 * @param {string} profileId
 * @returns {Electron.WebContents|null}
 */
function getWebContents(profileId) {
  if (!gameWindows.has(profileId)) return null;
  const entry = gameWindows.get(profileId);
  if (!entry || !entry.window || entry.window.isDestroyed()) return null;
  return entry.window.webContents;
}

module.exports = {
  launchProfile: launchProfile,
  focusProfile: focusProfile,
  closeProfile: closeProfile,
  isProfileOpen: isProfileOpen,
  getWebContents: getWebContents,
  hasOpenWindows: hasOpenWindows,
  getGameUrl: getGameUrl,
};
