# Obsidian API Notes

Known quirks, patterns, and decisions discovered while building this plugin.
Add a note here whenever a non-obvious API behaviour bites you.

## File access
- Always use `this.app.vault.read()` / `vault.modify()` / `vault.create()`.
  Never Node.js `fs` — it breaks on mobile and bypasses Obsidian's file cache.
- `vault.getAbstractFileByPath(path)` returns `TAbstractFile | null`; narrow
  with `instanceof TFile` before using it as a file.
- The tasks file may not exist yet. `ensureTasksFile()` creates it (via
  `vault.create`) on first write. `vault.create` will throw if the parent
  folder is missing — keep the default path at the vault root.

## Read-before-write / merge
- Every write re-reads current content first and edits the line array, then
  writes back. We never cache-and-overwrite, so external edits between render
  and action are not clobbered.
- `replaceLine()` locates the target by exact line-text match (`lines.indexOf`)
  rather than by stored index, because an external edit could have shifted line
  numbers. If the exact line is gone, we surface a Notice and abort.

## Events
- The `vault.on('modify')` listener is registered once in `main.ts` via
  `this.registerEvent()` so Obsidian disposes it on unload. Do NOT register it
  per-view (would leak / double-fire).
- Our own `vault.modify()` calls also trigger `modify`, causing an extra
  `refreshViews()`. This is harmless (idempotent re-render) and keeps all views
  in sync.

## Views
- `registerView(type, factory)` + `getRightLeaf(false).setViewState({ type })`
  to open in the right sidebar; `workspace.revealLeaf` to focus it.
- `getLeavesOfType(VIEW_TYPE)` is used both to avoid duplicate leaves and to
  iterate open views for refresh.

## Icons
- Obsidian bundles Lucide icons. Use current Lucide names: `list-checks`,
  `chevron-right`, `chevron-down`, `chevron-up`, `pencil`, `plus`, `trash-2`.
  Legacy names (`trash`, `up-chevron-glyph`, `right-triangle`) may disappear;
  prefer Lucide names.
- `setIcon(el, name)` injects the SVG; size it via CSS on `… svg`.

## DOM helpers
- Prefer `createDiv` / `createEl` / `createSpan` helpers (they return the child
  and accept `{ cls, text, attr }`) over manual `document.createElement`.

## Dates
- `toLocaleDateString(undefined, { weekday: 'long' })` for the day name.
- Parse `YYYY-MM-DD` with `new Date(y, m-1, d)` (local) — `new Date('YYYY-MM-DD')`
  parses as UTC midnight and can render the previous day in negative-offset
  timezones.
