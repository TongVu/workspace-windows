// No Shell dependencies: keep selection and recency independently testable.
export class WorkingSet {
    constructor(ids = []) {
        this.order = [...new Set(ids)];
        this.selected = new Set();
    }

    sync(liveIds) {
        const live = new Set(liveIds);
        this.order = [...new Set([...this.order, ...liveIds])]
            .filter(id => live.has(id));
        this.selected = new Set([...this.selected].filter(id => live.has(id)));
    }

    focus(id) {
        this.order = [id, ...this.order.filter(other => other !== id)];
    }

    select(id, selected) {
        if (selected)
            this.selected.add(id);
        else
            this.selected.delete(id);
    }

    recent(visibleIds) {
        const visible = new Set(visibleIds);
        return this.order.filter(id => visible.has(id) && this.selected.has(id));
    }
}

export function filterWindows(entries, query) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(entry => {
        const text = `${entry.app} ${entry.title}`.toLowerCase();
        return terms.every(term => text.includes(term));
    });
}

// Resolve aliases to one existing MRU window; only launch when none exists.
export function findAppTarget(apps, recentIds) {
    const windows = apps.flatMap(app => app.get_windows()).filter(window => !window.skip_taskbar);
    const byId = new Map(windows.map(window => [window.get_id(), window]));
    const id = recentIds.find(candidate => byId.has(candidate));
    const window = byId.get(id) ?? windows[0];
    if (window)
        return {window};
    return apps.length ? {app: apps[0]} : null;
}

export function activateWindow(window, timestamp) {
    if (!window)
        return;
    if (window.minimized)
        window.unminimize();
    window.raise();
    window.activate(timestamp);
}
