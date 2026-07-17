# Changelog

## [5.9.11] - 2026-07-17

### Added — StallDetector: auto-F5 quando SWF essencial falha (login trava em 14%)
- **Problema reportado pelo user**: "seria interessante um auto f5 quando um
  sfw essencial nao baixar, pq acontece as vezes do login travar em 14% e dar
  erro de conexao". O preloader do Flash NÃO tem retry — quando um SWF falha
  no download (network hiccup, timeout, Mixed Content), o loader fica preso
  forever naquela porcentagem. O usuário precisa fechar e reabrir manualmente.
- **Solução**: novo módulo `src/app/StallDetector.js` que monitora a session
  via `webRequest.onCompleted` + `onErrorOccurred`. Quando detecta:
  - **(A) Burst de falhas SWF**: 2+ SWFs falhando em 60s → servidor instável →
    trigger auto-reload
  - **(B) Inatividade de rede**: 45s sem nenhuma atividade durante o loading →
    loader travado → trigger auto-reload
  - O auto-reload usa `reloadWithPreAuth` (mesmo fluxo do F5 v5.9.7: limpa
    cookies + pré-autentica via API antes de reload → tela de login não
    aparece, email não fica visível)
- **Backoff**: max 3 auto-reloads em 10 min por perfil (evita loop infinito
  se o servidor estiver realmente fora do ar). Após 3 tentativas, desiste.
- **Auto-stop**: após 120s de atividade contínua sem stall, considera o jogo
  "pronto" e encerra o monitoramento (o jogo está rodando, inatividade é normal).
- **Integração**: `SessionLifecycle.attach` agora cria o StallDetector em
  `did-finish-load` (após CSS injection + auto-login) e faz cleanup em `close`.
- **Cobertura de testes**: 19 novos testes em `src/app/__tests__/StallDetector.test.js`
  cobrindo: SWF burst detection, inactivity stall, backoff, ready detection,
  detach idempotente, win destroyed auto-cleanup, callback error handling.
- **Nota técnica**: `did-fail-load` (já existente) cuida de erros da página
  HTML principal. StallDetector cuida de falhas de SUB-RECURSOS (SWFs dentro
  do Flash player) que `did-fail-load` não detecta. Usa `onCompleted` +
  `onErrorOccurred` (eventos não usados por blocker nem inspector → sem
  conflito de listeners).

## [5.9.10] - 2026-07-17

### Added — Inspector path signatures (classificação por nome de arquivo)
- **Contexto**: análise de logs F12 do jogo rodando revelou 3 endpoints do
  fluxo de login que não eram classificados pelo inspector:
  - `ScriptLoginManager-1.2.php?param=...&md5=...` (2 chamadas, ~500ms total)
  - `Scriptpad-zeropadding.js` (~109ms, library de crypto padding)
  - `query_svr_info.fcgi?svr_id=842` (~110ms, XHR que busca info do servidor)
- **Mudança**: `inspector.js` agora tem `KNOWN_PATH_SIGNATURES` (array de
  regex) além de `KNOWN_ENDPOINTS` (hostname). A função `classify()` checa
  path signatures PRIMEIRO (mais específico) antes do hostname. Novos tipos
  classificados:
  - `ScriptLoginManager` → type `auth`, label "ScriptLoginManager (login form JS)"
  - `Scriptpad-zeropadding` → type `auth`, label "Scriptpad zeropadding (login crypto)"
  - `query_svr_info.fcgi` → type `game`, label "Server info query (svr_id)"
  - `oss_report.fcgi` → type `telemetry`, label "iMSDK telemetry (BLOCKED)"
  - `crossdomain.xml` → type `telemetry`, label "Flash policy (BLOCKED)"
- **Novo tipo `telemetry`** adicionado ao stats `byType` (era ausente antes).
- `KNOWN_PATH_SIGNATURES` exportado no `module.exports` para testes.
- **Benefício**: quando SHINOBI_DEBUG=1 está ativo, o log do inspector agora
  distingue claramente login flow vs game API vs telemetry, facilitando
  diagnosticar problemas de login e planejar o bot auto-play (Task 226).

### Analysis — F12 logs do fluxo de login (sem bugs encontrados)
- Logs F12 do user analisados: 227 requests, 19.1 MB transferidos.
- **ScriptLoginManager-1.2.php** carrega mesmo com pre-auth via API (cookie
  oas_user). NÃO é bug — a página do jogo inclui esse script para validação
  de sessão. Com o cookie presente, o script detecta a sessão ativa e não
  exibe o form de login. Bloquear seria arriscado (poderia quebrar a
  detecção de sessão do JS do jogo).
- **query_svr_info.fcgi?svr_id=842** é uma chamada legítima do jogo (busca
  info do servidor). Candidato para cache futuro (5-10 min), mas requer
  interceptação de response body via protocol.interceptBufferProtocol —
  deixado como otimização futura de baixa prioridade (~110ms savings).
- **Scriptpad-zeropadding.js** é uma library de crypto padding usada pelo
  form de login. Com pre-auth, é carregada mas não usada. Bloquear é
  arriscado (dependência JS do jogo). Deixado como está.
- **Preload fix (v5.9.9) confirmado**: preload.js expõe
  `{ enabled: DEBUG, isDebug: function }` em vez de boolean direto.
  O crash `TypeError: Error processing argument at index 1` está resolvido.

## [5.9.9] - 2026-07-17

### Fixed — Preload crash (TypeError em exposeInMainWorld)
- **Sintoma**: log F12 mostrava `Unable to load preload script` + `TypeError:
  Error processing argument at index 1, conversion failure from` em
  `contextBridge.exposeInMainWorld`. Consequência: preload crashava INTEIRO →
  `window.__SHINOBI_DEBUG__` E `window.narutoLauncher` ficavam undefined →
  Dev Tools section nunca aparecia (mesmo com SHINOBI_DEBUG=1) + qualquer
  bridge IPC futuro do bot quebraria.
- **Causa raiz**: Electron 11 **não aceita primitivos** (boolean/string/
  number) no 2º argumento de `exposeInMainWorld` — só object/function/null.
  `exposeInMainWorld('__SHINOBI_DEBUG__', DEBUG)` passava boolean direto.
- **Correção**: preload agora expõe `{ enabled: DEBUG, isDebug: function }`.
  `app.js` `isDebugActive()` adaptado para ler `.enabled` (com fallback para
  boolean direto, mantendo compat com builds antigas em cache).

### Fixed — Mixed Content (Flash insecure plugin data)
- **Sintoma**: log F12 mostrava `Mixed Content: The page at '<URL>' was loaded
  over HTTPS, but requested an insecure plugin data '<URL>'`. Recorrente.
- **Causa raiz**: o jogo é servido via HTTPS, mas o plugin Flash PPAPI carrega
  sub-recursos (assets, sons, crossdomain.xml) via HTTP internamente. Chromium
  bloqueia "insecure plugin data" em páginas HTTPS por default.
- **Correção**: `flags.js` agora adiciona `--allow-running-insecure-content` +
  `--allow-arbitrary-server-certificate-error`. Não afeta o resto da página
  (que continua com CSP restritivo) — só autoriza conteúdo inseguro DENTRO do
  plugin Flash, que é necessário pro jogo funcionar.

### Added — Blocker path patterns (telemetria no mesmo host do jogo)
- **Problema**: F12 mostrava `oss_report.fcgi?uin=...&role_id=...&svr_id=...`
  rodando em `naruto-pl.oasgames.com` (MESMO host do jogo). Bloquear o domínio
  quebraria o jogo. Resultado: telemetria iMSDK da Tencent vazando server_id +
  role_id + uin silenciosamente.
- **Correção**: `blocker.js` agora suporta `BLOCKED_PATH_PATTERNS` (regex) além
  de `BLOCKED_DOMAINS`. Novos patterns:
  - `/oss_report.fcgi` — corta telemetria iMSDK sem quebrar o jogo
  - `/crossdomain.xml$` — Flash Security Policy sempre falha (404/timeout ~700ms),
    só gera ruído no console. Bloquear silencia o ruído e poupa os timeouts.
- Log do blocker agora informa `"X domínios + Y path patterns"`.

## [5.9.8] - 2026-07-15

### Fixed — Fullscreen CSS inconsistente (top bar sumia/aparecia aleatoriamente)
- **Sintoma**: ao abrir o jogo, a top bar do site (header/footer/sidebars do
  Naruto Online) às vezes sumia ("tela cheia") e às vezes ficava visível —
  comportamento inconsistente entre sessões e sub-navegações.
- **Causa raiz**: a "CAMADA 2: fullscreen limpo" em `SessionLifecycle.js`
  fazia um check ÚNICO no `did-finish-load`: `if (#oas-player existe) injeta CSS`.
  Mas o Naruto Online carrega o embed `#oas-player` ASYNC via JS — no momento
  do `did-finish-load` ele geralmente ainda NÃO está no DOM, então o CSS não
  injetava. Só injetava em sub-navegações onde `#oas-player` já existia no
  momento do evento → comportamento não-determinístico.
- **Correção**: CAMADA 2 agora usa `MutationObserver` + polling fallback (mesmo
  padrão robusto já usado pelo auto-login em `ProfileVault.buildAutoLoginScript`).
  Assim que `#oas-player` aparece no DOM (síncrono ou async), o CSS é injetado
  de forma confiável. Guards `__shinobiFsInjected`/`__shinobiFsApplied` evitam
  dupla injeção. Log agora registra `"applied"` ou `"aguardando #oas-player"`.

### Added — F5 auto-re-login (v5.9.7, não documentado)
- `SessionLifecycle.reloadWithPreAuth()`: F5 agora limpa cookies/storage/cache
  da partition E pré-autentica via `apiLogin.loginAndInject()` ANTES de
  recarregar (igual ao botão Play) → a tela de login do Naruto Online não
  aparece, email não fica visível. `KeyboardShortcuts.attach` aceita callback
  `onClearLogin` que delega ao Launcher.

## [5.0.0] - 2026-07-14

### Changed — Refatoração SOLID + Clean Code (Fase 3, Decisão C)
Mudança arquitetural MAJOR: os 4 God Objects foram splitados em módulos com
Responsabilidade Única (SRP). Cada God Object virou uma facade fina que
compõe os novos módulos — a API pública é preservada (callers não mudam).

- **guard.js (436 linhas)** → `MemoryGuard.js` (monitor RSS + registry de
  webviews) + `GcDaemon.js` (daemon periódico + collect).
- **vault.js (571 linhas)** → `CryptoService.js` (AES-256-GCM + PBKDF2 puras)
  + `PasswordManager.js` (chave de máquina + senha mestre) + `ProfileVault.js`
  (CRUD + auto-login script).
- **controller.js (648 linhas)** → `manager/ManagerWindow.js` (lifecycle da
  BrowserWindow) + `manager/IpcRouter.js` (handlers IPC) + `manager/StateBroadcaster.js`
  (push de estado pra UI).
- **game-launcher.js (620 linhas)** → `app/Launcher.js` (orchestration +
  registry) + `app/SessionLifecycle.js` (hooks de evento + auto-login) +
  `ui/manager/KeyboardShortcuts.js` (F5/F12/Alt+F4).

### Fixed — GC black screen (pendência herdada, Fase 3f)
- **MemoryGuard causava tela preta no jogo**: `collect()` chamava
  `clearCache()` + `clearStorageData({cachestorage,shadercache})` em TODAS as
  partitions de perfil, incluindo as com jogo Flash ATIVO. Limpar
  shadercache/cachestorage mid-session força recompilação de GPU shaders e
  disrupta carregamento de recursos do Flash PPAPI → canvas preto.
- **Correção**: GcDaemon agora pula partitions com jogo ativo (consulta
  `MemoryGuard.getActiveProfileIds()`) e removeu `shadercache` do
  clearStorageData. `process.gc(true)` no main continua (seguro).

### Added — SHINOBI_DEBUG feature flag (Fase 3b, Decisão B)
- `src/main/debug.js`: flag boot-time de `process.env.SHINOBI_DEBUG`.
- preload expõe `window.__SHINOBI_DEBUG__` (boolean) + `narutoLauncher.isDebug()`.
- logger sobe console level pra `debug` quando flag ativa.
- UI: seção Dev Tools em Configurações fica **hidden por padrão**. Ativação:
  env var `SHINOBI_DEBUG=1` OU segurar **Ctrl+Shift+D por 2s** (toggle localStorage).
- Zero overhead quando desativado (código debug envolto em `if (DEBUG)`).

### Added — Pendências herdadas resolvidas (Fase 3g)
- **JWT auto-renewal**: `SessionLifecycle` inicia `setInterval(30min)` que
  renova o JWT via `apiLogin.renewIfNeeded()` se o perfil tem creds no vault
  (JWT do Naruto Online expira em 2h). Interval com `unref()` + cleanup no close.
- **tempmail auto-create profile**: `tempmail:create` agora cria
  automaticamente um Profile + guarda creds no vault após criar a conta
  (antes o usuário tinha que criar o perfil manualmente).
- **F5 reload + DevTools (F12)**: já existiam desde v4.9.1, preservados no
  `KeyboardShortcuts` (extraídos do game-launcher, não adicionados).

### Tests
- 153 testes (era 81): +19 FlashUpdater, +17 GcDaemon/MemoryGuard/guard-facade,
  +19 CryptoService, +12 KeyboardShortcuts, +5 debug.

---

## [4.9.3] - 2026-07-14

### Added — Flash PPAPI on-demand (Fase 2 da migração v5.0 — Decisão A)
- **`src/app/FlashUpdater.js`** — baixa sempre a versão MAIS RECENTE do Clean Flash PPAPI (darktohka/clean-flash-builds) via GitHub API, extrai e cacheia em `userData/flash-cache/`. Suporte Linux (`tar -xJf`) e Windows (`innoextract`|`7z`).
- **Boot flow first-run**: se `findFlashPlugin()` não acha binário (nem bundled nem em cache), abre uma loading window, baixa o Flash com progresso %, e **relança o app** — o segundo boot acha o cache e aplica `ppapi-flash-path` antes de `app.ready` (requirement do Electron 11 PPAPI).
- **Refresh semanal em background** (non-blocking): se o cache tem >7 dias, re-download para o PRÓXIMO boot (sem relaunch).
- **`findFlashPlugin()`** agora procura também em `userData/flash-cache/` (além de resources/exe/appPath/cwd/dev).
- **`loading.html`** reformulada com barra de progresso real (download %, fase extract, estado done/erro) via `window.setProgress()`.
- 19 testes unitários para FlashUpdater (pickAsset, cache queries, isCacheStale).

### Changed — Limpeza mecânica + consolidação de pastas (Fase 1 da migração v5.0)
- **Consolidação de pastas** rumo à Clean Architecture (Seção 4 do MIGRATION_PROMPT):
  - `src/utilities/event-timers.js` → `src/utils/EventTimers.js` (PascalCase, merge em `utils/`).
  - `src/ui-manager/` → `src/ui/` (merge com `src/ui/`); `setup.html` agora em `src/ui/setup/setup.html`.
  - `src/window/loading.html` → `src/ui/loading/loading.html`.
  - `src/core/flags.js` → `src/main/flags.js` (single source of truth de command-line flags).
- **Imports atualizados** em `main.js`, `ui/controller.js`, `profiles/manager.js` + comentários de cabeçalho.
- `.gitignore` preparado para `flash/*.so` / `flash/*.dll` (download on-demand na Fase 2).

### Removed — Artefatos órfãos
- `scripts/cron-reliability-30min.js` (12 KB) — script standalone de auditoria, não referenciado pelo runtime do Electron nem pelo package.json. (Artefatos `login-page.*` e binários Flash já estavam ausentes do snapshot.)

### Fixed — Tooling
- `tests/setup.js` restaurado (mocks de `electron` + `electron-log`) — 8 suites / 81 testes voltam a passar.
- `npm run lint` não herda mais o `eslint.config.mjs` flat-config do diretório pai (`ESLINT_USE_FLAT_CONFIG=false` pinado nos scripts lint/lint:fix).

---

## [4.8.0] - 2026-07-14

### Added — Multi-conta simultânea
- **Manager permanece visível ao abrir um jogo**: antes o manager era oculto quando um jogo abria (para liberar ~45MB de RAM), o que impedia dar Play em outra conta. Agora o manager fica visível por padrão → o usuário pode abrir N contas ao mesmo tempo, cada uma em janela/partition isolada (cookies/localStorage/cache 100% separados pelo Chromium — sem conflito de processos). Em Ramen Mode (PC <2GB RAM) o comportamento legado (ocultar) é mantido por necessidade de memória.

### Changed — Launcher simplificado
- **Atalhos de teclado removidos**: o módulo `window/shortcuts.js` (F5/F6/F7/F11, Ctrl+Shift+S/T, Ctrl+±/0) e os atalhos do manager (Ctrl+N/E/I, V, S, F5) foram removidos — o launcher é intencionalmente minimalista. Apenas `Esc` fecha modais. A referência de uso mora no site companheiro (dashboard → aba Guia). Guards de segurança (Alt+F4, bloqueio de DevTools) permanecem.
- **Painel "Sistema" consolidado**: a sidebar flutuante (sidebar.js) foi removida — era redundante com o indicador de RAM da nav. O botão "Forçar Limpeza de RAM" + stats de memória + contadores de GC foram movidos para Configurações → nova seção "Desempenho".
- **Overlay de carregamento reformulado**: removido o emoji 🍥 (quebrava via fontconfig em alguns hosts → glifo inválido/"caracteres" estragados), substituído por spinner CSS (zero dependência de fonte). Fundo #0f0f14 igual ao da janela → transição suave overlay→jogo sem flash preto.

### Fixed — Runtime
- **MESA_GLSL_CACHE_DISABLE deprecado**: migrado para `MESA_SHADER_CACHE_DISABLE` (preservando a intenção do usuário) no topo do main.js, silenciando o warning de depreciação do Mesa a cada boot.
- **Fontconfig warnings** (`invalid attribute 'xsi:nil'`): documentados como ruído do SISTEMA HOSPEDEIRO (arquivo `/etc/fonts/conf.d/48-guessfamily.conf` com XML inválido em algumas distros). Inofensivos — o AppImage não pode corrigir `/etc/fonts`. Documentado em main.js + dashboard Guia.

### Removed — Dead code
- `src/window/shortcuts.js` (módulo de atalhos removido)
- `src/ui-manager/sidebar.js` (painel Sistema flutuante — consolidado em Configurações)
- 78 declarações i18n mortas (chaves `sidebar.*` e `settings.shortcuts*` do antigo Shinobi Suite, em 6 idiomas)
- 4 regras CSS mortas (`.shortcuts-grid`, `.shortcut-key`, `.shortcut-desc`, `kbd`)
- Funções mortas `_adjustZoom`/`_resetZoom` em game-launcher.js
- Texto stale "Crashes tab of the sidebar" no setup (→ "Configurações") em 6 idiomas

---

## [4.7.0] - 2026-07-14

### Changed — Unificação de Configurações + Limpeza Geral
- **Sidebar "Sistema" enxuto**: removida a toggle de Telemetria (duplicada com Configurações → Preferências) e a contagem de crashes (agora só em Configurações → Avançado). Painel agora é PURAMENTE ação ao vivo: Forçar Limpeza de RAM + stats de memória + contadores de GC. Reduzido de 415 → 331 linhas.
- **Nova seção "Avançado" nas Configurações**: agrega o que era útil do antigo Shinobi Suite em um único lugar honesto:
  - Relatórios de crash (local-only): lista com type/reason/data/exit-code, descartar individualmente ou em massa, refresh manual. Badge "local-only" deixa claro que nada é enviado a servidores.
  - Backup criptografado AES-256-GCM: botões Exportar/Importar que já existiam via IPC mas não tinham UI exposta.
  - Sobre o launcher: versão + link direto para o GitHub.
- **Crash reporter honesto (local-only)**: removido o no-op `_sendToVercel` (morto desde v4.1), `resendReport`, `_buildIssueContent`, e os campos `sent`/`sentAt`/`issueNumber`/`deduplicated` que nunca eram setados. O módulo agora deixa explícito que NADA é enviado — apenas registra localmente para inspeção do usuário. Crash schema simplificado.

### Removed — Código morto / meta-files
- `api/report-crash.js` (Vercel Serverless Function — endpoint nunca foi deployado, chamada removida em v4.1)
- `api/` (pasta vazia após remoção do arquivo acima)
- `scripts/ai-cron.js` (loop autônomo de auto-melhoria — experimento concluído)
- `scripts/ai-cron.sh` (wrapper do loop acima)
- `scripts/evolve-log.md` (log do AI cron — não é documentação)
- `scripts/evolve-prompt.md` (prompt mestre do AI cron — não é documentação)
- IPC handler `crash:resend` (chamava função morta)
- API `window.api.resendCrashReport` (sem uso após remoção do botão "Reenviar")
- `main.js` `resendCrashReport` (proxy morto para crashReporter.resendReport)

### Kept (mantidos após auditoria)
- `scripts/cron-reliability-30min.js` — auditoria standalone útil (listener leak, i18n completeness, faxina)
- `scripts/debug-launcher.sh` — wrapper de debug para desenvolvedor
- `scripts/publish-secure.sh` — script de publicação segura

---

## [4.6.0] - 2026-07-14

### Added
- Profile Sorting: 7 modos (favoritos, nome, último uso, lançamentos, tempo, região, criação), persistido em localStorage, atalho 'S' para ciclar
- Profile Favorites: estrela amarela em cada card, prefixo no nome, borda de destaque, persistido no schema v4
- Profile Duplication: clona metadata (sem credenciais — segurança), sufixo "(cópia)", atividade logada
- i18n Migration: 80+ strings traduzidas para PT e EN no launcher UI (resolves dívida técnica do Sprint 3)
- CSS Tooltip System via `[data-tip]` + `[data-tip-pos]` em todos os botões de ação
- Loading Skeletons: `.skeleton-card`, `.skel-line`, `.skel-circle` prontos para estados async
- Connection Health Badge CSS: 4 estados (good/medium/bad/unknown) prontos para feature de ping futuro
- Account Toolbar redesign: search-wrap + toolbar-right (count + sort dropdown)

### Changed
- Sidebar e main.js: bump para v4.6
- Botões: feedback de pressão `.btn:active { transform: scale(.96) }`
- Versão: 4.6.0

---

## [4.5.0] - 2026-07-14

### Added
- Profile Statistics: schema v3 com `notes`, `launchCount`, `totalPlayMs` (backward-compatible migration)
- Profile Notes: textarea no modal de edição com char counter (200 chars), exibido no card com tooltip
- Quick Server Switcher: dropdown S1-S9999 no card, troca instantânea via IPC (sem modal)
- Card View Modes: grid (default) + list (horizontal), persistido em localStorage, atalho 'V'
- Auto-Login Status Indicator: badge em tempo real (idle/loading/success/error) via IPC push
- Game Window Status Badge: "aberta" com pulse laranja, limpa ao fechar
- Card Stats Display: launch count + total play time formatados (human-readable)

### Changed
- store.js: schema v3 com migration, validação, 3 novos métodos (incrementLaunch, addPlayTime, getStats)
- controller.js: tracking de launch time, 4 novos IPC handlers
- game-launcher.js: window status events + auto-login state completo (waiting/not-found)
- Versão: 4.5.0

---

## [4.4.0] - 2026-07-13

### Changed
- UI Professional Overhaul: sidebar nav + views + cards estilo Heroic
- Sidebar minimizado: removida suite shinobi pesada (3 tabs: Otimizar + Conversor de Moedas + Crashes, ~520 linhas)
- Sidebar reescrita como painel minimalista "Sistema" (~260 linhas): Forçar GC + stats compactas + toggle de telemetria
- Auto-login robustness: selectors verificados contra 8 capturas HTML reais das regiões
- Animações cubic-bezier suaves + fade-in do conteúdo
- GC button: shimmer hover, green flash success, pulse no "Limpando..."
- Stats: micro-animação de transição numérica, RAM bar com cor dinâmica
- Toggle: label Ativo/Desativado, transição mais suave

---

## [3.3.0] - 2026-07-11

### Changed
- **URL direta**: `naruto.oasgames.com/pt/` → `https://oasgames.com` (portal de login unificado, abre direto na autenticação)
- **Tray removido**: app fecha quando todas as janelas fecham (close inteligente no controller.js)
- **logintype=4 injetado direto**: antes dependia de rewrite do blocker.js; agora explícito em LAUNCHER_PARAMS (reconhecimento de launcher pelo servidor → habilita resgate de prêmios)
- **Sidebar reescrito**: removido Team Builder (16 ninjas), sinergia elemental, 8 guias externos. Mantido apenas: botão Forçar Limpeza de RAM, conversor de moedas, dashboard de telemetria, crash reporter

### Added
- **Crash Reporter não-invasivo** (`src/telemetry/crash-reporter.js`): coleta local de crashes com sanitização obrigatória (remove paths, usernames, tokens, emails). Opt-out via toggle no sidebar. Report ao GitHub via issue pré-preenchida (shell.openExternal, usuário revisa antes de submeter)
- **RAM counter com auto-refresh**: setInterval 5s atualiza RAM/uptime/telemetria enquanto sidebar aberto
- **hasOpenWindows() helper** em game-launcher.js: controller decide hide vs close do manager
- 5 handlers IPC novos: crash:get-pending, crash:report-github, crash:dismiss, crash:is-enabled, crash:set-enabled

### Removed
- `src/core/tray.js` (tray autônomo deletado — user request "nao quero ele na bandeja")
- Comentários obsoletos referenciando tray em main.js, manager.js, controller.js, guard.js

---

## [3.2.0] - 2026-07-10

### Changed
- **Dados 2025 atualizados**: eventos (Daily Reset 0h→5h, adicionado Bond/Check-in, Arena de Guildas), moedas (1 Coupon = 10 Ingots CORRIGIDO para 1:1), guias (8 URLs verificadas)
- **Team Builder**: 10 jutsus lore → 16 ninjas reais do meta 2025 (Naruto Sage, Sasuke MS, Itachi, Pain, etc.) com calculadora de sinergia elemental

### Added
- `src/config/urls.js` (migrado de window/dialogs.js deletado)
- `src/config/__tests__/urls.test.js`

---

## [3.1.0] - 2026-07-10

### Added
- **ProfileManager facade** (`src/profiles/manager.js`): API pública única sobre store+partition+vault+game-launcher
- **Camada 0 do MemoryGuard**: injeção de `window.gc(true)` em webviews ativas (daemon 10min normal / 5min batata)
- **Painel lateral Akatsuki** (`src/ui-manager/sidebar.js`): Team Builder, Guias, Calc, Sistema
- **Isolamento de crash**: handler `render-process-gone` + `unresponsive`/`responsive` por janela
- **ensurePartitionDir()**: cria dir persist eager (fix bunshin em perfil novo)

---

## [3.0.0] - 2026-07-10

### Changed
- **Flags consolidadas** (`src/core/flags.js`): single source of truth para commandLine. Bug do `--expose-gc` perdido CORRIGIDO (merge único de js-flags)
- **Shadow Partitions**: em Modo Batata, usa `partition:profile-<id>` ephemeral + snapshot de cookies de auth (economiza 30-80MB por perfil)
- **Cofre de credenciais** (`src/profiles/vault.js`): AES-256-GCM machine-bound para auto-login real
- **Tray autônomo**: manager some para bandeja quando jogo abre (deprecado em v3.3)

### Added
- **EventTimers com fusos dinâmicos** por região (BR/NA/EU/HK)
- **Modo Batata auto-detect** (RAM <4GB): GC a cada 2min, threshold 450MB
- **Ramen Mode** (RAM <2GB): manager UI suprimido

---

## [1.4.0] - 2026-05-23

### Changed
- **Always extract AppImage during installation** (#1)
  - No FUSE dependency at runtime — works on every Linux
  - Instant startup via extracted AppRun (no FUSE mount delay)
  - `.AppImage` deleted after extraction to save disk space
  - FUSE removed from distro dependency checks
- **var → const/let** in shortcuts.js, create.js, and menu.js

### Added
- `--appimage-extract-and-run` fallback in run.sh for `.AppImage` files

## [1.3.0] - 2026-05-22

### Added
- System tray support — close minimizes to tray, tray context menu
- Screenshot capture (Ctrl+Shift+S) — saves PNG with timestamp
- Zoom controls (Ctrl++/Ctrl+-/Ctrl+0) — adjust page zoom
- Always-on-top toggle (Ctrl+Shift+T) — pin window above all others
- Updated menu with new shortcuts and version display
- Screenshot IPC handler and preload API

## [1.2.0] - 2026-05-20

### Added
- Update notification dialog with download link
- Connectivity check before loading (net.isOnline)
- Keyboard shortcut debounce (1s)
- Window bounds persistence (position + size saved/restored)
- "Limpar Cache" menu option (separate from "Limpar Login")
- Loading screen extracted to loading.html
- Basic CSP via webRequest.onHeadersReceived
- Preload script with contextBridge API
- mms.cfg backup on every startup
- Shell script safety (install.sh validates inputs, uninstall.sh validates HOME)

### Changed
- var → const/let across all 15 source files
- DRY: flags.js shares applyGPUFlags() between profiles

### Fixed
- Regex bug in blocker.js: `logintype=3` now uses boundary-aware `logintype=3(?=&|$)`
- Cancel button in dialogs.js with correct `cancelId`
- URL validation in shell.openExternal (http/https only)

## [1.1.0] - 2026-04-01

### Changed
- Remove ~200 lines of dead code, ineffective settings, and unused exports
  - Removed 12 fake mms.cfg settings (AutoPlay, NetworkAccess, EnableSocketsTo, etc.)
  - Removed dead hash verification system in plugin.js
  - Removed ineffective ppapi-flash-args (clean-flash PPAPI ignores them)
  - Removed no-op setupGPUOptimizations, redundant flags in flags.js
  - Removed ineffective CORS headers in cookies.js
  - Removed unused exports across 10 modules

### Fixed
- Add unhandledRejection handler (prevents silent async crashes)
- Atomic config write (write to .tmp then rename, prevents corruption)
- Add HOME env fallback in mms.cfg path (flatpak/snap compatibility)
- Add 1MB response size limit in update checker (memory protection)
- Add maxFiles=3 for log rotation (prevents unbounded disk growth)
- Add window icon for Linux (BrowserWindow icon + StartupWMClass fix)
- Fix StartupWMClass mismatch (naruto-online → Naruto Online)
- Pass parent window to menu dialogs (appear above game)
- Restore test suite to 100% pass (58/58 tests)

## [1.0.0] - 2026-03-30

First stable release.

### Features
- Native Flash PPAPI 34 integration (no Wine, no browser hacks)
- Instant loading screen (data:URL, zero network dependency)
- Built-in tracker/ad blocker (analytics, telemetry)
- Mixed Content fix for Flash crossdomain.xml
- Full viewport CSS (no borders, OAS bar hidden)
- Simple fullscreen (ESC passes through to the game)
- 6 game regions: PT-BR, EN, FR, DE, ES, PL
- Persistent login with cookie partition
- 3 hardware profiles: Modern (GPU), Legacy (older GPU), CPU (SwiftShader)
- Wayland to XWayland auto-conversion

### Linux
- install.sh with auto-detection (Arch/CachyOS/Fedora/Debian)
- Desktop entry with icon (hicolor theme)
- AppImage packaging with auto-extraction

### Shortcuts
- F5 — Clear login
- F6 — Switch region
- F7 — Switch hardware profile
- F11 — Fullscreen (ESC passes to game)
