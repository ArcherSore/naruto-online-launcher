/**
 * app/SessionLifecycle.js — Hooks de lifecycle da janela de jogo (Fase 3d split)
 *
 * Responsabilidade ÚNICA (SRP): anexar handlers de evento (did-finish-load,
 * did-fail-load, render-process-gone, unresponsive, will-navigate, new-window,
 * close, closed, ready-to-show) a uma BrowserWindow de jogo. Inclui CSS
 * injection, FB mock, e auto-login via vault.
 *
 * Histórico: era inline no God Object game-launcher.js (620 linhas). Extraído
 * para isolar o lifecycle do launch/orchestration.
 */

'use strict';

const logger = require('../utils/logger');
const vault = require('../profiles/vault');
const ManagerWindow = require('../ui/manager/ManagerWindow');

/**
 * Carrega a página do jogo com pré-autenticação via API quando possível.
 * Se o perfil tem credenciais no vault, chama apiLogin.loginAndInject() ANTES
 * de loadURL — assim o cookie oas_user já está setado e o servidor redireciona
 * direto pro jogo, sem mostrar a tela de login do Naruto Online.
 * Fallback: se API login falha, carrega a URL normalmente (form-injection auto-login
 * via MutationObserver cuida do login depois).
 */
function _loadGameWithPreAuth(profileId, profile, win, ses, getGameUrl) {
  var url = getGameUrl(profile);

  if (vault.hasCredentials(profileId)) {
    var creds = vault.getCredentials(profileId);
    if (creds && creds.user && creds.pass) {
      var apiLogin = require('../network/api-login');
      logger.info('Login direto via API para "' + profile.name + '" (cookie pré-injetado)');
      apiLogin
        .loginAndInject(ses, creds.user, creds.pass)
        .then(function () {
          if (win.isDestroyed()) return;
          win.loadURL(url);
        })
        .catch(function (e) {
          if (win.isDestroyed()) return;
          logger.warn(
            'Login via API falhou para "' + profile.name + '" — fallback form-injection: ' + e.message
          );
          win.loadURL(url);
        });
      return;
    }
  }

  logger.info('Carregando jogo para "' + profile.name + '": ' + url);
  win.loadURL(url);
}

/**
 * Envia resultado do auto-login ao manager window (UI feedback).
 * @param {string} profileId
 * @param {string} result - 'filled'|'clicked'|'waiting'|'not-found'|'error'
 */
function _sendAutoLoginResult(profileId, result) {
  var status;
  if (result === 'filled' || result === 'clicked') status = 'success';
  else if (result === 'waiting') status = 'loading';
  else if (result === 'error') status = 'error';
  else status = 'idle';
  ManagerWindow.send('auto-login:result', { profileId: profileId, result: result });
  ManagerWindow.send('auto-login:status', { profileId: profileId, status: status, result: result });
}

/**
 * Envia status de janela aberta/fechada ao manager window.
 * @param {string} profileId
 * @param {boolean} isOpen
 */
function _sendWindowStatus(profileId, isOpen) {
  ManagerWindow.send('game-window:status', { profileId: profileId, open: isOpen });
}

/**
 * Tenta auto-login injetando credenciais do vault no form da página.
 * Loop guard: max 5 tentativas de form injection por sessão.
 * @param {string} profileId
 * @param {Electron.BrowserWindow} win
 * @param {Object} entry - entrada do gameWindows Map (mutada para tracking)
 */
function _tryAutoLogin(profileId, win, entry) {
  if (!vault.hasCredentials(profileId)) return;
  if (!win || win.isDestroyed()) return;

  if (entry) {
    if (entry.formInjectAttempts > 5) {
      logger.debug(
        'Auto-login form: max attempts atingido para ' +
          profileId +
          ' — parando (possível loop de redirect)'
      );
      return;
    }
  }

  const creds = vault.getCredentials(profileId);
  if (!creds || !creds.user || !creds.pass) return;

  const script = vault.buildAutoLoginScript(creds.user, creds.pass);
  win.webContents
    .executeJavaScript(script)
    .then(function (result) {
      if (result === 'filled') {
        logger.info('Auto-login: credenciais injetadas + login chamado para ' + profileId);
        if (entry) entry.formInjectAttempts = 0;
        _sendAutoLoginResult(profileId, 'filled');
      } else if (result === 'clicked') {
        logger.info('Auto-login: botão fallback clicado para ' + profileId);
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
    })
    .catch(function (e) {
      logger.debug('Auto-login falhou (ok se já logado por cookie): ' + e.message);
    });
}

/**
 * Anexa todos os handlers de lifecycle a uma janela de jogo.
 * @param {Electron.BrowserWindow} win
 * @param {Object} ctx - { profileId, profile, entry, ses, onOpened, onClosed, getGameUrl, LAUNCHER_PARAMS }
 */
function attach(win, ctx) {
  const profileId = ctx.profileId;
  const profile = ctx.profile;
  const entry = ctx.entry;
  const ses = ctx.ses;
  const onOpened = ctx.onOpened;
  const onClosed = ctx.onClosed;
  const getGameUrl = ctx.getGameUrl;
  const LAUNCHER_PARAMS = ctx.LAUNCHER_PARAMS;

  // ── ISOLAMENTO DE CRASH + AUTO-RECOVERY ──
  // Backoff: max 3 auto-reloads em 10 min por perfil (evita crash loop).
  var _crashTimestamps = [];
  win.webContents.on('render-process-gone', function (_e, details) {
    logger.error(
      'SessionLifecycle: render-process-gone em "' +
        profile.name +
        '" — reason=' +
        details.reason +
        ' exitCode=' +
        details.exitCode
    );
    try {
      const manager = require('../profiles/manager');
      manager.reportCrash(profileId);
    } catch (_) {
      /* ignore circular */
    }
    try {
      require('../memory/guard').reportCrash();
    } catch (_) {
      /* ignore */
    }

    // Auto-recovery: reload se webContents ainda válido e dentro do backoff.
    // Causas recuperáveis: oom, crashed, abnormal-exit (não recupera 'clean-exit').
    if (win.isDestroyed()) return;
    if (win.webContents.isDestroyed()) return;
    var reason = details && details.reason;
    if (reason === 'clean-exit' || reason === 'killed') return;

    var now = Date.now();
    _crashTimestamps = _crashTimestamps.filter(function (ts) {
      return now - ts < 600000;
    }); // janela de 10 min
    if (_crashTimestamps.length >= 3) {
      logger.error(
        'SessionLifecycle: crash limit atingido para "' + profile.name + '" — não recarrega (loop)'
      );
      return;
    }
    _crashTimestamps.push(now);
    logger.info('SessionLifecycle: auto-reload em 1.5s para "' + profile.name + '"');
    setTimeout(function () {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      try {
        win.webContents.reload();
      } catch (e) {
        logger.warn('SessionLifecycle: reload falhou para "' + profile.name + '": ' + e.message);
      }
    }, 1500);
  });

  win.on('unresponsive', function () {
    logger.warn(
      'SessionLifecycle: janela UNRESPONSIVE — "' + profile.name + '" (outras contas continuam ok)'
    );
  });
  win.on('responsive', function () {
    logger.info('SessionLifecycle: janela RESPONSIVE novamente — "' + profile.name + '"');
  });

  // ── Navigation handling ──
  win.webContents.on('will-navigate', function (e, url) {
    if (url.startsWith('data:')) return;
    try {
      const parsed = new URL(url);
      const isAsset = parsed.pathname.match(
        /\.(js|css|png|jpg|jpeg|gif|swf|json|xml|ico|svg|woff2?|mp3|mp4|flv|ogg|wav|webm|ttf|eot|otf|map|dat|bin|zip|gz)$/i
      );
      const isPage = !isAsset;
      const isGameHost = parsed.hostname.includes('naruto') || parsed.hostname.includes('oasgames');
      if (isGameHost && isPage && !parsed.search.includes('logintype')) {
        e.preventDefault();
        const sep = url.includes('?') ? '&' : '?';
        win.loadURL(url + sep + LAUNCHER_PARAMS);
      }
    } catch (_) {
      /* ignore */
    }
  });

  win.webContents.on('new-window', function (e, url) {
    e.preventDefault();
    if (url.includes('naruto') || url.includes('oasgames')) {
      win.loadURL(url);
    } else {
      try {
        const protocol = new URL(url).protocol;
        if (protocol === 'http:' || protocol === 'https:') {
          const { shell } = require('electron');
          shell.openExternal(url);
        }
      } catch (_) {
        /* ignore */
      }
    }
  });

  // ── On load: CSS injection + FB mock + AUTO-LOGIN ──
  win.webContents.on('did-finish-load', function () {
    if (entry) entry.failLoadRetry = false;
    ses.cookies.flushStore().catch(function () {});

    // CAMADA 1: limpeza leve (ads, cookies, popups)
    win.webContents
      .insertCSS(
        '.ad, .ads, .banner, .ad-banner, .ad-container, [class*="advertisement"], [id*="advertisement"] { display: none !important; }' +
          '.cookie-notice, .cookie-banner, #cookieConsent, .gdpr-banner { display: none !important; }' +
          '.support-link, .help-link, .external-link, .social-share, .share-buttons { display: none !important; }'
      )
      .catch(function () {});

    // CAMADA 2: fullscreen limpo SOMENTE se há Flash embed (página de jogo)
    win.webContents
      .executeJavaScript(
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
      )
      .catch(function () {});

    // Mock FB object — fallback se SDK real não carrega
    win.webContents
      .executeJavaScript(
        'if (typeof window.FB === "undefined") {' +
          '  window.FB = { init: function(){}, login: function(c){c({status:"unknown"});}, getLoginStatus: function(c){c({status:"unknown"});}, api: function(){}, Event: { subscribe: function(){}, unsubscribe: function(){} }, Canvas: { setAutoGrow: function(){} }, AppEvents: { activateApp: function(){}, logEvent: function(){}, logPageView: function(){}, logPurchase: function(){} }, getUserID: function(){return null;}, getAccessToken: function(){return null;} };' +
          '  window.fbAsyncInit = function(){};' +
          '}'
      )
      .catch(function () {});

    _tryAutoLogin(profileId, win, entry);
  });

  // ── did-fail-load: retry 1x + tela de erro amigável ──
  win.webContents.on('did-fail-load', function (_e, code, desc, url) {
    if (url.startsWith('data:')) return;
    if (code === -3) return; // ERR_ABORTED

    const alreadyRetried = entry && entry.failLoadRetry;
    if (!alreadyRetried) {
      logger.warn(
        'Falha ao carregar (' +
          profile.name +
          '): ' +
          code +
          ' ' +
          desc +
          ' — tentando novamente...'
      );
      if (entry) entry.failLoadRetry = true;
      if (entry) {
        entry.failLoadTimer = setTimeout(function () {
          entry.failLoadTimer = null;
          if (win && !win.isDestroyed()) {
            win.loadURL(getGameUrl(profile));
          }
        }, 1500);
      }
    } else {
      logger.error(
        'Falha ao carregar (' +
          profile.name +
          '): ' +
          code +
          ' ' +
          desc +
          ' — retry esgotado, exibindo tela de erro'
      );
      const safeDesc = String(desc)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const safeCode = String(code)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const gameUrl = getGameUrl(profile);
      win.webContents.loadURL(
        'data:text/html,' +
          encodeURIComponent(
            '<html><head><meta charset="utf-8"></head><body style="background:#0f0f14;color:#fff;display:flex;' +
              'align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;flex-direction:column">' +
              '<div style="font-size:48px;margin-bottom:16px">⚠️</div>' +
              '<h2 style="color:#DC2626">Falha na conexão</h2>' +
              '<p style="color:#8a8a96;margin:10px 0;font-size:13px">Erro: ' +
              safeDesc +
              ' (' +
              safeCode +
              ')</p>' +
              '<p style="color:#5a5a68;font-size:11px;margin-bottom:20px">Perfil: ' +
              profile.name +
              '</p>' +
              '<button onclick="location.href=\'' +
              gameUrl +
              '\'" ' +
              'style="padding:10px 24px;background:linear-gradient(135deg,#DC2626,#7a1414);color:#fff;' +
              'border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">' +
              '🔄 Tentar Novamente</button>' +
              '</body></html>'
          )
      );
    }
  });

  // ── KILL SWITCH GRACEFUL ──
  let _isForceClosing = false;
  let _renewTimer = null;
  win.on('close', function (e) {
    e.preventDefault();
    if (_isForceClosing) return;
    _isForceClosing = true;

    logger.info('Kill switch: fechando ' + profile.name + ' (graceful + fallback destroy)');

    if (entry) {
      if (entry.autoLoginTimer) clearTimeout(entry.autoLoginTimer);
      if (entry.failLoadTimer) clearTimeout(entry.failLoadTimer);
    }
    // JWT auto-renewal interval cleanup
    if (_renewTimer) {
      clearInterval(_renewTimer);
      _renewTimer = null;
    }

    try {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.stop();
        win.webContents
          .executeJavaScript(
            'document.querySelectorAll("embed,object").forEach(function(e){e.remove();});'
          )
          .catch(function () {
            /* ignore */
          });
      }
    } catch (_) {
      /* ignore */
    }

    setTimeout(function () {
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch (_) {
        /* ignore */
      }
    }, 500);
  });

  // ── Closed → cleanup final ──
  win.on('closed', function () {
    if (entry) {
      if (entry.autoLoginTimer) clearTimeout(entry.autoLoginTimer);
      if (entry.failLoadTimer) clearTimeout(entry.failLoadTimer);
    }
    // gameWindows.delete é responsabilidade do Launcher (que possui o Map)
    _sendWindowStatus(profileId, false);
    logger.info('Perfil fechado: ' + profile.name);
    if (onClosed) onClosed();
  });

  // ── ready-to-show: show + load game URL ──
  win.once('ready-to-show', function () {
    win.show();
    _sendWindowStatus(profileId, true);
    if (onOpened) onOpened();
    setImmediate(function () {
      _loadGameWithPreAuth(profileId, profile, win, ses, getGameUrl);
    });
  });

  // ── JWT auto-renewal (pendência herdada, Fase 3g) ──
  // A cada 30 min, se o perfil tem credenciais no vault, checa se o JWT está
  // próximo de expirar (threshold 5 min) e renova via api-login. O JWT do
  // Naruto Online expira em 2h; sem renovação, a sessão cai e o auto-login
  // via form injection reassume — mas renovar evita essa interrupção.
  _renewTimer = setInterval(
    function () {
      if (win.isDestroyed()) {
        if (_renewTimer) {
          clearInterval(_renewTimer);
          _renewTimer = null;
        }
        return;
      }
      if (!vault.hasCredentials(profileId)) return; // sem creds → não pode renovar
      const creds = vault.getCredentials(profileId);
      if (!creds || !creds.user || !creds.pass) return;
      try {
        const apiLogin = require('../network/api-login');
        apiLogin
          .renewIfNeeded(ses, creds.user, creds.pass, 300)
          .then(function (r) {
            if (r.renewed) {
              logger.info(
                'JWT auto-renovado para "' +
                  profile.name +
                  '" (novo expira em ' +
                  Math.round(r.expiresAt / 1000 - Date.now() / 1000) +
                  's)'
              );
            }
          })
          .catch(function (e) {
            logger.debug('JWT auto-renewal falhou para ' + profileId + ': ' + e.message);
          });
      } catch (e) {
        logger.debug('JWT auto-renewal skip: ' + e.message);
      }
    },
    30 * 60 * 1000
  ); // 30 min
  if (_renewTimer.unref) _renewTimer.unref();
}

module.exports = {
  attach: attach,
  // expostos p/ testes
  _sendWindowStatus: _sendWindowStatus,
  _sendAutoLoginResult: _sendAutoLoginResult
};
