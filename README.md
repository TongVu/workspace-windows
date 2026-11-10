# Workspace Windows

Local GNOME Shell 50 extension for Ubuntu/Wayland. No background daemon, network access, additional runtime packages, or browser integration.

## Use

1. Press **Super+A** to open **Add to workspace**.
2. Check windows to add them; uncheck to remove them. **Each change saves immediately**—there are no Save or Cancel buttons. **Escape** closes the dialog without undoing changes. Tab/Space also work.
3. Later, press **Super+Space** to see **all assigned windows**, most recently used first.
4. The search field is focused automatically: **start typing** an application name or window title. **Enter** opens the first match; **Up/Down** changes the highlighted match. You can also click a result. **Escape** cancels.

Filtering is case-insensitive and matches substrings; multiple words must all occur somewhere in the application name/window title. Matches retain recent-use order. Clearing the field restores the full list. Digits are search text, not instant-selection shortcuts. With no matches, Enter does nothing.

Opening the switcher does not raise or restore any windows. Choosing an item brings **only that window** forward, unminimizing it if needed. Other windows remain untouched. Entries identify individual windows by application name and window title, so multiple windows from the same app remain distinguishable.

This acts on the **current GNOME desktop only**, across its monitors. Windows are not moved, resized, tiled, or reopened. Selections on other desktops are retained but not listed until you switch there. Always-on-top windows retain their special stacking behavior.

Assignments and recent-use order **survive screen lock/unlock**. GNOME temporarily disables user extensions on lock; the extension retains only plain window IDs/history while releasing all dialogs, signals, and shortcuts. On unlock it restores live assignments and drops windows that closed while locked.

Selection remains in memory for the current login and is cleared by manually disabling the extension while unlocked, logging out, or restarting Shell. This does not restore assignments across reboot/logout. Closed windows are also removed when the list is refreshed. A new window from the same app is not automatically selected. Recency is tracked by window focus, independently of unselected apps.

The workspace shortcuts work on the desktop and in the overview. **Super+A replaces GNOME’s Show Applications shortcut**, as requested. **Super+Space replaces the old Super+W binding and IBus input-method trigger**. Your existing GNOME input-source shortcuts (Super+Z / Shift+Super+Z on this machine) are unchanged. The old `workspace` and `add to workspace` search commands and the numbered-selection behavior are removed.

## Application shortcuts

All use Super without Shift:

- **Super+V** — VS Code
- **Super+E** — Microsoft Edge
- **Super+F** — Files (Nautilus)
- **Super+O** — Obsidian
- **Super+T** — Teams for Linux
- **Super+K** — Kitty

Launch the app if it has no normal windows; otherwise focus its most recently used window, restoring it if minimized. Unlike the assigned-window picker, these shortcuts work across desktops: they switch to the window's desktop without moving the window. They do not add windows to the working set.

Launchers come from the installed desktop entries. VS Code uses the standard launcher; the separate Personal VSC launcher/profile configuration is unchanged. Teams respects the existing user-local launcher override.

**Super+C is unchanged** (center window); no ChatGPT shortcut is installed. Super+V replaces its notification shortcut, but **Super+M** still opens notifications. Super+O replaces screen-rotation lock; the hardware rotation-lock key is preserved.

Manage these shortcuts in **Super+A → Application shortcuts**. Search for an installed app and choose it, enter a single letter (a–z), then select **Add shortcut**. Existing mappings appear with a **Remove** button. Changes take effect immediately. The dialog prevents duplicate app mappings and duplicate Super+letter keys. Up to 12 app shortcuts can be configured. Removing or changing a shortcut does not affect the working-set checkboxes above.

## Install

From this project directory:

```sh
bash install.sh
```

After installing a source-code update, log out and back in once. (Adding/removing an app mapping in Super+A takes effect immediately.) The installer preserves other extensions and does not restart the desktop. It removes only Super+A from GNOME’s `toggle-application-view` binding, preserving any other accelerators on that action.

The installer also removes only Super+Space from IBus triggers, preserving other triggers. Shortcut replacements persist when the extension is disabled. To restore IBus defaults after disabling the extension, use `gsettings reset org.freedesktop.ibus.general.hotkey triggers` (this resets that trigger list, including custom changes).

That Show Applications setting change is persistent, including when this extension is disabled. To restore GNOME’s default binding **after disabling this extension**:

```sh
gsettings reset org.gnome.shell.keybindings toggle-application-view
```

This resets that one action to its default shortcuts; it does not change other GNOME actions.

For app shortcuts, the installer also removes only Super+V from `org.gnome.shell.keybindings toggle-message-tray` and Super+O from `org.gnome.settings-daemon.plugins.media-keys rotate-video-lock-static`, preserving their alternative accelerators. It does not change Super+C. If reverting after disabling the extension, reset either of those individual keys to GNOME defaults (this also resets custom changes to that key).

Check activation:

```sh
gnome-extensions info workspace-windows@local
```

Expected: `Version: 8`, `Enabled: Yes`, `State: ACTIVE`.

Disable without deleting source:

```sh
gnome-extensions disable workspace-windows@local
```

## Verify

```sh
npm test
npm run check
bash tests/headless.sh
```

Unit checks use Node's built-in test runner; no `npm install` is needed. The headless integration test requires GNOME Shell 50, `dbus-run-session`, and system Python with PyGObject/GTK 4. It runs a separate Shell and disposable GTK windows under a private D-Bus session and temporary XDG/settings directories. All app launchers, including the test-only app added through Super+A, are shadowed with GTK fixtures; tests do not open actual browsers/editors/messengers or control the current desktop. Logs remain in the printed `/tmp/workspace-windows-test.*` directory.

Verified on this machine with GNOME Shell 50.1:

- Seventeen unit tests (including app alias/MRU/launch selection): selection/MRU, closed windows, desktop filtering, application/title filtering, multiple terms, digits, empty queries, and single-window activation.
- Actual Super+A and Super+Space key events, both from the desktop and overview.
- Automatic input focus, real typed filtering, clearing the query, no-match behavior, Up/Down/Enter, filtered pointer clicks, and Escape.
- Opening/filtering leaves stacking/minimized state unchanged; choosing restores only that window.
- Closed-window selection and empty sets are harmless; button-free assignment changes save before closing, and Escape does not revert them.
- Two lock/unlock session-mode cycles through the actual GNOME extension manager retain assignments/history, close dialogs, and remove shortcuts while locked. A window closed during lock is pruned on unlock. These tests simulate the session modes in the isolated Shell; they do not lock or authenticate the real desktop.
- Manual disable/re-enable still clears assignments and releases modal/keybinding resources.
- All six default app hotkeys launch the corresponding GTK fixture, then focus/unminimize its most recently used window without duplicate launches. Overview launch, cross-desktop focus, and no implicit workspace assignment also pass.
- Super+A searches installed test apps, adds one as Super+B, immediately registers and launches it, then removes it; working-set assignments remain unchanged.
- Actual installed desktop entries were resolved without launching the real apps; their real-session window matching still needs user verification.

Version 6 was observed active before the app-shortcut editor. Version 8 requires a logout/login to load the editor and a real-session check with installed applications.

## Implementation

- `extension.js`: workspace and app shortcut bindings, launch/focus, searchable switcher, assignment picker, focus tracking, lifecycle.
- `model.js`: selection, recency, filtering, and single-window activation.
- `schemas/`: workspace bindings and 12 configurable app-shortcut slots, compiled locally by the installer/test harness.
- `stylesheet.css`: picker and selected-result styling.

No overview search-provider integration remains. Compatibility is deliberately limited to GNOME 50 rather than claiming untested major versions.
