#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export WORKSPACE_TEST_SOURCE="$PWD"
export WORKSPACE_TEST_ROOT
WORKSPACE_TEST_ROOT=$(mktemp -d /tmp/workspace-windows-test.XXXXXX)
export WORKSPACE_TEST_RESULT="$WORKSPACE_TEST_ROOT/result.txt"
export XDG_CONFIG_HOME="$WORKSPACE_TEST_ROOT/config"
export XDG_DATA_HOME="$WORKSPACE_TEST_ROOT/data"
export XDG_CACHE_HOME="$WORKSPACE_TEST_ROOT/cache"
export XDG_STATE_HOME="$WORKSPACE_TEST_ROOT/state"
export XDG_RUNTIME_DIR="$WORKSPACE_TEST_ROOT/runtime"
export GSETTINGS_BACKEND=keyfile
export LIBGL_ALWAYS_SOFTWARE=1
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extensions/workspace-windows@local" "$extensions/workspace-test@local"
cp metadata.json extension.js model.js stylesheet.css "$extensions/workspace-windows@local/"
cp -r schemas "$extensions/workspace-windows@local/"
glib-compile-schemas --strict "$extensions/workspace-windows@local/schemas"
cp tests/headless-driver.js "$extensions/workspace-test@local/extension.js"
printf '%s\n' '{"uuid":"workspace-test@local","name":"Test driver","description":"Isolated test driver","shell-version":["50"]}' > "$extensions/workspace-test@local/metadata.json"
# Shadow all six launchers with harmless GTK fixtures on this private desktop.
# No browser, editor, terminal or messenger from the real session is launched.
/usr/bin/python3 - <<'PY'
import os
from pathlib import Path
applications = Path(os.environ['XDG_DATA_HOME']) / 'applications'
applications.mkdir(parents=True)
for name, desktop in [
    ('vscode', 'com.microsoft.VSCode'), ('edge', 'microsoft-edge'),
    ('files', 'org.gnome.Nautilus'), ('obsidian', 'md.obsidian.Obsidian'),
    ('teams', 'teams-for-linux'), ('kitty', 'kitty'),
    ('newapp', 'local.workspace.launcher.newapp'),
]:
    app_id = f'local.workspace.launcher.{name}'
    script = Path(os.environ['WORKSPACE_TEST_SOURCE']) / 'tests/launcher.py'
    (applications / f'{desktop}.desktop').write_text(
        f'[Desktop Entry]\nType=Application\nName=Test {name}\n'
        f'Exec=/usr/bin/python3 "{script}" {app_id}\nStartupWMClass={app_id}\n')
PY
printf 'Test logs: %s\n' "$WORKSPACE_TEST_ROOT"
timeout 60s dbus-run-session -- bash -eu -c '
    unset DISPLAY WAYLAND_DISPLAY
    gsettings set org.gnome.shell enabled-extensions "[\"workspace-windows@local\", \"workspace-test@local\"]"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell.keybindings toggle-application-view "[]"
    gsettings set org.freedesktop.ibus.general.hotkey triggers "[]"
    gsettings set org.gnome.desktop.wm.keybindings switch-input-source "[]"
    gsettings set org.gnome.shell.keybindings toggle-message-tray "[\"<Super>m\"]"
    gsettings set org.gnome.settings-daemon.plugins.media-keys rotate-video-lock-static "[\"XF86RotationLockToggle\"]"
    gnome-shell --headless --no-x11 --virtual-monitor 1280x800 --wayland-display workspace-test --mode=user > "$WORKSPACE_TEST_ROOT/shell.log" 2>&1 &
    shell_pid=$!
    app_pid=""
    trap '\''kill ${app_pid:-} "$shell_pid" 2>/dev/null || true'\'' EXIT
    for i in {1..100}; do
        test -S "$XDG_RUNTIME_DIR/workspace-test" && break
        kill -0 "$shell_pid" || exit 1
        sleep 0.1
    done
    WAYLAND_DISPLAY=workspace-test /usr/bin/python3 "$WORKSPACE_TEST_SOURCE/tests/windows.py" > "$WORKSPACE_TEST_ROOT/windows.log" 2>&1 &
    app_pid=$!
    for i in {1..450}; do
        test -f "$WORKSPACE_TEST_RESULT" && break
        kill -0 "$shell_pid" || exit 1
        sleep 0.1
    done
    test -f "$WORKSPACE_TEST_RESULT"
'
python3 - "$WORKSPACE_TEST_RESULT" <<'PY'
import pathlib
import sys
result = pathlib.Path(sys.argv[1]).read_text()
print(result)
sys.exit(0 if result.startswith('PASS:') else 1)
PY
