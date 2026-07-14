<div align="center">

# 🍥 Shinobi Launcher — Naruto Online

**O launcher multi-conta mais leve e inovador para Naruto Online.**
Multi-conta isolada • GC de memória inteligente • Linux + Windows nativos • Zero tracking

<!--VERSION:v4.7.0-->

[![Build](https://img.shields.io/github/actions/workflow/status/Chrispsz/naruto-online-launcher/build-release.yml?style=flat-square&logo=github)](https://github.com/Chrispsz/naruto-online-launcher/actions)
[![Version](https://img.shields.io/badge/version-4.7.0-FF8C00?style=flat-square)](https://github.com/Chrispsz/naruto-online-launcher/releases/latest)
[![License](https://img.shields.io/github/license/Chrispsz/naruto-online-launcher?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Chrispsz/naruto-online-launcher/total?style=flat-square&color=DC2626)](https://github.com/Chrispsz/naruto-online-launcher/releases/latest)

</div>

---

## ⚡ Download Grátis

<!--LINUX_URL:https://github.com/Chrispsz/naruto-online-launcher/releases/latest-->
<!--WIN_URL:https://github.com/Chrispsz/naruto-online-launcher/releases/latest-->

<table align="center">
  <tr>
    <td align="center" width="50%">
      <a href="<!--LINUX_URL-->">
        <img src="https://img.shields.io/badge/🐧%20LINUX-Download%20(.zip)-000000?style=for-the-badge&logo=linux&logoColor=white&labelColor=0B1220&color=FF8C00" alt="Download Linux" />
      </a>
      <br><sub>AppImage + installer</sub>
    </td>
    <td align="center" width="50%">
      <a href="<!--WIN_URL-->">
        <img src="https://img.shields.io/badge/🪟%20WINDOWS-Download%20(.zip)-0078D4?style=for-the-badge&logo=windows&logoColor=white&labelColor=0B1220&color=DC2626" alt="Download Windows" />
      </a>
      <br><sub>Portable EXE — sem instalação</sub>
    </td>
  </tr>
</table>

> 🔄 Os links acima são **atualizados automaticamente** a cada nova release pelo GitHub Actions. Sempre apontam para a versão estável mais recente — sem precisar procurar na aba Releases.

---

## 🆕 O que há de novo na v4.7 (Cleanup Edition)

| Recurso | v4.6 | **v4.7** |
|---|:---:|:---:|
| 🧹 **Configuração unificada** | ❌ toggle de telemetria duplicado | **✅ só em Configurações** |
| 📋 **Relatórios de crash no UI** | ❌ só no sidebar | **✅ Configurações → Avançado** |
| 🔐 **Backup criptografado exposto** | ❌ IPC sem UI | **✅ botões Exportar/Importar** |
| 🗑️ **Código morto removido** | — | **✅ Vercel no-op + AI cron scripts** |
| 📏 **Sidebar mais enxuto** | 415 linhas | **✅ 331 linhas** |
| 🎯 **Crash reporter honesto** | no-op silencioso | **✅ local-only explícito** |

---

## 🆕 O que havia de novo na v2.0 (Shinobi Edition)

| Recurso | v1.4 | **v2.0** |
|---|:---:|:---:|
| 🥷 **Multi-conta isolada** | ❌ | **✅ até 8 simultâneas** |
| 🧹 **GC de memória inteligente** | ❌ | **✅ automático + manual (F8)** |
| ⏱️ **Lembretes de eventos** | ❌ | **✅ notificações nativas** |
| 📊 **Dashboard de contas** | ❌ | **✅ UI rica** |
| 🎨 **Identificação por cor** | ❌ | **✅ por perfil** |
| 🔒 Flash PPAPI + Privacy | ✅ | ✅ (mantido) |

---

## 🥷 Multi-conta isolada — como funciona

Cada conta que você cria ganha:
- Uma **session partition única** do Chromium (`persist:profile-<id>`)
- Cookies, localStorage, cache e service workers **100% isolados** das outras contas
- Uma janela de jogo independente, com a cor e o apelido que você escolheu

**Resultado:** jogue com 8 contas simultaneamente, sem uma sobrescrever a sessão da outra. Não há gerenciamento manual de cookies — o Chromium faz o isolamento nativamente.

---

## 🧹 Garbage Collector de memória inteligente

O Flash PPAPI + Chromium 87 (Electron 11) tem vazamento de memória crônico — após 1-2h o processo ultrapassa 1GB e trava. O **MemoryGuard** resolve:

1. **Daemon em background** monitora a RAM a cada 60s
2. Quando passa de **700MB** (configurável), dispara coleta em **3 camadas**:
   - JS `gc()` + limpeza de service worker caches
   - `session.clearCache()` + `clearStorageData(cachestorage)` por perfil
   - OS-level working set trim (Windows: `EmptyWorkingSet`)
3. Botão manual **F8** para limpeza sob demanda
4. **Gauge de RAM em tempo real** na dashboard

---

## 📦 Instalação

### Linux
```bash
# Baixe pelo botão acima, depois:
unzip naruto-online-linux.zip
chmod +x install.sh
./install.sh
```
O installer detecta sua distro (Arch, Ubuntu, Fedora, etc.) e instala dependências se faltar.

### Windows
Extraia o `.zip` e rode `NarutoOnline.exe` — sem instalação.

---

## ⌨️ Atalhos

| Tecla | Ação |
|-------|------|
| `Ctrl+N` | **Nova conta** (v2.0) |
| `F8` | **Forçar limpeza de memória** (v2.0) |
| `F5` | Limpar login da conta atual |
| `F11` | Tela cheia |
| `Ctrl+Shift+S` | Screenshot |
| `Ctrl+Shift+T` | Sempre no topo |
| `Ctrl++/-/0` | Zoom |

---

## 🛠️ Stack técnica

```
Shell:        Electron 11.5.0 (última com PPAPI Flash)
Flash:        Clean Flash PPAPI 34.0 (darktohka build)
Backend:      Node.js (main process) + Electron APIs
Multi-conta:  Session partitions isoladas
GC:           3-camadas (JS + session + OS working set)
UI Manager:   HTML/CSS/JS puro (zero framework)
Build:        electron-builder → AppImage + Portable EXE
CI/CD:        GitHub Actions (auto-update README links)
```

> **Por que Electron 11 e não Tauri?** Tauri 2.0 usa WebView2/WebKitGTK modernos que **removeram suporte a PPAPI** (Chrome 88+, 2021). Para Flash legado, Electron 11 é a única opção viável sem rebuild C++ massivo em CEF. O overhead do Electron é compensado pelo isolamento de partitions + MemoryGuard.

---

## 📜 Licença

MIT — livre para usar, modificar e distribuir. ⭐ Deixe uma star se ajudar!

<div align="center">
<sub>Feito com 🍥 pela comunidade Naruto Online BR • Sem afiliação com Oasis Games</sub>
</div>
