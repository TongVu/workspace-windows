import assert from 'node:assert/strict';
import test from 'node:test';
import {WorkingSet, filterWindows, activateWindow, findAppTarget} from './model.js';

function selectedSet(ids) {
    const set = new WorkingSet(ids);
    ids.forEach(id => set.select(id, true));
    return set;
}

test('returns all assigned windows in recency order, not just three', () => {
    const set = selectedSet([1, 2, 3, 4, 5]);
    set.select(2, false);
    assert.deepEqual(set.recent([1, 2, 3, 4, 5]), [1, 3, 4, 5]);
});

test('large working sets remain available in the list', () => {
    const ids = Array.from({length: 12}, (_, index) => index + 1);
    assert.deepEqual(selectedSet(ids).recent(ids), ids);
});

test('actual focus changes recency without duplicates', () => {
    const set = selectedSet([1, 2, 3, 4]);
    set.focus(4);
    set.focus(4);
    assert.deepEqual(set.recent([1, 2, 3, 4]), [4, 1, 2, 3]);
});

test('unselected applications do not displace working windows', () => {
    const set = selectedSet([1, 2, 3]);
    set.focus(4);
    assert.deepEqual(set.recent([1, 2, 3, 4]), [1, 2, 3]);
});

test('only lists windows on the current desktop, retaining other selections', () => {
    const set = selectedSet([1, 2, 3, 4]);
    assert.deepEqual(set.recent([2, 4]), [2, 4]);
    assert.deepEqual(set.recent([1, 3]), [1, 3]);
});

test('closed windows are removed, and new windows are not automatically selected', () => {
    const set = selectedSet([1, 2, 3]);
    set.sync([2, 3, 4]);
    assert.deepEqual(set.order, [2, 3, 4]);
    assert.equal(set.selected.has(1), false);
    assert.deepEqual(set.recent([2, 3, 4]), [2, 3]);
});

test('sync preserves focus history rather than tab-list or minimized-window order', () => {
    const set = selectedSet([1, 2, 3]);
    set.focus(3);
    set.sync([1, 2, 3]);
    assert.deepEqual(set.recent([1, 2, 3]), [3, 1, 2]);
});

test('zero or one assigned window is valid', () => {
    const set = new WorkingSet([1, 2]);
    assert.deepEqual(set.recent([1, 2]), []);
    set.select(2, true);
    assert.deepEqual(set.recent([1, 2]), [2]);
    set.select(2, false);
    assert.deepEqual(set.recent([1, 2]), []);
});

const entries = [
    {id: 1, app: 'Firefox', title: 'Portal docs'},
    {id: 2, app: 'Terminal', title: 'Project 42'},
    {id: 3, app: 'Firefox', title: 'Issue 42'},
];

test('filter matches application names case-insensitively and preserves MRU order', () => {
    assert.deepEqual(filterWindows(entries, 'FIRE'), [entries[0], entries[2]]);
});

test('filter matches title substrings and treats digits as text', () => {
    assert.deepEqual(filterWindows(entries, '42'), [entries[1], entries[2]]);
    assert.deepEqual(filterWindows(entries, 'doc'), [entries[0]]);
});

test('all whitespace-separated terms must match across app and title', () => {
    assert.deepEqual(filterWindows(entries, '  fire   42  '), [entries[2]]);
    assert.deepEqual(filterWindows(entries, 'fire missing'), []);
});

test('clearing the query restores all entries without mutating the working set', () => {
    assert.deepEqual(filterWindows(entries, '  '), entries);
    assert.deepEqual(filterWindows([], 'test'), []);
    assert.equal(entries.length, 3);
});

test('only raises and activates the chosen window, restoring it if minimized', () => {
    const calls = [];
    const windows = [1, 2, 3].map(id => ({
        minimized: id === 2,
        unminimize: () => calls.push(`unminimize ${id}`),
        raise: () => calls.push(`raise ${id}`),
        activate: time => calls.push(`activate ${id} at ${time}`),
    }));
    activateWindow(windows[1], 42);
    assert.deepEqual(calls, ['unminimize 2', 'raise 2', 'activate 2 at 42']);
    calls.length = 0;
    activateWindow(windows[0], 43);
    assert.deepEqual(calls, ['raise 1', 'activate 1 at 43']);
});

test('a window that closed before choosing it is harmless', () => {
    assert.doesNotThrow(() => activateWindow(undefined, 0));
});

test('app shortcuts focus the MRU window across desktop IDs/aliases', () => {
    const older = {get_id: () => 1};
    const newer = {get_id: () => 2, minimized: true};
    const apps = [{get_windows: () => [older]}, {get_windows: () => [newer]}];
    assert.deepEqual(findAppTarget(apps, [99, 2, 1]), {window: newer});
});

test('app shortcuts launch the preferred installed desktop entry when no windows exist', () => {
    const primary = {get_windows: () => []};
    const alias = {get_windows: () => []};
    assert.deepEqual(findAppTarget([primary, alias], []), {app: primary});
    assert.equal(findAppTarget([], []), null);
});

test('app shortcuts ignore taskbar-skipped windows and handle newly created windows', () => {
    const hidden = {get_id: () => 1, skip_taskbar: true};
    const visible = {get_id: () => 2};
    const app = {get_windows: () => [hidden, visible]};
    assert.deepEqual(findAppTarget([app], [1]), {window: visible});
    const background = {get_windows: () => [hidden]};
    assert.deepEqual(findAppTarget([background], [1]), {app: background});
});
