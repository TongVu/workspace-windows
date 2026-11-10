// Test-only extension, loaded exclusively in an isolated headless Shell.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const check = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
const listOf = dialog => dialog.contentLayout.get_children().at(-1).get_child();
const rowsOf = dialog => listOf(dialog).get_children()
    .filter(row => row.style_class?.includes('workspace-window-assignment'));
const switcherRows = dialog => listOf(dialog).get_children()
    .filter(row => row.style_class?.includes('workspace-windows-choice'));
const searchOf = dialog => dialog.contentLayout.get_children()[2];

export default class TestDriver extends Extension {
    enable() {
        // GNOME may rebase this test extension during another extension's
        // disable/enable or a session-mode change. Run the suite only once.
        if (this._started)
            return;
        this._started = true;
        this.run().catch(error => {
            console.error(error);
            GLib.file_set_contents(GLib.getenv('WORKSPACE_TEST_RESULT'), `FAIL: ${error.message}\n${error.stack}`);
        });
    }

    disable() {}

    async run() {
        await pause(6000);
        const extension = Main.extensionManager.lookup('workspace-windows@local')?.stateObj;
        check(extension?._bindings.length === 14, 'Workspace and all twelve app shortcut slots must be registered');
        check(!extension._provider, 'Old search provider remains');
        const seat = global.stage.context.get_backend().get_default_seat();
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const key = (symbol, state) => keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, state);
        const tap = async symbol => {
            key(symbol, Clutter.KeyState.PRESSED);
            await pause(40);
            key(symbol, Clutter.KeyState.RELEASED);
            await pause(100);
        };
        const type = async text => {
            for (const char of text)
                await tap(char.codePointAt(0));
        };
        const open = async (symbol = Clutter.KEY_space) => {
            key(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
            await tap(symbol);
            key(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
            await pause(350);
            check(extension._dialog, `Super+${String.fromCharCode(symbol)} did not open a dialog`);
            return extension._dialog;
        };
        const windows = extension._currentWindows()
            .filter(window => window.get_title()?.startsWith('Workspace test '))
            .sort((a, b) => a.get_title().localeCompare(b.get_title()));
        check(windows.length === 4, `Expected 4 test windows, got ${windows.length}`);

        let dialog = await open(Clutter.KEY_a);
        check(rowsOf(dialog).length === 4,
            `Super+A did not show assignment checkboxes (list ${listOf(dialog).get_children().length}; ${listOf(dialog).get_children().map(child => `${child.constructor.name}:${typeof child.checked}`).join(', ')})`);
        check(dialog.buttonLayout.get_children().length === 0, 'Assignment dialog still has action buttons');
        await tap(Clutter.KEY_space);
        check(extension._workingSet.selected.size === 1, 'Keyboard check did not save immediately');
        await tap(Clutter.KEY_space);
        check(extension._workingSet.selected.size === 0, 'Keyboard uncheck did not save immediately');
        rowsOf(dialog).forEach(row => { row.checked = true; });
        check(extension._workingSet.selected.size === 4, 'Assignments not saved before closing');
        const settingList = listOf(dialog).get_children();
        const appSearch = settingList.find(child => child instanceof St.Entry &&
            child.hint_text === 'Find an installed application…');
        const candidates = settingList[settingList.indexOf(appSearch) + 1];
        const keyEntry = settingList[settingList.indexOf(appSearch) + 2];
        const addShortcut = settingList[settingList.indexOf(appSearch) + 3];
        check(appSearch && candidates && keyEntry && addShortcut, 'Shortcut editor controls missing');
        check(extension._workingSet.selected.size === 4, 'Assignments missing before shortcut editor interaction');
        appSearch.set_text('Test newapp');
        check(candidates.get_children().length > 0, 'Installed app search returned no fixture');
        candidates.get_children()[0].emit('clicked', 1);
        check(extension._workingSet.selected.size === 4, 'Choosing installed app cleared window assignments');
        keyEntry.set_text('b');
        addShortcut.emit('clicked', 1);
        check(extension._workingSet.selected.size === 4, 'Saving app shortcut cleared window assignments');
        await pause(150);
        check(extension._settings.get_string('app-shortcut-app-7') === 'local.workspace.launcher.newapp.desktop',
            'New app shortcut was not saved');
        check(extension._settings.get_strv('app-shortcut-key-7')[0] === '<Super>b',
            'New Super+letter binding was not registered');
        check(extension._workingSet.selected.size === 4, 'Adding app shortcut cleared window assignments');
        await tap(Clutter.KEY_Escape);
        key(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        await tap(Clutter.KEY_b);
        key(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        await pause(250);
        for (let i = 0; i < 40 && Shell.AppSystem.get_default()
            .lookup_app('local.workspace.launcher.newapp.desktop').get_windows().length < 2; i++)
            await pause(100);
        const newApp = Shell.AppSystem.get_default().lookup_app('local.workspace.launcher.newapp.desktop');
        check(extension._workingSet.selected.size === 4, 'Launching added app cleared window assignments');
        check(newApp.get_windows().length === 2,
            'Dynamically added Super+B did not launch app');
        for (const window of newApp.get_windows())
            window.delete(global.get_current_time());
        await pause(250);
        extension._workingSet.sync(extension._allWindows().map(window => window.get_id()));
        dialog = await open(Clutter.KEY_a);
        const shortcutsContainer = listOf(dialog).get_children().find(child =>
            child.get_children?.().some(item => item.style_class?.includes('workspace-windows-shortcut-row')));
        const newSlot = shortcutsContainer?.get_children().find(child =>
            child.style_class?.includes('workspace-windows-shortcut-row') &&
            child.get_children()[0].text.includes('Test newapp'));
        check(newSlot, 'New app mapping is absent from shortcut list');
        newSlot.get_children().find(button => button instanceof St.Button).emit('clicked', 1);
        await pause(150);
        check(extension._settings.get_string('app-shortcut-app-7') === '' &&
            extension._settings.get_strv('app-shortcut-key-7').length === 0,
            'Removing app shortcut did not clear its settings');
        check(extension._dialog && rowsOf(extension._dialog).length === 4 &&
            extension._workingSet.selected.size === 4,
            `Removing app shortcut lost window assignments (rows ${extension._dialog ? rowsOf(extension._dialog).length : 'none'}, selected ${extension._workingSet.selected.size}, windows ${extension._allWindows().map(w => w.get_title()).join('|')})`);
        dialog = extension._dialog;
        await tap(Clutter.KEY_Escape);
        key(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        await tap(Clutter.KEY_b);
        key(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        await pause(200);
        check(newApp.get_windows().length === 0, 'Removed Super+B still launched the app');
        check(extension._workingSet.selected.size === 4, 'Escape reverted immediate assignment changes');
        await pause(150);
        check(extension._workingSet.selected.size === 4, 'Closing reverted assignments');
        for (const window of windows) {
            window.activate(global.get_current_time());
            await pause(100);
        }
        windows[0].minimize();
        windows[2].minimize();
        await pause(150);
        const before = global.display.sort_windows_by_stacking(windows).map(w => w.get_id()).join();
        dialog = await open();
        check(switcherRows(dialog).length === 4, 'Switcher must show all assigned windows');
        check(global.stage.key_focus === searchOf(dialog).clutter_text, 'Search is not auto-focused');
        check(global.display.sort_windows_by_stacking(windows).map(w => w.get_id()).join() === before,
            'Opening switcher raised windows');
        check(windows[0].minimized && windows[2].minimized, 'Opening switcher restored windows');
        await type('3');
        check(extension._dialog === dialog && searchOf(dialog).get_text() === '3',
            'Digit activated a window instead of filtering');
        check(switcherRows(dialog).length === 1 && switcherRows(dialog)[0].get_child().text.includes('test 3'),
            'Typing did not filter by window title');
        await tap(Clutter.KEY_Return);
        check(!extension._dialog && global.display.focus_window === windows[2], 'Enter did not activate match');
        check(!windows[2].minimized && windows[0].minimized, 'Other windows were restored');

        dialog = await open();
        check(searchOf(dialog).get_text() === '', 'New opening retained previous filter');
        // App-name matching is also exercised through the actual entry text change.
        const appName = Shell.WindowTracker.get_default().get_window_app(windows[0]).get_name();
        searchOf(dialog).set_text(appName.toUpperCase());
        await pause(150);
        check(switcherRows(dialog).length === 4, 'Application-name filtering failed');
        searchOf(dialog).set_text('');
        await type('missing');
        check(listOf(dialog).get_children().some(row => row.text === 'No matching windows.'), 'No-match feedback missing');
        await tap(Clutter.KEY_Return);
        check(extension._dialog === dialog, 'Enter on no matches closed dialog');
        // Ctrl+A / Backspace clears the field without activating a numbered row.
        key(Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        await tap(Clutter.KEY_a);
        key(Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        await tap(Clutter.KEY_BackSpace);
        check(searchOf(dialog).get_text() === '' && switcherRows(dialog).length === 4,
            'Clearing input did not restore all matches');
        await tap(Clutter.KEY_Down);
        check(switcherRows(dialog)[1].has_style_pseudo_class('selected'), 'Down did not select next match');
        await tap(Clutter.KEY_Up);
        check(switcherRows(dialog)[0].has_style_pseudo_class('selected'), 'Up did not select previous match');
        await tap(Clutter.KEY_Down);
        await tap(Clutter.KEY_Return);
        check(global.display.focus_window === windows[3], 'Arrow/Enter activated wrong match');

        dialog = await open();
        await type('test 1');
        const row = switcherRows(dialog)[0];
        const [x, y] = row.get_transformed_position();
        const [width, height] = row.get_transformed_size();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
        await pause(50);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await pause(40);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await pause(250);
        check(!extension._dialog && global.display.focus_window === windows[0], 'Filtered pointer selection failed');
        check(!windows[0].minimized, 'Click did not unminimize chosen window');

        dialog = await open();
        await type('2');
        await tap(Clutter.KEY_Escape);
        check(!extension._dialog && global.display.focus_window === windows[0], 'Escape changed focus');

        Main.overview.show();
        await pause(400);
        dialog = await open();
        check(!Main.overview.visible && global.stage.key_focus === searchOf(dialog).clutter_text,
            'Super+Space from overview failed');
        await tap(Clutter.KEY_Escape);
        Main.overview.show();
        await pause(400);
        dialog = await open(Clutter.KEY_a);
        check(!Main.overview.visible, 'Super+A opened Show Applications instead of assignment picker');
        rowsOf(dialog)[0].checked = false;
        check(extension._workingSet.selected.size === 3, 'Assignment removal was not immediate');
        await tap(Clutter.KEY_Escape);
        await pause(150);
        dialog = await open(Clutter.KEY_a);
        check(rowsOf(dialog).filter(row => row.checked).length === 3, 'Reopening lost saved checkboxes');
        rowsOf(dialog).forEach(item => { item.checked = false; });
        check(extension._workingSet.selected.size === 0, 'Unchecking all was not saved immediately');
        await tap(Clutter.KEY_Escape);
        await pause(150);
        check(extension._workingSet.selected.size === 0, 'Escape reverted immediate assignments');

        // Re-add all for the stale-window case, using a captured entry ID.
        windows.forEach(window => extension._workingSet.select(window.get_id(), true));
        dialog = await open();
        await type('1');
        const closedId = windows[0].get_id();
        windows[0].delete(global.get_current_time());
        await pause(250);
        await tap(Clutter.KEY_Return);
        check(!extension._dialog && !extension._workingSet.selected.has(closedId),
            'Closed filtered window not handled safely');

        // Exercise GNOME's actual session-mode/extension-manager lifecycle in
        // this isolated Shell, not the user's real screen lock/authentication.
        const beforeLock = [...extension._workingSet.selected];
        await open();
        Main.sessionMode.pushMode('unlock-dialog');
        await pause(500);
        check(!extension._dialog && !extension._focusId && extension._bindings.length === 0,
            'Lock did not close dialogs and release focus tracking/shortcuts');
        Main.sessionMode.popMode('unlock-dialog');
        await pause(500);
        check(JSON.stringify([...extension._workingSet.selected]) === JSON.stringify(beforeLock),
            'Lock/unlock cleared assigned windows');
        dialog = await open();
        check(switcherRows(dialog).length === beforeLock.length, 'Restored assignments not shown after unlock');
        await tap(Clutter.KEY_Escape);

        // Repeat the cycle, including a window closing while locked.
        const closedWhileLocked = windows[1].get_id();
        const beforeSecondLock = extension._workingSet.order.filter(id => id !== closedWhileLocked);
        Main.sessionMode.pushMode('unlock-dialog');
        await pause(500);
        windows[1].delete(global.get_current_time());
        await pause(250);
        Main.sessionMode.popMode('unlock-dialog');
        await pause(500);
        check(extension._workingSet.selected.size === beforeLock.length - 1 &&
            !extension._workingSet.selected.has(closedWhileLocked),
        'Unlock did not preserve live assignments and prune closed windows');
        check(JSON.stringify(extension._workingSet.order) === JSON.stringify(beforeSecondLock),
            'Lock/unlock lost focus history');

        await open();
        const bindingNames = [...extension._bindings];
        extension.disable();
        await pause(200);
        check(!extension._dialog && Main.modalCount === 0, 'Disable leaked modal input grab');
        for (const name of bindingNames) {
            check(!Main.wm._allowedKeybindings[name], `Disable leaked ${name}`);
        }
        extension.enable();
        await pause(250);
        check(extension._workingSet.selected.size === 0, 'Re-enable retained stale assignments');
        dialog = await open();
        check(listOf(dialog).get_children().some(child => child.text?.startsWith('No assigned windows')),
            'Empty state missing');
        await type('test');
        await tap(Clutter.KEY_Return);
        check(extension._dialog === dialog, 'Enter activated an empty set');
        await tap(Clutter.KEY_Escape);
        check(Main.modalCount === 0, 'Empty state leaked modal grab');
        // Test real keybinding -> Shell.App launch/focus using local GTK
        // fixtures, NOT the user's installed applications or browser.
        for (const [letter, desktop] of [
            ['v', 'com.microsoft.VSCode.desktop'], ['e', 'microsoft-edge.desktop'],
            ['f', 'org.gnome.Nautilus.desktop'], ['o', 'md.obsidian.Obsidian.desktop'],
            ['t', 'teams-for-linux.desktop'], ['k', 'kitty.desktop'],
        ]) {
            const app = Shell.AppSystem.get_default().lookup_app(desktop);
            check(app && app.get_app_info().get_commandline().includes('tests/launcher.py'),
                `Unsafe/missing test launcher for ${desktop}`);
            const chord = async () => {
                key(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
                await tap(letter.codePointAt(0));
                key(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
                await pause(250);
            };
            check(app.get_windows().length === 0, `Fixture ${desktop} unexpectedly already running`);
            if (letter === 'e') {
                Main.overview.show();
                await pause(400);
            }
            await chord();
            for (let i = 0; i < 40 && app.get_windows().length < 2; i++)
                await pause(100);
            const appWindows = app.get_windows();
            check(appWindows.length === 2, `Super+${letter} failed to launch ${desktop}`);
            check(!Main.overview.visible, 'App shortcut left overview open');
            const target = appWindows[0];
            target.activate(global.get_current_time());
            await pause(100);
            windows[2].activate(global.get_current_time());
            await pause(100);
            target.minimize();
            await pause(150);
            await chord();
            check(global.display.focus_window === target && !target.minimized,
                `Super+${letter} failed to focus/unminimize the MRU window`);
            check(app.get_windows().length === 2, `Super+${letter} launched a duplicate window`);
            if (letter === 'k') {
                windows[2].activate(global.get_current_time());
                await pause(100);
                const previousWorkspace = global.workspace_manager.get_active_workspace();
                const other = global.workspace_manager.append_new_workspace(false, global.get_current_time());
                target.change_workspace(other);
                await pause(150);
                await chord();
                check(global.workspace_manager.get_active_workspace() === other &&
                    global.display.focus_window === target, 'App shortcut did not follow window to its desktop');
                check(target.get_workspace() === other, 'App shortcut moved the window');
                previousWorkspace.activate(global.get_current_time());
                await pause(200);
            }
        }
        check(extension._workingSet.selected.size === 0, 'App launch implicitly assigned windows');
        check(!extension._bindings.some(name => name.includes('chatgpt')), 'ChatGPT shortcut must not exist');
        GLib.file_set_contents(GLib.getenv('WORKSPACE_TEST_RESULT'),
            'PASS: six initial and one dynamically added/removed app shortcut (GTK fixtures), no duplicate launches, MRU/minimized/cross-desktop focus, real Super+A/Super+Space on desktop and overview, button-free immediate assignments, auto-focus, typed filtering (including digits), app/title matching, clear/no matches, arrows/Enter, filtered pointer click, Escape, stale windows, only chosen window restored, empty state, lock/unlock assignment retention, closed-during-lock pruning, shortcut/modal cleanup');
    }
}
