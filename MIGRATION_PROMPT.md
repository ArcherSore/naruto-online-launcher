# SHINOBI LAUNCHER — MIGRATION PROMPT v4.9.3 → v5.0.0

> **Documento de continuidade para nova sessão de IA.**
> Auto-contido: outra IA pode pegar daqui e continuar sem ler o histórico.
> Última atualização: v4.9.2 (commit `451d030`).

---

## 0. COMO USAR ESTE DOCUMENTO

1. Leia a Seção 1 (Contexto) e Seção 2 (Estado atual) primeiro.
2. Leia a Seção 3 (Decisões confirmadas) — são mandatos do usuário, não sugestões.
3. Execute a Seção 5 (Roadmap) em ordem. Cada fase é independente e atômica.
4. Ative o agente especializado da Seção 7 para polimento contínuo.
5. Em caso de dúvida, consulte a Seção 6 (Especificações técnicas).

---

## 0.5. MODO AUTÔNOMO TOTAL (MANDATÓRIO)

**O usuário NÃO fará upload manual de arquivos, NÃO responderá perguntas de
confirmação, NÃO fará build/upload de binários.** A IA tem acesso direto ao
sistema de arquivos do sandbox em `/home/z/naruto-repo` e deve executar
TODA a migração sozinha, do diagnóstico ao commit.

### Princípios de autonomia:
1. **Nunca perguntar.** Se uma decisão está na Seção 3, execute. Se não está
   e é técnica, decida com base em SOLID/Clean Code e registre no worklog.
   Só escale pro usuário se for bloqueio de negócio genuíno (raro).
2. **Analisar antes de agir.** Antes de cada fase, rodar diagnóstico:
   - `cd /home/z/naruto-repo && git log --oneline -5 && git status`
   - `cd /home/z/naruto-repo && npm run lint 2>&1 | tail -20`
   - `cd /home/z/naruto-repo && npm test 2>&1 | tail -20`
   - `cat /home/z/my-project/worklog.md | tail -100` (progresso de agentes anteriores)
3. **Commitar sozinho.** Usar `git add -A && git commit -m "<msg>"` após cada
   sub-fase atômica. Mensagens seguem conventional commits (ver Seção 5).
4. **Push público obrigatório.** Após cada commit, rodar
   `git push origin main` (ou `git push origin debug` na Fase 3). O repo
   `origin` já tem token GitHub configurado (`x-access-token`) com push
   access confirmado em `github.com/Chrispsz/naruto-online-launcher`.
   **Toda migração DEVE resultar em commits públicos no GitHub** — o
   usuário quer o trabalho versionado publicamente, não só local.
5. **Testar sozinho.** Rodar `npm run lint` e `npm test` após cada commit.
   Se quebrar, corrigir antes de prosseguir (não deixar main quebrada).
6. **Git author já configurado:** `Chrispsz <Chrispsz@users.noreply.github.com>`.
   Não alterar. Commits aparecem atribuídos a Chrispsz no GitHub.
7. **Registrar tudo no worklog.** Após cada fase, append em
   `/home/z/my-project/worklog.md` (formato na Seção 7).
8. **Lidar com Electron sem GUI.** Electron 11 roda em headless via xvfb se
   necessário: `xvfb-run -a npm start`. Para testes de boot sem UI, usar
   `timeout 10 xvfb-run -a npm start 2>&1 | tail -30` e checar logs.
9. **Flash PPAPI local.** Os binários `flash/*.so|dll` ESTÃO no disco em
   `/home/z/naruto-repo/flash/` (commitados, 32MB). A IA pode usá-los pra
   testar boot antes de implementar o download on-demand da Fase 2.
   **Na Fase 2 eles serão removidos do git e o push vai refletir isso
   publicamente** — o repo público vai cair de ~17MB pra ~1.5MB.
10. **Não deletar `node_modules/`.** Já está instalado (396MB). Se um pacote
    novo for necessário, `npm install <pkg>` (sem `--save-dev` desnecessário).
11. **Path absoluto sempre.** A IA trabalha em `/home/z/naruto-repo`. Usar
    `cd /home/z/naruto-repo && ...` em todo comando bash.
12. **Sync inicial.** Antes de começar, rodar `git pull --rebase origin main`
    pra garantir que está trabalhando em cima do último estado público.
    Após terminar, `git push origin main` publica o trabalho.

### Sequência de boot obrigatória da IA continuadora:
```
1. cat /home/z/naruto-repo/MIGRATION_PROMPT.md        # este doc (ler TUDO)
2. tail -200 /home/z/my-project/worklog.md            # progresso anterior
3. cd /home/z/naruto-repo && git pull --rebase origin main  # sync público
4. cd /home/z/naruto-repo && git log --oneline -10    # estado do git
5. cd /home/z/naruto-repo && git status               # untracked/dirty?
6. cd /home/z/naruto-repo && npm run lint 2>&1 | tail # saúde do código
7. cd /home/z/naruto-repo && npm test 2>&1 | tail     # saúde dos testes
8. Verificar Seção 8 (Checklist) — o que já está feito?
9. Executar próxima fase pendente.
10. git add -A && git commit -m "<msg>" && git push origin main  # PUBLICA
11. Append worklog.
```

---

## 1. CONTEXTO DO PROJETO

**Shinobi Launcher** — desktop launcher Electron 11 multi-conta para Naruto Online (jogo Flash PPAPI). UI em PT-BR. Single-user (apenas o autor usa). Identidade: **zero tracking, zero telemetria, logs ficam no disco do usuário**.

- **Repo:** `/home/z/naruto-repo` (git: `github.com/Chrispsz/naruto-online-launcher`)
- **Stack:** Electron 11.5.0 (ÚLTIMA com PPAPI Flash) + Clean Flash 34.0 + Node 16.20.2 + vanilla JS/HTML/CSS (zero framework dentro do Electron) + electron-log + jest
- **Plataformas:** Linux AppImage + Windows portable EXE
- **Versão atual:** `4.9.2` (package.json)
- **Branch:** `main` (única branch ativa — não há branch debug ainda)

### Filosofia arquitetural (NÃO-NEGOCIÁVEL)
- **Zero tracking.** Nenhum dado sai do disco do usuário sem clique explícito.
- **Performance primeiro.** Launcher idle deve ficar em ~45 MB RAM.
- **Vanilla JS dentro do Electron.** Nada de React/Vue dentro do Electron — só preload + index.html.
- **Single-user.** Não projetar para multi-tenant, não otimizar pra escala.

---

## 2. ESTADO ATUAL (v4.9.2)

### O que JÁ ESTÁ feito e FUNCIONANDO (não mexer sem motivo):
- ✅ Multi-perfil com shadow partitions (`partition:profile-p_*`)
- ✅ MemoryGuard + Modo Batata (120s/450MB) + GC daemon (420s/700MB)
- ✅ API Login via `passport.oasgames.com` → JWT (HS256, 2h) → cookie `oas_user`
- ✅ Tempmail (`mail.tm`) → cria conta → passport register → JWT em ~1s (rate limited 5/h, 30s entre cada) — **PROVEN WORKING**
- ✅ Network Inspector (webRequest capture, JWT extraction, URL classification)
- ✅ Diagnostics Exporter (`src/utils/diagnostics.js`) — gera .zip sanitizado, opt-in
- ✅ Backup criptografado AES-256-GCM + PBKDF2 (200k iters, SHA-512)
- ✅ AMOLED theme + i18n 6 idiomas (PT/EN/DE/ES/PL/FR)
- ✅ CI/CD GitHub Actions (`build-release.yml`): matrix ubuntu-22.04 + windows-2022, Node 16.20.2
- ✅ Zombie telemetry removido em v4.9.2 (crash-reporter.js deletado, strings i18n limpas)

### O que ESTÁ PENDENTE (herdado de sprints anteriores):
- ⚠️ **GC causa black screen** — `MemoryGuard.gc()` faz o jogo ficar preto. Suspeita: interação `webContents` durante GC. **NÃO CORRIGIDO.**
- ⚠️ **F5 reload Flash session** — não implementado
- ⚠️ **DevTools + extract page source** — não implementado
- ⚠️ **Tempmail → auto-create profiles** — tempmail cria JWT mas não cria Profile automaticamente
- ⚠️ **JWT auto-renewal** — `renewIfNeeded()` existe em `api-login.js` mas nunca é chamado

---

## 3. DECISÕES CONFIRMADAS PELO USUÁRIO (mandatos)

### Decisão A — Flash: download sempre do MAIS ATUAL + cache
**NÃO** baixar versão fixa por Release tag. Baixar sempre a versão mais recente disponível do Clean Flash PPAPI (darktohka build) e cachear localmente.

- Source canônico: `https://github.com/darktohka/clean-flash-builds/releases/latest`
- Assets: `clean-flash-linux.tar.xz` (contém `libpepflashplayer.so`) e `clean-flash-windows.exe` (instalador — extrair `pepflashplayer.dll`)
- Cache path: `app.getPath('userData')/flash-cache/{libpepflashplayer.so,pepflashplayer.dll}`
- First-run: se `flash/` local não existir OU cache estiver vazio, baixar + extrair
- Subsequent runs: usar cache; verificar update em background (1x por semana, não bloquear boot)
- `flash/plugin.js` ganha fallback: `findFlashPlugin()` → se null, chamar `FlashUpdater.ensureLatest()` (async, mostra progresso na UI)

### Decisão B — Debug: branch separada + feature flag escondida
**DUAS camadas de isolamento** pra código de debug/teste que não deve chegar ao usuário final:

1. **Branch `debug`** no git — código experimental fica aqui, nunca merge em `main` sem aprovação. `main` = sempre release-ready.
2. **Feature flag escondida** na build final (`main`) — ativação via terminal:
   - Variável de ambiente: `SHINOBI_DEBUG=1 ./Naruto-Online.AppImage`
   - OU atalho secreto na UI: segurar `Ctrl+Shift+D` por 2s na tela principal
   - Quando ativo: mostra aba "Dev" escondida com logs em tempo real, DevTools, inspector entries, tempmail inbox, JWT decoder, manual GC trigger
   - **Performance:** flag checada 1x no boot, guardada em `process.env.SHINOBI_DEBUG`. Código debug envolto em `if (DEBUG)` — tree-shakeable, zero overhead quando desativado.

### Decisão C — Reestruturação SOLID + Clean Code
Aplicar POO + SOLID + Clean Code nos God Objects. Ver Seção 5, Fase 3.

### Decisão D — Limpeza do GitHub
- Remover binários Flash do git (32 MB) → ir para download on-demand
- Remover artefatos de debug commitados por engano (`login-page.*`)
- Branch `debug` separada
- `main` fica enxuto (~1.5 MB de repo)

---

## 4. KEY LINKS — ONDE PARAMOS

### Arquivos críticos (paths absolutos no repo `/home/z/naruto-repo`):

| Arquivo | Linhas | Estado | Ação na migração |
|---|---|---|---|
| `src/main.js` | 434 | bootstrap monolítico | → split em `src/main/{index,boot}.js` |
| `src/ui-manager/controller.js` | 648 | God Object (IPC + window + state) | → split em 3 classes |
| `src/ui-manager/game-launcher.js` | 620 | God Object (launch + lifecycle + GC + shortcuts) | → split em 3 + adicionar F5/DevTools |
| `src/profiles/vault.js` | 571 | God Object (crypto + CRUD + password) | → split em 3 |
| `src/memory/guard.js` | 436 | God Object (guard + GC + Modo Batata) | → split + **FIX BLACK SCREEN** |
| `src/profiles/store.js` | 457 | OK, só mover | → `src/profiles/ProfileStore.js` |
| `src/utils/diagnostics.js` | 362 | ✅ já existe, sanitizado | manter |
| `src/utils/logger.js` | 90 | ✅ electron-log wrapper | manter |
| `src/core/flags.js` | 95 | single-source-of-truth | → `src/main/flags.js` |
| `src/flash/plugin.js` | 129 | detector local | + `FlashUpdater` (Decisão A) |
| `src/network/api-login.js` | 126 | login OK, `renewIfNeeded` órfão | wirear auto-renewal |
| `src/network/tempmail.js` | 327 | ✅ working | + auto-create profile |
| `src/network/inspector.js` | 209 | ✅ working | manter |
| `src/config/i18n.js` | 357 | ✅ limpo (telemetria removida) | manter |
| `src/config/settings.js` | 127 | ✅ limpo | manter |
| `src/ui-manager/index.html` | 1822 | UI responsiva adicionada v4.9.2 | polir + adicionar aba Dev escondida |
| `src/ui/setup.html` | 502 | ✅ limpo | mover pra `src/ui/setup/` |

### Artefatos a DELETAR do git:
- `login-page.png` (727 KB) — screenshot de reverse-engineering
- `login-page-source.html` (201 KB) — source extraído da página
- `login-page-login.js` (15 KB) — JS extraído da página
- `flash/libpepflashplayer.so` (16.7 MB) — vira download
- `flash/pepflashplayer.dll` (16.0 MB) — vira download
- `assets/icon.ico` (145 KB) — gerar do PNG no build
- `scripts/cron-reliability-30min.js` (12 KB) — verificar se órfão, provável delete

### Estrutura-alvo (Clean Architecture):
```
src/
├── main/                      # bootstrap fino
│   ├── index.js               # era main.js (434 → ~80 linhas)
│   ├── boot.js                # orquestra boot sequence
│   ├── flags.js               # era core/flags.js
│   └── debug.js               # feature flag SHINOBI_DEBUG
├── app/                       # serviços de aplicação
│   ├── Launcher.js            # orquestra lifecycle do launch
│   ├── DiagnosticsExporter.js # mover de utils/diagnostics.js
│   ├── AutoUpdater.js
│   └── FlashUpdater.js        # NOVO (Decisão A)
├── profiles/                  # domínio Profile
│   ├── Profile.js             # entity/VO
│   ├── ProfileStore.js        # era store.js
│   ├── ProfileVault.js        # split de vault.js — só crypto
│   ├── PasswordManager.js     # split de vault.js — senha mestre
│   └── Partition.js
├── network/                   # já decente
│   ├── ApiLogin.js            # + wirear renewIfNeeded
│   ├── TempmailService.js     # + auto-create profile
│   ├── Inspector.js
│   ├── Blocker.js
│   └── Cookies.js
├── memory/
│   ├── MemoryGuard.js         # monitor
│   └── GcDaemon.js            # split + FIX BLACK SCREEN
├── flash/
│   ├── PluginLoader.js        # era plugin.js
│   └── MmsConfig.js           # era mms.js
├── ui/                        # MERGE ui-manager + ui
│   ├── manager/
│   │   ├── ManagerWindow.js   # split de controller.js
│   │   ├── IpcRouter.js       # split de controller.js
│   │   ├── StateBroadcaster.js# split de controller.js
│   │   ├── KeyboardShortcuts.js # NOVO (F5, DevTools, Ctrl+Shift+D)
│   │   └── index.html
│   ├── setup/
│   └── loading/
├── config/                    # está OK
│   ├── hardware.js
│   ├── i18n.js
│   ├── regions.js
│   ├── settings.js
│   └── urls.js
├── utils/                     # MERGE utilities/ → aqui
│   ├── Logger.js
│   ├── Jwt.js
│   └── EventTimers.js         # mover de utilities/
└── preload.js
```

---

## 5. ROADMAP DE EXECUÇÃO (3 fases atômicas)

### FASE 1 — LIMPEZA MECÂNICA (zero risco, ~30 min)
**Objetivo:** repo consistente, sem duplicação conceitual.

1. Deletar artefatos de debug da raiz:
   - `rm login-page.png login-page-source.html login-page-login.js`
2. Deletar `dist/` local (350 MB no disco, já gitignored):
   - `rm -rf dist/`
3. Verificar se `scripts/cron-reliability-30min.js` é referenciado em algum lugar. Se não, deletar.
4. Merge `src/utilities/event-timers.js` → `src/utils/EventTimers.js` (rename + atualizar imports em `controller.js`, `main.js`).
5. Deletar pasta vazia `src/utilities/`.
6. Merge `src/ui/setup.html` → `src/ui-manager/setup/` (criar subpasta) — depois do merge `ui-manager` vira `ui`.
7. Mover `src/core/flags.js` → `src/main/flags.js` (criar pasta `src/main/`). Deletar `src/core/`.
8. Atualizar todos os `require('../core/flags')` → `require('../main/flags')`.
9. Atualizar `.gitignore` para incluir `flash/*.so`, `flash/*.dll` (preparação Fase 2).
10. Bump `package.json` → `4.9.3`.
11. Commit: `refactor(v4.9.3): mechanical cleanup + folder consolidation`
12. Rodar `bun run lint` (ou `npm run lint`) — deve passar limpo.
13. Rodar `npm test` — 6 arquivos de teste devem passar.

### FASE 2 — FLASH ON-DEMAND (médio risco, ~1h)
**Objetivo:** repo cai de 17 MB → ~1.5 MB. Flash baixado sob demanda.

1. Criar `src/app/FlashUpdater.js`:
   ```js
   class FlashUpdater {
     static async ensureLatest(platform, onProgress) {
       // 1. Checar cache em userData/flash-cache/
       // 2. Se cache existe e < 7 dias, retornar path do cache
       // 3. Senão: GET https://api.github.com/repos/darktohka/clean-flash-builds/releases/latest
       // 4. Baixar asset correto (linux: .tar.xz, win: .exe)
       // 5. Extrair (tar.xz → libpepflashplayer.so; exe → usar 7z ou innoextract → pepflashplayer.dll)
       // 6. Salvar em userData/flash-cache/
       // 7. Retornar path
     }
   }
   ```
2. Modificar `src/flash/plugin.js` (vira `PluginLoader.js`):
   - `findFlashPlugin()` retorna sync path local se existir
   - Se null, `main.js` chama `FlashUpdater.ensureLatest()` async antes de `app.ready` (mostrar loading)
3. Modificar `src/main.js` boot sequence:
   - Antes: `findFlashPlugin()` sync → `configureFlash()` → ready
   - Depois: `findFlashPlugin()` sync → se null, `await FlashUpdater.ensureLatest(onProgress)` → `configureFlash()` → ready
   - Mostrar progresso na `loading.html` (já existe em `src/window/loading.html`)
4. Adicionar `manifest.json` no cache (não no repo) — `FlashUpdater` gera na primeira run.
5. Deletar `flash/libpepflashplayer.so` e `flash/pepflashplayer.dll` do repo.
6. Commit: `feat(v4.9.3): flash on-demand download + cache (repo -32MB)`
7. Testar: rodar sem Flash local → deve baixar → deve iniciar jogo.

### FASE 3 — REFACTOR SOLID + DEBUG LAYER (alto risco, ~3h)
**Objetivo:** God Objects splitados, feature flag debug, fix black screen.

#### 3a. Branch debug
1. `git checkout -b debug` a partir de `main` pós-Fase 2.
2. `main` fica release-ready. Toda feature experimental vai em `debug`.

#### 3b. Feature flag SHINOBI_DEBUG
1. Criar `src/main/debug.js`:
   ```js
   const DEBUG = process.env.SHINOBI_DEBUG === '1' || process.env.SHINOBI_DEBUG === 'true';
   module.exports = { DEBUG, isEnabled: () => DEBUG };
   ```
2. Em `index.html`, adicionar listener `Ctrl+Shift+D` (hold 2s) → toggle visual da aba Dev.
3. Toda UI de debug (inspector entries, tempmail inbox, JWT decoder, manual GC) envolta em `if (window.__SHINOBI_DEBUG__)`.
4. No preload, expor `window.__SHINOBI_DEBUG__` baseado em `process.env.SHINOBI_DEBUG`.

#### 3c. Split controller.js (648 → 3 arquivos)
- `src/ui/manager/ManagerWindow.js` — criação/focus/lifecycle da BrowserWindow
- `src/ui/manager/IpcRouter.js` — registro dos handlers IPC (um método por domínio)
- `src/ui/manager/StateBroadcaster.js` — push de estado Modo Batata/Ramen pra UI
- Aplicar SRP: cada classe uma razão pra mudar.

#### 3d. Split game-launcher.js (620 → 3 arquivos + features novas)
- `src/app/Launcher.js` — orquestra launch do profile (createBrowserWindow → loadURL → inject)
- `src/ui/manager/KeyboardShortcuts.js` — **NOVO**: F5 reload session, Ctrl+Shift+I DevTools, F12 DevTools
- `src/app/SessionLifecycle.js` — hooks de GC, did-finish-load, crash

#### 3e. Split vault.js (571 → 3 arquivos)
- `src/profiles/CryptoService.js` — AES-256-GCM + PBKDF2 puro
- `src/profiles/PasswordManager.js` — senha mestre (derivação, cache em memória)
- `src/profiles/ProfileVault.js` — CRUD de credenciais usando CryptoService + PasswordManager

#### 3f. Split guard.js + FIX BLACK SCREEN (436 → 2 arquivos)
- `src/memory/MemoryGuard.js` — monitor de RSS, dispara eventos
- `src/memory/GcDaemon.js` — daemon periódico
- **FIX BLACK SCREEN:** investigar se `webContents.session.clearCache()` ou `webContents.reload()` está sendo chamado durante GC. Hipótese: GC chama `app.commandLine` flag `--expose-gc` + `global.gc()` mas isso afeta o renderer. Solução: GC só no main process, nunca no renderer. Se persistir, desabilitar GC automático e deixar só Modo Batata manual.

#### 3g. Wirear pendências herdadas
- `api-login.js`: chamar `renewIfNeeded()` a cada 30 min via `setInterval` no `SessionLifecycle`
- `tempmail.js`: depois de criar JWT, chamar `ProfileStore.create()` automaticamente com email/JWT
- Adicionar F5 reload no `KeyboardShortcuts`
- Adicionar DevTools toggle (F12 / Ctrl+Shift+I) no `KeyboardShortcuts`

#### 3h. Commits atômicos por split
- `refactor: split controller.js → IpcRouter + ManagerWindow + StateBroadcaster`
- `refactor: split game-launcher.js → Launcher + SessionLifecycle + KeyboardShortcuts`
- `refactor: split vault.js → CryptoService + PasswordManager + ProfileVault`
- `refactor: split guard.js → MemoryGuard + GcDaemon + fix black screen`
- `feat: JWT auto-renewal wired (30min interval)`
- `feat: tempmail auto-create profile`
- `feat: F5 reload + DevTools shortcuts`
- `feat: SHINOBI_DEBUG feature flag + hidden Dev tab`
- Bump `package.json` → `5.0.0` (mudança arquitetural major)

---

## 6. ESPECIFICAÇÕES TÉCNICAS

### Commands
- **Dev:** `npm start` (ou `npx electron .`) — roda na porta não-aplicável (Electron desktop)
- **Lint:** `npm run lint` (eslint src/)
- **Test:** `npm test` (jest, 6 arquivos de teste)
- **Build:** `npm run build` (Linux AppImage + Windows portable)
- **Build Linux only:** `npm run build:linux`
- **Build Windows only:** `npm run build:win`

### Estrutura de testes (manter cobertura)
- `src/config/__tests__/hardware.test.js`
- `src/config/__tests__/regions.test.js`
- `src/config/__tests__/settings.test.js`
- `src/config/__tests__/urls.test.js`
- `src/network/__tests__/blocker.test.js`
- `src/network/__tests__/tempmail.test.js`
- `src/utils/__tests__/jwt.test.js`
- `src/utils/__tests__/logger.test.js`

### Flash PPAPI specifics
- **Build canônico:** darktohka/clean-flash-builds (GitHub)
- **Versão atual bundled:** Linux `34.0.0.137`, Windows `34.0.0.376`
- **API releases:** `https://api.github.com/repos/darktohka/clean-flash-builds/releases/latest`
- **Linux asset:** `clean-flash-linux.tar.xz` → extrai `libpepflashplayer.so` + `manifest.json`
- **Windows asset:** `clean-flash-windows.exe` (instalador InnoSetup) → usar `innoextract` ou `7z` pra extrair `pepflashplayer.dll`

### Electron 11 constraints (NÃO QUEBRAR)
- PPAPI Flash só funciona até Electron 11.5.0 — **NUNCA bumpar Electron**.
- `app.commandLine.appendSwitch` deve rodar ANTES de `app.ready` (ver `flags.js`).
- `--expose-gc` é necessário pra `MemoryGuard.gc()` — está em `js-flags`.
- Sandbox desabilitado globalmente (PPAPI precisa).

### CI/CD
- `.github/workflows/build-release.yml`: matrix ubuntu-22.04 + windows-2022, Node 16.20.2
- Tag `v*` pusha → build → cria Release com assets AppImage + EXE
- **Pós-Fase 2:** adicionar step pra upload do Flash como Release asset (backup caso download on-demand falhe)

### Logger
- `src/utils/logger.js` wraps `electron-log`
- Níveis: `debug`, `info`, `warn`, `error` (com emojis)
- Arquivo: `~/.config/Naruto Online/logs/main.log` (5MB rotation, 3 files)
- Console level via `LOG_LEVEL` env var
- **Pós-DEBUG flag:** quando `SHINOBI_DEBUG=1`, subir console level pra `debug`

---

## 7. ATIVAÇÃO DE AGENTE ESPECIALIZADO (polimento contínuo)

Depois de completar as 3 fases, ativar um agente especializado para polimento contínuo. Cron job a cada 15 min:

**Prompt do agente (webDevReview):**
```
First, assess the current project status of /home/z/naruto-repo (Shinobi Launcher — Electron 11 desktop app, NOT a web app). Read /home/z/naruto-repo/MIGRATION_PROMPT.md and /home/z/my-project/worklog.md to understand context.

IMPORTANT: This repo has push access to github.com/Chrispsz/naruto-online-launcher (token configured). All work MUST be committed AND pushed publicly. Git author: Chrispsz.

Perform necessary QA:
1. cd /home/z/naruto-repo && git pull --rebase origin main (sync with public)
2. cd /home/z/naruto-repo && npm run lint — fix any issues.
3. cd /home/z/naruto-repo && npm test — ensure all 8 test files pass.
4. cd /home/z/naruto-repo && git status — ensure no uncommitted debug artifacts.
5. If Electron is running (pgrep -f electron), kill stale instances before testing.
6. Verify the 3-phase migration per MIGRATION_PROMPT.md Section 5.

Prioritize fixes if there are bugs, lint errors, test failures, or uncommitted debug artifacts in main branch. After fixing: git add -A && git commit && git push origin main.

If stable, propose next-step improvements based on MIGRATION_PROMPT.md:
- Wire remaining pending items (JWT auto-renewal, tempmail auto-create profile, F5/DevTools shortcuts)
- Fix GC black screen bug (MemoryGuard.gc() makes game go black)
- Polish UI (responsive scaling, AMOLED, accessibility)
- Add more feature flags under SHINOBI_DEBUG
- Improve test coverage for new split classes
Each improvement = 1 commit + 1 push to origin/main.

Update /home/z/my-project/worklog.md with progress after each round.
```

**Schedule:** cron, every 15 minutes, timezone America/Sao_Paulo.

---

## 8. CHECKLIST FINAL (marcar quando completo)

### Fase 1 — Mecânica
- [ ] `login-page.*` deletados
- [ ] `dist/` local deletado
- [ ] `scripts/cron-reliability-30min.js` verificado/deletado
- [ ] `src/utilities/` merged em `src/utils/`
- [ ] `src/ui/` merged em `src/ui-manager/` (→ `src/ui/`)
- [ ] `src/core/flags.js` → `src/main/flags.js`
- [ ] `.gitignore` atualizado pra `flash/*.so|dll`
- [ ] `package.json` bump 4.9.3
- [ ] `npm run lint` limpo
- [ ] `npm test` verde
- [ ] Commit feito

### Fase 2 — Flash
- [ ] `src/app/FlashUpdater.js` criado
- [ ] `src/flash/plugin.js` modificado com fallback
- [ ] `src/main.js` boot sequence atualizada
- [ ] `loading.html` mostra progresso
- [ ] `flash/*.so|dll` removidos do git
- [ ] Teste: rodar sem Flash local → baixa → inicia
- [ ] Commit feito

### Fase 3 — SOLID + Debug
- [ ] Branch `debug` criada
- [ ] `src/main/debug.js` feature flag
- [ ] `Ctrl+Shift+D` UI toggle implementado
- [ ] `controller.js` splitado em 3
- [ ] `game-launcher.js` splitado em 3
- [ ] `vault.js` splitado em 3
- [ ] `guard.js` splitado em 2 + **BLACK SCREEN FIXADO**
- [ ] JWT auto-renewal wired
- [ ] Tempmail auto-create profile
- [ ] F5 reload session
- [ ] DevTools toggle (F12)
- [ ] `package.json` bump 5.0.0
- [ ] Cron job agendado (Seção 7)

---

**FIM DO DOCUMENTO — IA continuadora: comece pela Fase 1, Seção 5.**
