#!/bin/bash
# =============================================================================
# Shinobi Launcher (Naruto Online) — Linux Uninstaller v2.0
#
# Robusto, seguro e transparente:
#   - Pede confirmação antes de remover
#   - Mata processos em execução (evita "arquivo ocupado")
#   - Mostra progresso passo-a-passo
#   - Registra log em ~/.local/share/naruto-online/uninstall.log
#   - Limpa TUDO: app, icons, desktop entry, Electron data, Flash config
#
# USO:
#   bash uninstall.sh              # interativo (pergunta confirmação)
#   bash uninstall.sh --yes        # não pergunta (para automação)
#   bash uninstall.sh --help       # ajuda
# =============================================================================

set -uo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────────
log_info()  { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ── Parse args ────────────────────────────────────────────────────────────────
ASSUME_YES=false
SHOW_HELP=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y|--force) ASSUME_YES=true ;;
    --help|-h)
      echo "用法：bash uninstall.sh [选项]"
      echo ""
      echo "选项："
      echo "  --yes, -y    不询问确认（用于自动化）"
      echo "  --help, -h   显示帮助"
      echo ""
      echo "完全移除 Naruto Online 启动器："
      echo "  - ~/.local/share/naruto-online/ 中的应用和可执行文件"
      echo "  - 应用菜单和桌面的 .desktop 快捷方式"
      echo "  - hicolor 主题图标"
      echo "  - Electron 数据（~/.config/Naruto Online/）"
      echo "  - 启动器配置（~/.config/naruto-online-launcher/）"
      echo "  - Flash mms.cfg 备份"
      exit 0
      ;;
  esac
done

# ── Detect real user (works with sudo) ──────────────────────────────────────
if [ -n "${SUDO_USER:-}" ]; then
  REAL_USER="$SUDO_USER"
  REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
  REAL_USER="$USER"
  REAL_HOME="${HOME:-/tmp}"
fi

# Safety: validate REAL_HOME is an absolute path
if [[ "$REAL_HOME" != /* ]]; then
  echo "错误：检测到无效 HOME（$REAL_HOME），为安全起见已中止。" >&2
  exit 1
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
LAUNCHER_NAME="naruto-online"
INSTALL_DIR="$REAL_HOME/.local/share/$LAUNCHER_NAME"
APPS_DIR="$REAL_HOME/.local/share/applications"
ICONS_BASE="$REAL_HOME/.local/share/icons"
BIN_DIR="$REAL_HOME/.local/bin"
DESKTOP_DIR="$REAL_HOME/Desktop"
PIXMAPS_DIR="$REAL_HOME/.local/share/pixmaps"

# Electron userData (cookies, cache, GPUCache, logs, config.json)
ELECTRON_DATA="$REAL_HOME/.config/Naruto Online"
# Launcher config dir
CONFIG_DIR="$REAL_HOME/.config/naruto-online-launcher"
LEGACY_CONFIG_DIR="$REAL_HOME/.config/naruto-online"
# Flash mms.cfg
FLASH_DIR="$REAL_HOME/.macromedia/Flash_Player"

LOG_FILE="$INSTALL_DIR/uninstall.log"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       🗑️  Naruto Online 启动器卸载程序      ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════╝${NC}\n"

echo "用户：$REAL_USER"
echo "Home:    $REAL_HOME"
echo ""

# ── Check if installed ───────────────────────────────────────────────────────
if [ ! -d "$INSTALL_DIR" ] && [ ! -f "$APPS_DIR/$LAUNCHER_NAME.desktop" ]; then
  log_warn "当前用户未安装 Naruto Online 启动器。"
  log_info "没有需要移除的内容。"
  exit 0
fi

# ── Confirmation ─────────────────────────────────────────────────────────────
if [ "$ASSUME_YES" = "false" ]; then
  echo -e "${YELLOW}以下 Naruto Online 启动器内容将被完全移除：${NC}"
  echo "  • 应用和可执行文件：$INSTALL_DIR"
  echo "  • 应用菜单和桌面的 .desktop 快捷方式"
  echo "  • hicolor 主题图标"
  echo "  • Electron 数据：$ELECTRON_DATA"
  echo "  • 启动器配置：$CONFIG_DIR"
  echo "  • Flash mms.cfg 备份"
  echo ""
  echo -e "${RED}⚠️  已保存的 Profile、Session 和本地数据将被删除。${NC}"
  echo -e "${YELLOW}如需迁移，请先使用启动器的 Profile 导出功能备份。${NC}"
  echo ""
  read -rp "确认卸载吗？输入 s 确认 [s/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[sS](im)?$ ]]; then
    log_info "用户取消了卸载。"
    exit 0
  fi
fi

# ── Inicia log ───────────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR" 2>/dev/null || true
{
  echo "=== Shinobi Launcher Uninstall Log ==="
  echo "Date: $(date -Iseconds)"
  echo "User: $REAL_USER"
  echo "Home: $REAL_HOME"
  echo ""
} > "$LOG_FILE"

log_step "1/5 — 停止正在运行的进程…"

# Mata processos do launcher (evita "arquivo ocupado" na remoção)
PIDS_KILLED=0
for proc_name in "naruto-online" "NarutoOnline" "Naruto Online"; do
  if command -v pkill &>/dev/null; then
    if pkill -f "$proc_name" 2>/dev/null; then
      PIDS_KILLED=$((PIDS_KILLED + 1))
      log_info "已终止进程：$proc_name"
      echo "[kill] $proc_name" >> "$LOG_FILE"
    fi
  fi
done

if [ "$PIDS_KILLED" -gt 0 ]; then
  sleep 2  # dá tempo do processo liberar arquivos
fi

log_step "2/5 — 移除快捷方式和图标…"

# Desktop entry (menu de aplicativos)
if [ -f "$APPS_DIR/$LAUNCHER_NAME.desktop" ]; then
  rm -f "$APPS_DIR/$LAUNCHER_NAME.desktop"
  log_info "已移除应用菜单快捷方式"
  echo "[rm] $APPS_DIR/$LAUNCHER_NAME.desktop" >> "$LOG_FILE"
fi

# Desktop shortcut (área de trabalho)
if [ -f "$DESKTOP_DIR/$LAUNCHER_NAME.desktop" ]; then
  rm -f "$DESKTOP_DIR/$LAUNCHER_NAME.desktop"
  log_info "已移除桌面快捷方式"
  echo "[rm] $DESKTOP_DIR/$LAUNCHER_NAME.desktop" >> "$LOG_FILE"
fi

# Ícones (hicolor theme — todos os tamanhos)
ICONS_REMOVED=0
for size in 16 24 32 48 64 128 256 512 scalable; do
  for icon_path in "$ICONS_BASE/hicolor/${size}x${size}/apps/$LAUNCHER_NAME.png" \
                   "$ICONS_BASE/hicolor/${size}/apps/$LAUNCHER_NAME.png"; do
    if [ -f "$icon_path" ]; then
      rm -f "$icon_path"
      ICONS_REMOVED=$((ICONS_REMOVED + 1))
      echo "[rm] $icon_path" >> "$LOG_FILE"
    fi
  done
done

# Ícone solto (fallback)
if [ -f "$ICONS_BASE/$LAUNCHER_NAME.png" ]; then
  rm -f "$ICONS_BASE/$LAUNCHER_NAME.png"
  ICONS_REMOVED=$((ICONS_REMOVED + 1))
  echo "[rm] $ICONS_BASE/$LAUNCHER_NAME.png" >> "$LOG_FILE"
fi

# Pixmaps (fallback antigo)
if [ -f "$PIXMAPS_DIR/$LAUNCHER_NAME.png" ]; then
  rm -f "$PIXMAPS_DIR/$LAUNCHER_NAME.png"
  ICONS_REMOVED=$((ICONS_REMOVED + 1))
  echo "[rm] $PIXMAPS_DIR/$LAUNCHER_NAME.png" >> "$LOG_FILE"
fi

if [ "$ICONS_REMOVED" -gt 0 ]; then
  log_info "已移除 $ICONS_REMOVED 个图标"
fi

# Atualiza caches de ícone e desktop
command -v gtk-update-icon-cache &>/dev/null && gtk-update-icon-cache -f -t "$ICONS_BASE/hicolor" 2>/dev/null || true
command -v update-desktop-database &>/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true

# Bin symlink (comando terminal)
if [ -L "$BIN_DIR/$LAUNCHER_NAME" ] || [ -f "$BIN_DIR/$LAUNCHER_NAME" ]; then
  rm -f "$BIN_DIR/$LAUNCHER_NAME"
  log_info "已移除终端命令 naruto-online"
  echo "[rm] $BIN_DIR/$LAUNCHER_NAME" >> "$LOG_FILE"
fi

log_step "3/5 — 移除应用…"

# Diretório de instalação (AppImage + run.sh + uninstall.sh + logs)
if [ -d "$INSTALL_DIR" ]; then
  # Preserva o log movendo para /tmp antes de remover o dir
  if [ -f "$LOG_FILE" ]; then
    cp "$LOG_FILE" "/tmp/shinobi-uninstall-$(date +%s).log" 2>/dev/null || true
  fi
  rm -rf "$INSTALL_DIR"
  log_info "已移除：$INSTALL_DIR"
  echo "[rm -rf] $INSTALL_DIR" >> "/tmp/shinobi-uninstall-last.log" 2>/dev/null || true
fi

log_step "4/5 — 移除 Electron 数据…"

# Electron userData (cookies, cache, GPUCache, logs, config.json, profiles)
if [ -d "$ELECTRON_DATA" ]; then
  rm -rf "$ELECTRON_DATA"
  log_info "已移除：$ELECTRON_DATA（Profile、Cookie、缓存）"
  echo "[rm -rf] $ELECTRON_DATA" >> "/tmp/shinobi-uninstall-last.log" 2>/dev/null || true
fi

# Config dirs do launcher (old e new paths)
if [ -d "$CONFIG_DIR" ]; then
  rm -rf "$CONFIG_DIR"
  log_info "已移除：$CONFIG_DIR"
  echo "[rm -rf] $CONFIG_DIR" >> "/tmp/shinobi-uninstall-last.log" 2>/dev/null || true
fi

if [ -d "$LEGACY_CONFIG_DIR" ] && [ "$LEGACY_CONFIG_DIR" != "$CONFIG_DIR" ]; then
  rm -rf "$LEGACY_CONFIG_DIR"
  log_info "已移除旧配置目录：$LEGACY_CONFIG_DIR"
  echo "[rm -rf] $LEGACY_CONFIG_DIR" >> "/tmp/shinobi-uninstall-last.log" 2>/dev/null || true
fi

log_step "5/5 — 清理 Flash 配置…"

# Backup do mms.cfg (criado pelo launcher a cada boot)
if [ -f "$FLASH_DIR/mms.cfg.bak" ]; then
  rm -f "$FLASH_DIR/mms.cfg.bak"
  log_info "已移除 Flash 的 mms.cfg.bak 备份"
  echo "[rm] $FLASH_DIR/mms.cfg.bak" >> "/tmp/shinobi-uninstall-last.log" 2>/dev/null || true
fi

# ── Resumo final ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       ✅ Naruto Online 启动器已卸载！       ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "已移除："
echo "  • 应用和可执行文件"
echo "  • 应用菜单和桌面快捷方式"
echo "  • 图标"
echo "  • Electron 数据（Profile、Cookie、缓存）"
echo "  • 启动器配置"
echo "  • Flash mms.cfg 备份"
echo ""
echo -e "${YELLOW}卸载日志保存在：/tmp/shinobi-uninstall-*.log${NC}"
echo ""
