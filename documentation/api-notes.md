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

## Distribution / BRAT versioning (non-obvious)
- BRAT decides "is there an update?" by **semver-comparing the manifest
  `version`** in the release asset against the installed one. The new version
  must be **strictly greater**, or BRAT silently does nothing on startup.
- Prereleases rank BELOW their release in semver: `1.0.0-beta.2` < `1.0.0`. So
  shipping beta.1 with manifest `1.0.0` and then beta.2 with `1.0.0-beta.2` is a
  *downgrade* in BRAT's eyes — it won't update.
- RULE: the manifest `version` must (a) match the prerelease tag and (b) only
  ever increase. For a beta series toward stable `1.0.1`, use
  `1.0.1-beta.1`, `1.0.1-beta.2`, … then `1.0.1`. Each is > the last and > the
  previous stable.

## Events
- The vault listeners (`modify`, `create`, `delete`, `rename`) are registered
  once in `main.ts` via `this.registerEvent()` so Obsidian disposes them on
  unload. Do NOT register them per-view (would leak / double-fire). We watch all
  four so the panel refreshes when the tasks file is created or renamed into the
  configured path, not just edited.
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

## Live Preview rendering (Editable Columns)
- **Render cells through the pipeline, never by hand.** To make embeds /
  dataviewjs / Tasks execute inside custom-rendered content, call
  `MarkdownRenderer.render(app, md, el, sourcePath, component)` — it runs the
  registered post-processors. Hand-building HTML (Live Columns' mistake) shows
  those blocks as raw text. `MarkdownRenderer.renderMarkdown` is the deprecated
  spelling; use `.render`.
- **A loaded Component is mandatory for lifecycle.** Pass a `MarkdownRenderChild`
  (call `child.load()`) as the 5th arg and `unload()` it when the host widget is
  destroyed, or nested components (dataviewjs) leak / keep running. Dataview also
  ties its own refresh to that component, so dataviewjs cells update without us
  re-rendering them.
- **Comment markers beat a code fence for containers.** A ` ```columns ` fenced
  block can't contain a cell's own ` ```dataviewjs ` / ` ```tasks ` fence
  (markdown can't nest same-char fences). `%%`-comment markers
  (`%% columns:start %%` …) have no nesting limit and degrade gracefully when the
  feature is off — which is why Editable Columns uses them.
- **CM6 block widgets:** replace a block with `Decoration.replace({ block: true,
  widget })`; implement `WidgetType.eq()` (compare the block's source) so
  unrelated keystrokes don't rebuild it, and skip the replacement when the
  selection intersects the block so the user can edit the raw markers. Use
  `ignoreEvent()` to let clicks on interactive descendants (links, embeds,
  checkboxes) through instead of becoming cursor moves.
- **`editorInfoField`** (from `obsidian`) read off `view.state` gives the editor's
  `MarkdownFileInfo` — use `.file?.path` for the render `sourcePath` and `.app`
  for the `App`. **`Extension`** is a `@codemirror/state` type, NOT exported by
  `obsidian` — import it from there (`import type { Extension }`).
- **Toggling an editor extension at runtime:** hand `registerEditorExtension` a
  mutable array, mutate it in place, then call `app.workspace.updateOptions()`.
  Re-registering is not needed and would double up.

## Dates
- `toLocaleDateString(undefined, { weekday: 'long' })` for the day name.
- Parse `YYYY-MM-DD` with `new Date(y, m-1, d)` (local) — `new Date('YYYY-MM-DD')`
  parses as UTC midnight and can render the previous day in negative-offset
  timezones.
