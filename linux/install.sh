#!/bin/bash
# =============================================================================
# Naruto Online Launcher — Linux Installer
# Compatible with: Arch Linux, Ubuntu, Fedora, Debian, openSUSE, Pop!_OS
# Requires: AppImage file in the same directory
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────────
log_info()  { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_NAME="naruto-online"
INSTALL_DIR="$HOME/.local/share/$LAUNCHER_NAME"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICONS_BASE="$HOME/.local/share/icons"
CONFIG_DIR="$HOME/.config/$LAUNCHER_NAME-launcher"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║       🍥 Naruto Online 启动器安装程序       ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════╝${NC}\n"

# ── Check if running interactively ───────────────────────────────────────────
if [ ! -t 0 ]; then
  log_error "安装脚本必须在交互式终端中运行。"
  log_error "请执行：bash $0"
  exit 1
fi

# ── Detect real user (works with sudo) ──────────────────────────────────────
if [ -n "${SUDO_USER:-}" ]; then
  REAL_USER="$SUDO_USER"
  REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
  log_warn "检测到 sudo，将为用户 $REAL_USER 安装。"
  INSTALL_DIR="$REAL_HOME/.local/share/$LAUNCHER_NAME"
  BIN_DIR="$REAL_HOME/.local/bin"
  APPS_DIR="$REAL_HOME/.local/share/applications"
  ICONS_BASE="$REAL_HOME/.local/share/icons"
  CONFIG_DIR="$REAL_HOME/.config/$LAUNCHER_NAME-launcher"
else
  REAL_USER="$USER"
  REAL_HOME="$HOME"
fi

# =============================================================================
# Step 1: Find AppImage
# =============================================================================
log_step "1/7 — 查找 AppImage…"

APPIMAGE=""
for f in "$SCRIPT_DIR"/*.AppImage; do
  [ -f "$f" ] && APPIMAGE="$f" && break
done

if [ -z "$APPIMAGE" ]; then
  log_error "未在以下目录找到 .AppImage 文件："
  log_error "  $SCRIPT_DIR/"
  echo ""
  log_error "请从以下地址下载 AppImage："
  echo -e "  ${CYAN}https://github.com/ArcherSore/naruto-online-launcher/releases${NC}"
  echo ""
  log_error "下载后请将其放到本脚本所在目录。"
  exit 1
fi

APPIMAGE_NAME=$(basename "$APPIMAGE")
APPIMAGE_SIZE=$(du -h "$APPIMAGE" | cut -f1)
log_info "已找到 AppImage：$APPIMAGE_NAME（$APPIMAGE_SIZE）"

# =============================================================================
# Step 2: Detect distribution and check dependencies
# =============================================================================
log_step "2/7 — 检查依赖…"

# Detect distro
DISTRO="unknown"
DISTRO_VERSION=""

if [ -f /etc/os-release ]; then
  DISTRO=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' || echo "unknown")
  DISTRO_VERSION=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"' || echo "")
fi

log_info "检测到发行版：$DISTRO ${DISTRO_VERSION}"

# Check for required commands
check_command() {
  if command -v "$1" &>/dev/null; then
    return 0
  fi
  return 1
}

# Missing dependencies tracker
MISSING_DEPS=()

# ── FUSE status (informational only — no longer required) ──────────────────
FUSE_AVAILABLE=false
if [ -f /dev/fuse ] || check_command fusermount; then
  FUSE_AVAILABLE=true
  log_info "FUSE 可用（当前安装会解压 AppImage，不依赖 FUSE）"
else
  log_info "未找到 FUSE（不影响安装，AppImage 将被解压）"
fi

# ── Check dependencies by distro ───────────────────────────────────────────
install_deps() {
  local pkg_manager="$1"
  shift
  local packages=("$@")

  echo ""
  log_warn "缺少依赖：${packages[*]}"
  echo ""
  read -rp "$(echo -e "${YELLOW}[?] 现在安装依赖吗？[y/N]：${NC}")" INSTALL_DEPS

  if [[ "$INSTALL_DEPS" =~ ^[sSyY]$ ]]; then
    case "$pkg_manager" in
      pacman)
        sudo pacman -S --noconfirm "${packages[@]}"
        ;;
      apt)
        sudo apt-get update && sudo apt-get install -y "${packages[@]}"
        ;;
      dnf)
        sudo dnf install -y "${packages[@]}"
        ;;
      zypper)
        sudo zypper install -y "${packages[@]}"
        ;;
      *)
        log_error "不支持此包管理器：$pkg_manager"
        log_error "请手动安装：${packages[*]}"
        return 1
        ;;
    esac
  else
    log_error "缺少必需依赖，安装已中止。"
    exit 1
  fi
}

case "$DISTRO" in
  arch*|manjaro*|endeavouros*|garuda*|cachyos*|steamos*)
    PKG_MGR="pacman"
    check_command gtk-launch || MISSING_DEPS+=("gtk3")
    check_command notify-send || MISSING_DEPS+=("libnotify")
    check_command xdg-open || MISSING_DEPS+=("xdg-utils")
    # Optional: gamemode
    if ! check_command gamemoderun; then
      log_info "未安装 gamemode（可选，可改善性能）"
    fi
    ;;
  ubuntu*|pop*|linuxmint*|debian*|elementary*)
    PKG_MGR="apt"
    check_command gtk-launch || MISSING_DEPS+=("libgtk-3-0")
    check_command notify-send || MISSING_DEPS+=("libnotify-bin")
    check_command xdg-open || MISSING_DEPS+=("xdg-utils")
    ;;
  fedora*)
    PKG_MGR="dnf"
    check_command gtk-launch || MISSING_DEPS+=("gtk3")
    check_command notify-send || MISSING_DEPS+=("libnotify")
    check_command xdg-open || MISSING_DEPS+=("xdg-utils")
    ;;
  opensuse*|tumbleweed*)
    PKG_MGR="zypper"
    check_command gtk-launch || MISSING_DEPS+=("gtk3")
    check_command notify-send || MISSING_DEPS+=("libnotify-tools")
    check_command xdg-open || MISSING_DEPS+=("xdg-utils")
    ;;
  *)
    log_warn "无法识别发行版：$DISTRO"
    log_warn "正在检查通用依赖…"
    check_command gtk-launch || MISSING_DEPS+=("gtk3")
    check_command notify-send || MISSING_DEPS+=("libnotify")
    check_command xdg-open || MISSING_DEPS+=("xdg-utils")
    PKG_MGR="unknown"
    ;;
esac

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  if [ "$PKG_MGR" = "unknown" ]; then
    log_error "仍缺少依赖，请手动安装：${MISSING_DEPS[*]}"
    read -rp "$(echo -e "${YELLOW}[?] 仍要继续吗？[y/N]：${NC}")" CONTINUE
    if [[ ! "$CONTINUE" =~ ^[sSyY]$ ]]; then
      exit 1
    fi
  else
    install_deps "$PKG_MGR" "${MISSING_DEPS[@]}"
  fi
fi

log_info "依赖检查通过"

# =============================================================================
# Step 3: Check for existing installation
# =============================================================================
log_step "3/7 — 检查现有安装…"

if [ -d "$INSTALL_DIR" ]; then
  log_warn "检测到现有安装：$INSTALL_DIR"
  read -rp "$(echo -e "${YELLOW}[?] 替换现有安装吗？[y/N]：${NC}")" REPLACE
  if [[ "$REPLACE" =~ ^[sSyY]$ ]]; then
    log_info "正在移除现有安装…"
    rm -rf "$INSTALL_DIR"
  else
    log_error "用户取消了安装。"
    exit 0
  fi
fi

# =============================================================================
# Step 4: Install AppImage
# =============================================================================
log_step "4/7 — 安装应用…"

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$APPS_DIR"
mkdir -p "$CONFIG_DIR/logs"

# Copy AppImage
log_info "正在复制 AppImage…"
cp "$APPIMAGE" "$INSTALL_DIR/$APPIMAGE_NAME"
chmod +x "$INSTALL_DIR/$APPIMAGE_NAME"

# Hide game thumbnail/preview images (dotfiles invisible in file managers)
shopt -s nullglob dotglob 2>/dev/null || true
for img in "$INSTALL_DIR"/*.png "$INSTALL_DIR"/*.jpg "$INSTALL_DIR"/*.jpeg "$INSTALL_DIR"/*.gif "$INSTALL_DIR"/*.webp; do
  [ -f "$img" ] || continue
  bname="$(basename "$img")"
  [ "$bname" = "icon.png" ] && continue
  mv "$img" "$INSTALL_DIR/.$bname" 2>/dev/null || true
done
shopt -u nullglob dotglob 2>/dev/null || true

# ── Always extract AppImage (faster startup, no FUSE dependency) ────────────
# Extracting the AppImage means:
#   - Zero FUSE dependency (works on every Linux)
#   - ~0ms startup overhead (direct AppRun vs 2-5s FUSE mount)
#   - Single execution path (no FUSE conditional in run.sh)
# Trade-off: +150MB disk space (irrelevant in 2026)
log_info "正在解压 AppImage（可加快启动）…"
"$INSTALL_DIR/$APPIMAGE_NAME" --appimage-extract >/dev/null 2>&1
rm -rf "$INSTALL_DIR/squashfs-root"
mv squashfs-root "$INSTALL_DIR/squashfs-root"
chmod +x "$INSTALL_DIR/squashfs-root/AppRun" 2>/dev/null || true
rm -f "$INSTALL_DIR/$APPIMAGE_NAME"  # Delete the .AppImage — no longer needed
USE_EXTRACTED=true
log_info "AppImage 解压成功"
log_info "已移除压缩 AppImage（约节省 150MB）"

# =============================================================================
# Step 5: Install icons (hicolor theme — GNOME/KDE/XFCE standard)
# =============================================================================
log_step "5/7 — 安装图标…"

ICON_SRC=""

# Find icon source
for candidate in \
  "$SCRIPT_DIR/icon.png" \
  "$SCRIPT_DIR/../assets/icon.png" \
  "$SCRIPT_DIR/../linux/icon.png"; do
  if [ -f "$candidate" ]; then
    ICON_SRC="$candidate"
    break
  fi
done

# Fallback: extract icon from AppImage (.DirIcon or embedded .png)
if [ -z "$ICON_SRC" ] && [ -f "$APPIMAGE" ]; then
  log_info "正在从 AppImage 提取图标…"
  EXTRACT_DIR=$(mktemp -d)
  if "$APPIMAGE" --appimage-extract "*.DirIcon" >/dev/null 2>&1 || \
     "$APPIMAGE" --appimage-extract "naruto-online.png" >/dev/null 2>&1; then
    # Look in squashfs-root (created in cwd)
    for ic in squashfs-root/.DirIcon squashfs-root/naruto-online.png; do
      if [ -f "$ic" ]; then
        mv "$ic" "$EXTRACT_DIR/icon.png" 2>/dev/null && ICON_SRC="$EXTRACT_DIR/icon.png"
        break
      fi
    done
    # Also check for any .png icon in the root
    if [ -z "$ICON_SRC" ] && [ -d squashfs-root ]; then
      for ic in squashfs-root/*.png; do
        if [ -f "$ic" ] && [ "$(basename "$ic")" != "electron.png" ]; then
          ICON_SRC="$ic"
          break
        fi
      done
    fi
    rm -rf squashfs-root 2>/dev/null || true
  fi
  # Cleanup temp if icon was found
  if [ -n "$ICON_SRC" ] && [ -d "$EXTRACT_DIR" ] && [ "$ICON_SRC" = "$EXTRACT_DIR/icon.png" ]; then
    # Keep it for now, cleanup later
    :
  else
    rm -rf "$EXTRACT_DIR" 2>/dev/null || true
  fi
fi

# Final fallback: download icon from GitHub
if [ -z "$ICON_SRC" ]; then
  log_info "正在从 GitHub 下载图标…"
  curl -sL "https://raw.githubusercontent.com/ArcherSore/naruto-online-launcher/main/assets/icon.png" \
    -o /tmp/naruto-icon.png 2>/dev/null
  if [ -f /tmp/naruto-icon.png ] && [ "$(wc -c < /tmp/naruto-icon.png 2>/dev/null || echo 0)" -gt 1000 ]; then
    ICON_SRC="/tmp/naruto-icon.png"
  fi
fi

if [ -n "$ICON_SRC" ]; then
  log_info "图标来源：$ICON_SRC"

  # Install multiple sizes into hicolor icon theme
  # GNOME, KDE, XFCE all respect ~/.local/share/icons/hicolor/
  ICON_SIZES=(16 24 32 48 64 128 256)
  INSTALLED_SIZES=()

  for size in "${ICON_SIZES[@]}"; do
    ICON_DIR="$ICONS_BASE/hicolor/${size}x${size}/apps"
    mkdir -p "$ICON_DIR"

    if command -v convert &>/dev/null; then
      # Use ImageMagick for high-quality resize
      convert "$ICON_SRC" -resize "${size}x${size}" "$ICON_DIR/$LAUNCHER_NAME.png" 2>/dev/null && \
        INSTALLED_SIZES+=("${size}x${size}")
    elif command -v rsvg-convert &>/dev/null; then
      # Use rsvg-convert (librsvg)
      rsvg-convert -w "$size" -h "$size" -o "$ICON_DIR/$LAUNCHER_NAME.png" "$ICON_SRC" 2>/dev/null && \
        INSTALLED_SIZES+=("${size}x${size}")
    else
      # Fallback: copy original to 128x128
      if [ "$size" -eq 128 ]; then
        cp "$ICON_SRC" "$ICON_DIR/$LAUNCHER_NAME.png"
        INSTALLED_SIZES+=("${size}x${size}")
      fi
    fi
  done

  # Also install to scalable for high-DPI
  SCALABLE_DIR="$ICONS_BASE/hicolor/scalable/apps"
  mkdir -p "$SCALABLE_DIR"
  if [ -f "$ICON_SRC" ]; then
    # Try to create SVG from PNG (fallback: copy PNG)
    cp "$ICON_SRC" "$SCALABLE_DIR/$LAUNCHER_NAME.png"
  fi

  if [ ${#INSTALLED_SIZES[@]} -gt 0 ]; then
    log_info "已安装图标尺寸：${INSTALLED_SIZES[*]}"
  else
    log_warn "未找到图像转换工具（ImageMagick/rsvg-convert）"
    log_info "已直接复制原始图标"
    cp "$ICON_SRC" "$ICONS_BASE/$LAUNCHER_NAME.png"
  fi
else
  log_warn "未找到图标，跳过图标安装"
fi

# Update icon caches
if command -v gtk-update-icon-cache &>/dev/null; then
  gtk-update-icon-cache -f -t "$ICONS_BASE/hicolor" 2>/dev/null || true
fi
if command -v update-icon-caches &>/dev/null; then
  update-icon-caches "$ICONS_BASE/hicolor" 2>/dev/null || true
fi

# pixmaps fallback — universal last-resort for all DEs (LXQt, XFCE, MATE, etc.)
if [ -n "$ICON_SRC" ] && [ -f "$ICON_SRC" ]; then
  mkdir -p "$REAL_HOME/.local/share/pixmaps"
  cp "$ICON_SRC" "$REAL_HOME/.local/share/pixmaps/$LAUNCHER_NAME.png"
  log_info "图标已安装到 pixmaps/（通用回退）"
fi

# Cleanup temp icon extraction directory
if [ -n "${EXTRACT_DIR:-}" ] && [ -d "$EXTRACT_DIR" ]; then
  rm -rf "$EXTRACT_DIR" 2>/dev/null || true
fi

# =============================================================================
# Step 6: Create .desktop file
# =============================================================================
log_step "6/7 — 创建应用菜单快捷方式…"

# Determine executable path — always use run.sh wrapper
EXEC_PATH="$INSTALL_DIR/run.sh"

# Generate run.sh — the ONLY way to launch (handles env + flags correctly)
cat > "$INSTALL_DIR/run.sh" << RUNEOF
#!/bin/bash
# Naruto Online Launcher - Run Script
# Auto-generated by install.sh
set -euo pipefail

LAUNCHER_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Find AppImage (or AppRun if extracted)
APPIMAGE=""
if [ -x "\$LAUNCHER_DIR/squashfs-root/AppRun" ]; then
  APPIMAGE="\$LAUNCHER_DIR/squashfs-root/AppRun"
  export APPDIR="\$LAUNCHER_DIR/squashfs-root"
else
  for f in "\$LAUNCHER_DIR"/*.AppImage; do
    [ -f "\$f" ] && APPIMAGE="\$f" && break
  done
fi

if [ -z "\$APPIMAGE" ]; then
  echo "错误：在 \$LAUNCHER_DIR 中未找到 Naruto Online 启动器。" >&2
  echo "请重新运行安装脚本。" >&2
  exit 1
fi

chmod +x "\$APPIMAGE" 2>/dev/null || true

# Wayland → XWayland (Electron 11 requires X11)
if [ "\${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "\${WAYLAND_DISPLAY:-}" ]; then
  export XDG_SESSION_TYPE=x11
  export GDK_BACKEND=x11
  export SDL_VIDEODRIVER=x11
  export QT_QPA_PLATFORM=xcb
fi

# Launch — --no-sandbox is the only required flag
# If running from .AppImage, use --appimage-extract-and-run to avoid FUSE
# gamemoderun is optional and wraps the binary transparently
if [[ "\$APPIMAGE" == *.AppImage ]]; then
  if command -v gamemoderun &>/dev/null; then
    exec gamemoderun "\$APPIMAGE" --appimage-extract-and-run --no-sandbox "\$@"
  else
    exec "\$APPIMAGE" --appimage-extract-and-run --no-sandbox "\$@"
  fi
else
  if command -v gamemoderun &>/dev/null; then
    exec gamemoderun "\$APPIMAGE" --no-sandbox "\$@"
  else
    exec "\$APPIMAGE" --no-sandbox "\$@"
  fi
fi
RUNEOF
chmod +x "$INSTALL_DIR/run.sh"

# Copy uninstall script (robust version from linux/uninstall.sh)
# v3.5: uninstaller bundled together with installer — single source of truth
if [ -f "$SCRIPT_DIR/uninstall.sh" ]; then
  cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
elif [ -f "$SCRIPT_DIR/../linux/uninstall.sh" ]; then
  # Fallback: procurar em linux/ (caso rode do repo clonado)
  cp "$SCRIPT_DIR/../linux/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
else
  log_warn "未找到 uninstall.sh，不会安装卸载脚本。"
fi
chmod +x "$INSTALL_DIR/uninstall.sh" 2>/dev/null || true
log_info "卸载脚本已安装：$INSTALL_DIR/uninstall.sh"

# Create proper .desktop entry
# Using Icon= naruto-online (without path) for hicolor theme lookup
# v3.5: adicionada action Uninstall (usuário pode desinstalar pelo menu)
DESKTOP_FILE="$APPS_DIR/$LAUNCHER_NAME.desktop"
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.1
Type=Application
Name=Naruto Online
Comment=使用 Flash PPAPI 运行 Naruto Online
GenericName=游戏启动器
Exec="$EXEC_PATH"
Icon=$LAUNCHER_NAME
Terminal=false
StartupNotify=true
StartupWMClass=Naruto Online
Categories=Game;RolePlaying;
Keywords=game;naruto;flash;browser;mmo;
MimeType=x-scheme-handler/naruto-online;
Actions=Uninstall;

[Desktop Action Uninstall]
Name=卸载 Naruto Online 启动器
Name[zh_CN]=卸载 Naruto Online 启动器
Exec=sh -c 'bash "$INSTALL_DIR/uninstall.sh" ; read -p "按 ENTER 键关闭…"'
Icon=edit-delete
Terminal=true
EOF
chmod +x "$DESKTOP_FILE"

# Desktop shortcut (GNOME 42+ requires manual trust)
if [ -d "$REAL_HOME/Desktop" ]; then
  cp "$DESKTOP_FILE" "$REAL_HOME/Desktop/$LAUNCHER_NAME.desktop"
  chmod +x "$REAL_HOME/Desktop/$LAUNCHER_NAME.desktop"
  # Mark as trusted for GNOME
  if command -v gio &>/dev/null; then
    gio set "$REAL_HOME/Desktop/$LAUNCHER_NAME.desktop" metadata::trusted true 2>/dev/null || true
  fi
fi

# Update desktop database
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi

log_info "已创建快捷方式：$LAUNCHER_NAME.desktop"

# =============================================================================
# Step 7: Final summary
# =============================================================================
log_step "7/7 — 完成安装…"

# Create a simple launcher bin symlink (optional, for terminal access)
if [ ! -f "$BIN_DIR/naruto-online" ]; then
  ln -sf "$EXEC_PATH" "$BIN_DIR/naruto-online" 2>/dev/null || true
  log_info "已创建终端命令：naruto-online"
fi

# Ensure shell picks up ~/.local/bin
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  log_warn "请将 ~/.local/bin 添加到 PATH："
  case "$SHELL" in
    */zsh)
      echo -e "  ${CYAN}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc${NC}"
      echo -e "  ${CYAN}source ~/.zshrc${NC}"
      ;;
    */bash)
      echo -e "  ${CYAN}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc${NC}"
      echo -e "  ${CYAN}source ~/.bashrc${NC}"
      ;;
    *)
      echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
      ;;
  esac
fi

echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║             ✅ 安装成功！                  ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🎮 ${BOLD}启动：${NC}在应用菜单中搜索 \"Naruto Online\""
echo -e "  🖥️  ${BOLD}终端：${NC}${CYAN}naruto-online${NC}"
echo ""
echo -e "  ${YELLOW}🗑️  ${BOLD}卸载方式：${NC}"
echo -e "     ${BOLD}1.${NC} 应用菜单 → 右键 \"Naruto Online\" → \"卸载\""
echo -e "     ${BOLD}2.${NC} 终端：${CYAN}bash $INSTALL_DIR/uninstall.sh${NC}"
echo -e "     ${BOLD}3.${NC} 非交互：${CYAN}bash $INSTALL_DIR/uninstall.sh --yes${NC}"
echo ""
echo -e "  📁 ${BOLD}安装目录：${NC}$INSTALL_DIR"
echo -e "  📂 ${BOLD}游戏数据：${NC}$CONFIG_DIR"
echo ""
