#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $(gnome-shell --version) != 'GNOME Shell 50.'* ]]; then
    printf 'This extension targets GNOME Shell 50. Installation stopped.\n' >&2
    exit 1
fi
uuid=workspace-windows@local
target="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
glib-compile-schemas --strict --dry-run schemas
install -d "$target/schemas"
install -m 644 metadata.json extension.js model.js stylesheet.css "$target/"
install -m 644 schemas/*.gschema.xml "$target/schemas/"
glib-compile-schemas --strict "$target/schemas"
# A running Wayland Shell may not know a newly installed UUID until login.
# Queue only this extension, preserving all other enabled/disabled choices.
/usr/bin/python3 - <<'PY'
from gi.repository import Gio
settings = Gio.Settings.new('org.gnome.shell')
uuid = 'workspace-windows@local'
enabled = settings.get_strv('enabled-extensions')
if uuid not in enabled:
    if not settings.set_strv('enabled-extensions', enabled + [uuid]):
        raise SystemExit('Could not enable extension in GNOME settings')
disabled = settings.get_strv('disabled-extensions')
if uuid in disabled:
    if not settings.set_strv('disabled-extensions', [item for item in disabled if item != uuid]):
        raise SystemExit('Could not remove extension from disabled list')
# User-authorized replacement of Show Applications. Preserve other accelerators.
shell_keys = Gio.Settings.new('org.gnome.shell.keybindings')
previous = shell_keys.get_strv('toggle-application-view')
replacement = [key for key in previous if key.lower() != '<super>a']
if replacement != previous:
    if not shell_keys.set_strv('toggle-application-view', replacement):
        raise SystemExit('Could not release Super+A from Show Applications')
    print('Removed Super+A from Show Applications; other shortcuts preserved.')
# User-authorized replacement of IBus input-method switching.
ibus_keys = Gio.Settings.new('org.freedesktop.ibus.general.hotkey')
triggers = ibus_keys.get_strv('triggers')
remaining = [key for key in triggers if key.lower() != '<super>space']
if remaining != triggers:
    if not ibus_keys.set_strv('triggers', remaining):
        raise SystemExit('Could not release Super+Space from IBus')
    print('Removed Super+Space from IBus; other triggers preserved.')
# App shortcuts replace only V/O, not Super+C or alternative accelerators.
for schema, action, accelerator in [
    ('org.gnome.shell.keybindings', 'toggle-message-tray', '<Super>v'),
    ('org.gnome.settings-daemon.plugins.media-keys', 'rotate-video-lock-static', '<Super>o'),
]:
    keys = Gio.Settings.new(schema)
    previous = keys.get_strv(action)
    remaining = [key for key in previous if key.lower() != accelerator.lower()]
    if remaining != previous:
        if not keys.set_strv(action, remaining):
            raise SystemExit(f'Could not release {accelerator} from {action}')
        print(f'Removed {accelerator} from {action}; alternatives preserved.')
Gio.Settings.sync()
if settings.get_boolean('disable-user-extensions'):
    print('Warning: user extensions are globally disabled. Enable them in Extensions first.')
PY
printf 'Installed to %s\nLog out and log back in to load the new extension/code.\n' "$target"
