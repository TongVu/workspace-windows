import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as CheckBox from 'resource:///org/gnome/shell/ui/checkBox.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {WorkingSet, filterWindows, activateWindow, findAppTarget} from './model.js';

const APP_SHORTCUT_SLOTS = Array.from({length: 12}, (_, index) => index + 1);

export default class WorkspaceWindowsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._bindings = [];
        const liveIds = this._allWindows().map(window => window.get_id());
        this._workingSet = this._lockedWorkingSet ?? new WorkingSet(liveIds);
        this._lockedWorkingSet = null;
        this._workingSet.sync(liveIds);
        this._focusId = global.display.connect('notify::focus-window', () => {
            const window = global.display.focus_window;
            if (window && !window.skip_taskbar)
                this._workingSet.focus(window.get_id());
        });
        try {
            for (const [name, action] of [
                ['show-workspace-windows', () => this._showSwitcher()],
                ['assign-workspace-windows', () => this._showPicker()],
                ...APP_SHORTCUT_SLOTS.map(slot => [this._appKey(slot), () => this._launchConfiguredApp(slot)]),
            ]) {
                const binding = Main.wm.addKeybinding(
                    name, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                    () => this._afterOverview(action));
                if (binding === Meta.KeyBindingAction.NONE)
                    throw new Error(`Could not register ${name}`);
                this._bindings.push(name);
            }
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        for (const name of this._bindings ?? [])
            Main.wm.removeKeybinding(name);
        this._bindings = [];
        this._settings = null;
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = 0;
        }
        if (this._dialog) {
            this._dialog.popModal();
            this._dialog.destroy();
            this._dialog = null;
        }
        // GNOME temporarily disables user extensions on screen lock. Retain
        // only plain window IDs/recency, never actors, signals, or input grabs.
        this._lockedWorkingSet = Main.sessionMode.isLocked
            ? this._workingSet ?? this._lockedWorkingSet : null;
        this._workingSet = null;
    }

    _allWindows() {
        return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(window => !window.skip_taskbar);
    }

    _appKey(slot) {
        return `app-shortcut-key-${slot}`;
    }

    _appIdKey(slot) {
        return `app-shortcut-app-${slot}`;
    }

    _launchConfiguredApp(slot) {
        const desktopId = this._settings.get_string(this._appIdKey(slot));
        this._launchOrFocusApp([desktopId]);
    }

    _refreshAppBinding(slot) {
        const name = this._appKey(slot);
        Main.wm.removeKeybinding(name);
        const action = Main.wm.addKeybinding(
            name, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._launchConfiguredApp(slot));
        if (action === Meta.KeyBindingAction.NONE)
            return false;
        if (!this._bindings.includes(name))
            this._bindings.push(name);
        return true;
    }

    _launchOrFocusApp(desktopIds) {
        const appSystem = Shell.AppSystem.get_default();
        const apps = desktopIds.map(id => id ? appSystem.lookup_app(id) : null).filter(Boolean);
        this._workingSet.sync(this._allWindows().map(window => window.get_id()));
        const target = findAppTarget(apps, this._workingSet.order);
        if (!target) {
            Main.notify('Workspace Windows', `Application not found: ${desktopIds[0]}`);
            return;
        }
        const timestamp = global.get_current_time();
        try {
            if (target.window) {
                if (target.window.minimized)
                    target.window.unminimize();
                // Unlike the working-set picker, app shortcuts work across
                // desktops: switch to the window, never move it here.
                Main.activateWindow(target.window, timestamp);
            } else {
                target.app.activate();
            }
        } catch (error) {
            console.error(error);
            Main.notify('Workspace Windows', `Could not open ${desktopIds[0]}`);
        }
    }

    _currentWindows() {
        const all = this._allWindows();
        this._workingSet.sync(all.map(window => window.get_id()));
        const workspace = global.workspace_manager.get_active_workspace();
        return all.filter(window => window.located_on_workspace(workspace));
    }

    _afterOverview(action) {
        if (!Main.overview.visible) {
            action();
            return;
        }
        if (this._overviewHiddenId)
            Main.overview.disconnect(this._overviewHiddenId);
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
            action();
        });
        Main.overview.hide();
    }

    _createDialog(title, hint, shouldFadeOut = true) {
        const dialog = new ModalDialog.ModalDialog({
            styleClass: 'workspace-windows-dialog',
            shouldFadeOut,
        });
        this._dialog = dialog;
        dialog.connect('destroy', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        dialog.contentLayout.add_child(new St.Label({
            text: title,
            style_class: 'workspace-windows-title',
        }));
        dialog.contentLayout.add_child(new St.Label({
            text: hint,
            style_class: 'workspace-windows-hint',
        }));
        const monitor = Main.layoutManager.currentMonitor;
        const scroll = new St.ScrollView({
            style: `max-height: ${Math.floor(monitor.height * 0.45)}px;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
        });
        const list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'workspace-windows-list',
            x_expand: true,
        });
        scroll.set_child(list);
        dialog.contentLayout.add_child(scroll);
        return {dialog, list, scroll};
    }

    _showSwitcher() {
        if (this._dialog)
            return;
        const windows = this._currentWindows();
        const byId = new Map(windows.map(window => [window.get_id(), window]));
        const tracker = Shell.WindowTracker.get_default();
        const entries = this._workingSet.recent([...byId.keys()]).map(id => {
            const window = byId.get(id);
            return {
                id,
                app: tracker.get_window_app(window)?.get_name() ?? 'Window',
                title: window.get_title() ?? 'Untitled',
            };
        });
        const {dialog, list, scroll} = this._createDialog(
            'Workspace', 'Type to filter by application or window title.\n↑/↓ to choose, Enter to open, Escape to cancel.', false);
        const search = new St.Entry({
            hint_text: 'Search assigned windows…',
            can_focus: true,
            x_expand: true,
            style_class: 'workspace-windows-search',
        });
        dialog.contentLayout.insert_child_below(search, scroll);
        let matches = [];
        let rows = [];
        let selected = 0;
        const choose = id => {
            // A window may close or move desktops while the picker is open.
            const window = this._currentWindows().find(item => item.get_id() === id);
            dialog.close();
            activateWindow(window, global.get_current_time());
        };
        const highlight = index => {
            selected = index;
            rows.forEach((row, i) => {
                if (i === selected)
                    row.add_style_pseudo_class('selected');
                else
                    row.remove_style_pseudo_class('selected');
            });
            if (rows[selected])
                ensureActorVisibleInScrollView(scroll, rows[selected]);
        };
        const render = () => {
            matches = filterWindows(entries, search.get_text());
            list.destroy_all_children();
            rows = matches.map((entry, index) => {
                const label = new St.Label({
                    text: `${entry.app} — ${entry.title}`,
                    x_expand: true,
                });
                label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                const row = new St.Button({
                    style_class: 'workspace-windows-choice',
                    child: label,
                    label_actor: label,
                    can_focus: true,
                    reactive: true,
                    x_expand: true,
                });
                row.connect('clicked', () => choose(entry.id));
                row.connect('key-focus-in', () => highlight(index));
                list.add_child(row);
                return row;
            });
            if (!rows.length) {
                list.add_child(new St.Label({
                    text: entries.length ? 'No matching windows.'
                        : 'No assigned windows on this desktop.\nPress Super+A to choose some after closing this dialog.',
                }));
            }
            selected = 0;
            // Newly created rows are not allocated yet; scrolling is only needed
            // when navigating. Filtering starts at the beginning of the list.
            scroll.vadjustment.value = 0;
            rows[0]?.add_style_pseudo_class('selected');
        };
        search.clutter_text.connect('text-changed', render);
        dialog.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                dialog.close();
                return Clutter.EVENT_STOP;
            }
            const focus = global.stage.key_focus;
            // Let Cancel and other controls keep their normal keyboard behavior.
            if (focus !== search.clutter_text && !rows.some(row => row.contains(focus)))
                return Clutter.EVENT_PROPAGATE;
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                if (matches.length)
                    highlight((selected + (key === Clutter.KEY_Down ? 1 : -1) + matches.length) % matches.length);
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                if (matches[selected])
                    choose(matches[selected].id);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        dialog.setButtons([
            {label: 'Cancel', key: Clutter.KEY_Escape, action: () => dialog.close()},
        ]);
        render();
        dialog.setInitialKeyFocus(search.clutter_text);
        if (!dialog.open())
            dialog.destroy();
    }

    _showPicker() {
        if (this._dialog)
            return;
        const windows = this._currentWindows();
        const {dialog, list, scroll} = this._createDialog(
            'Add to workspace', 'Changes are saved immediately. Press Escape to close.\nPress Super+Space to switch to one of your assigned windows.');
        const tracker = Shell.WindowTracker.get_default();
        const rows = windows.map(window => {
            const id = window.get_id();
            const name = tracker.get_window_app(window)?.get_name() ?? 'Window';
            const row = new CheckBox.CheckBox(`${name} — ${window.get_title() ?? 'Untitled'}`);
            row.add_style_class_name('workspace-window-assignment');
            row.checked = this._workingSet.selected.has(id);
            row.connect('notify::checked', () => {
                this._workingSet.select(id, row.checked);
                this._workingSet.sync(this._allWindows().map(item => item.get_id()));
            });
            row.x_expand = true;
            const label = row.getLabelActor();
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            row.connect('key-focus-in', () => ensureActorVisibleInScrollView(scroll, row));
            list.add_child(row);
            return {id, row};
        });
        if (!rows.length)
            list.add_child(new St.Label({text: 'No open windows on this desktop.'}));

        list.add_child(new St.Label({text: 'Application shortcuts', style_class: 'workspace-windows-section-title'}));
        const appSystem = Shell.AppSystem.get_default();
        const shortcutRows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        shortcutRows.set_style('spacing: 4px;');
        list.add_child(shortcutRows);
        const renderShortcuts = () => {
            shortcutRows.destroy_all_children();
            for (const slot of APP_SHORTCUT_SLOTS) {
                const desktopId = this._settings.get_string(this._appIdKey(slot));
                const accelerator = this._settings.get_strv(this._appKey(slot))[0];
                if (!desktopId || !accelerator)
                    continue;
                const app = appSystem.lookup_app(desktopId);
                const row = new St.BoxLayout({x_expand: true, style_class: 'workspace-windows-shortcut-row'});
                row.add_child(new St.Label({text: `${app?.get_name() ?? desktopId}  —  ${accelerator}`, x_expand: true}));
                const remove = new St.Button({label: 'Remove', can_focus: true, reactive: true});
                remove.connect('clicked', () => {
                    this._settings.set_strv(this._appKey(slot), []);
                    this._settings.set_string(this._appIdKey(slot), '');
                    this._refreshAppBinding(slot);
                    renderShortcuts();
                });
                row.add_child(remove);
                shortcutRows.add_child(row);
            }
        };
        renderShortcuts();
        const installedApps = appSystem.get_installed()
            .filter(app => app.get_id())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        const appSearch = new St.Entry({hint_text: 'Find an installed application…', x_expand: true});
        list.add_child(appSearch);
        const candidates = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        candidates.set_style('spacing: 4px;');
        list.add_child(candidates);
        let selectedApp = null;
        const renderCandidates = () => {
            candidates.destroy_all_children();
            selectedApp = null;
            const query = appSearch.get_text().trim().toLowerCase();
            if (!query)
                return;
            for (const app of installedApps.filter(item => item.get_name().toLowerCase().includes(query)).slice(0, 5)) {
                const button = new St.Button({label: app.get_name(), can_focus: true, reactive: true, x_expand: true});
                button.connect('clicked', () => {
                    appSearch.set_text(app.get_name());
                    selectedApp = app;
                    candidates.destroy_all_children();
                    candidates.add_child(new St.Label({text: `Selected: ${app.get_name()}`}));
                });
                candidates.add_child(button);
            }
        };
        appSearch.clutter_text.connect('text-changed', renderCandidates);
        const keyEntry = new St.Entry({hint_text: 'Super + letter (a–z)', x_expand: true});
        list.add_child(keyEntry);
        const add = new St.Button({label: 'Add shortcut', can_focus: true, reactive: true});
        add.connect('clicked', () => {
            const letter = keyEntry.get_text().trim().toLowerCase();
            if (!selectedApp || !/^[a-z]$/.test(letter)) {
                Main.notify('Workspace Windows', 'Choose an installed app and enter one letter (a–z).');
                return;
            }
            const duplicateApp = APP_SHORTCUT_SLOTS.some(slot =>
                this._settings.get_string(this._appIdKey(slot)) === selectedApp.get_id() &&
                this._settings.get_strv(this._appKey(slot)).length > 0);
            const duplicateKey = APP_SHORTCUT_SLOTS.some(slot =>
                this._settings.get_strv(this._appKey(slot))[0]?.toLowerCase() === `<super>${letter}`);
            if (duplicateApp || duplicateKey) {
                Main.notify('Workspace Windows', duplicateApp
                    ? 'That application already has a shortcut.' : 'That Super+letter shortcut is already in use.');
                return;
            }
            const slot = APP_SHORTCUT_SLOTS.find(index =>
                !this._settings.get_string(this._appIdKey(index)) &&
                this._settings.get_strv(this._appKey(index)).length === 0);
            if (!slot) {
                Main.notify('Workspace Windows', 'All 12 application shortcut slots are in use.');
                return;
            }
            if (!this._settings.set_string(this._appIdKey(slot), selectedApp.get_id()) ||
                !this._settings.set_strv(this._appKey(slot), [`<Super>${letter}`]) ||
                !this._refreshAppBinding(slot)) {
                this._settings.set_strv(this._appKey(slot), []);
                this._settings.set_string(this._appIdKey(slot), '');
                this._refreshAppBinding(slot);
                Main.notify('Workspace Windows', 'Could not register that Super+letter shortcut.');
                return;
            }
            renderShortcuts();
            appSearch.set_text('');
            keyEntry.set_text('');
            selectedApp = null;
            candidates.destroy_all_children();
        });
        list.add_child(add);
        dialog.connect('captured-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                dialog.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        if (rows.length)
            dialog.setInitialKeyFocus(rows[0].row);
        if (!dialog.open())
            dialog.destroy();
    }
}
