# Architecture

Live map of how **Toolbox** is structured. Update this whenever the structure
changes.

## Overview

Toolbox is a single Obsidian plugin (id `toolbox`) that bundles several
utilities as features. `main.ts` owns the plugin lifecycle and registers each
feature's views, commands, and settings.

**Features:**

- **Tasks panel** (current) — a sidebar `ItemView` that reads and writes one
  user-configured markdown file (default `tasks.md`) whose lines use Obsidian
  Tasks plugin-compatible syntax, so other Tasks queries keep working. Its
  modules and behaviour are mapped in the rest of this document.
- **Editable Columns** (current) — a Live Preview multi-row / multi-column
  layout. `%% columns %%` comment-marker blocks are replaced by a CSS-grid
  widget whose cells are rendered through Obsidian's real markdown pipeline
  (so embeds / dataviewjs / Tasks execute). Embeds inside cells are
  click-to-edit. Documented in `documentation/editable-columns.md`.
- **Timesheet** (planned) — not yet implemented.

As each new feature lands it gets its own module(s) under `src/` and its own
doc under `documentation/`, and is added to the list above.

## Modules

```
src/
  main.ts            Plugin entry point + lifecycle + vault watcher + calendar
                     fetch + Editable Columns registration / embed-click listener
  taskParser.ts      THE ONLY place tasks are parsed / serialised
  calendar.ts        THE ONLY place .ics feeds are parsed (pure; no vault access)
  settings.ts        Settings model, defaults, native settings tab
  taskView.ts        Sidebar ItemView, rendering, interactions, add/edit modal
  editableColumns.ts Editable Columns: CM6 extension, marker parsing, cell render
  embedEditor.ts     Editable Columns: resolve a clicked embed → floating editor
styles.css           Sidebar + columns + modal styling (auto-loaded by Obsidian)
manifest.json        Plugin id (`toolbox`) / name (`Toolbox`) / minAppVersion (1.4.0)
```

## Module responsibilities

### `main.ts` — `TasksPlugin extends Plugin`
- Loads/saves settings and persisted UI state via `loadData()` / `saveData()`.
- Registers the view type (`VIEW_TYPE_TASKS`), a ribbon icon, and the
  `open-tasks-panel` command.
- Registers vault listeners (`modify`, `create`, `delete`, `rename`) via
  `this.registerEvent()`. When the configured tasks file changes — including
  being created or renamed into the path — it calls `refreshViews()`.
- `activateView()` opens/reveals the view in the right sidebar.
- `refreshViews()` re-renders every open `TasksView`.
- `fetchCalendar()` pulls the configured `.ics` feed via `requestUrl` (no CORS),
  caches today's events on the plugin (`calendarEvents` / `calendarError`), and
  refreshes views. Called on load, on a 30-minute `registerInterval`, and when
  the URL changes in settings.
- **Editable Columns wiring:** registers a mutable editor-extension array via
  `registerEditorExtension`; `applyEditableColumns()` fills/empties it to match
  the setting and calls `workspace.updateOptions()`. A single
  `registerDomEvent(document, "click", …)` handler opens the embed editor for
  embeds clicked inside a `.toolbox-columns` cell (scoped so ordinary embeds are
  untouched).

### `calendar.ts`
- Minimal iCalendar (`.ics`) parsing — pure functions, no vault/network code.
- `getEventsForToday(ics)` → today's `CalendarOccurrence[]` (parse + filter).
- `parseICS` / `eventsOnDay` are exported for testing. Handles line unfolding,
  timed + all-day events, UTC and floating/TZID times (TZID treated as
  wall-clock), EXDATE, and common recurrence (DAILY / WEEKLY+BYDAY / MONTHLY /
  YEARLY with INTERVAL, UNTIL, COUNT). Not full RFC 5545.
- Fetched and cached by `main.ts` (`fetchCalendar`), rendered by the view.

### `taskParser.ts`
- Exports `Task` (now with `children`, `notes`, and block-range fields),
  `TaskInput`, `Priority`, `PRIORITY_EMOJI`.
- `parseTask(line, index)` → `Task | null` for one line.
- `parseTasks(content)` → `{ tasks, flat, lines }`: `tasks` is the top-level
  tree (indentation-based, with `children`/`notes`), `flat` is every task.
- `serializeTask(input)` → canonical markdown line.
- Pure structural editors over the line array: `setTaskNotes`,
  `addChildTaskLine`, `removeTaskBlock`, plus `findTaskByRaw`, `childIndentOf`.
- `collectTags(tasks)` → unique tags in first-seen order.
- **No other file may parse or build task line strings.**

### `settings.ts`
- `TasksPluginSettings`: `tasksFilePath`, `sections[]`, `recentTags[]`,
  `collapseState{}`, `icsUrl`, `editableColumnsEnabled`.
- `SectionConfig`: `id`, `name`, `tag`, `sort`, `collapsedByDefault`.
- `SortOrder`: `due | priority-due | priority | file`.
- `TasksSettingTab`: native settings UI to edit the file path and manage
  sections (add / remove / reorder / rename / retag / sort / default collapse).
- `touchRecentTag()` promotes a tag to the front of the recently-used list.
- `COMPLETED_KEY` is the persistence key for the always-present Completed
  section's collapse state.

### `taskView.ts` — `TasksView extends ItemView`
- Rendering: header (today + add) → user sections (in settings order) →
  Completed. If the configured file does not exist, renders a "No tasks file
  found" notice (with a Create-file action) instead of empty sections.
- Each section header shows display name + incomplete-count badge and toggles
  collapse (persisted via `collapseState`).
- Each task row: checkbox, description, tag pill(s), due date ("Thursday 25th",
  overdue in red), priority indicator, pencil (edit), trash (delete w/ inline
  confirm).
- File IO helpers (`readContent`, `ensureTasksFile`, `appendLine`,
  `replaceLine`) all go through `this.app.vault` and **read-before-write**.
  `replaceLine` relocates the target line by exact text match so concurrent
  external edits don't clobber the wrong line.
- Actions: `markDone` (sets `[x]` + `✅ today`), `markUndone`, delete, add, edit.
- Subtasks render recursively (`renderTask`) with an expand/collapse twisty
  (state persisted per task), a `done/total` progress badge, and a note
  indicator. Structural writes go through `applyStructural` (re-read → locate by
  raw → pure edit → write).
- `TaskFormModal` is the quick add form (also used for "add subtask").
- `TaskDetailModal` opens when you click a task: edit fields, a multi-line
  **notes** textarea, and a subtask list (toggle + add).
- Date formatting helpers are UI-only and never parse task syntax.

### `editableColumns.ts` — CM6 extension for the Editable Columns feature
- Exports `editableColumnsExtension` (a `ViewPlugin`) and `COLUMNS_CLASS`.
- Scans the document for `%% columns:start %% … %% columns:end %%` blocks and
  splits each into rows (`%% row %%`) of cells (`%% col %%`).
- Replaces each block (a `Decoration.replace`, `block: true`) with a
  `ColumnsWidget` — a CSS grid whose cells are rendered via
  `MarkdownRenderer.render(app, cellMarkdown, cellEl, sourcePath, child)` under a
  loaded `MarkdownRenderChild`. This is the fix vs. Live Columns, which skipped
  the renderer and so showed embeds / dataviewjs as raw text.
- Widget `eq()` compares the block's source text, so unrelated edits don't
  rebuild it; `destroy()` unloads every cell's `MarkdownRenderChild` (no leaks).
- A block whose lines the cursor/selection touches is left as raw source so the
  markers can be edited in place.
- Marker grammar is module-internal constants (like the priority emojis), **not**
  task parsing — `taskParser.ts` is untouched.

### `embedEditor.ts` — click-to-edit for embeds in cells
- Adapted from Embed Editor (MIT). `resolveEmbed()` turns a clicked
  `.internal-embed` into a source `TFile` + `[start, end)` line range using
  `metadataCache.getFirstLinkpathDest` and `getFileCache().headings/blocks`.
- `openEmbedEditor()` reads the slice, shows `EmbedEditModal` (a textarea,
  Save / `Mod+Enter`), and on save **re-reads** the file and locates the original
  slice by exact text before splicing — read-before-write, like
  `taskView.replaceLine`. The click listener that calls it lives in `main.ts`.

## Data flow

```
vault file ──read──▶ parseTasks ──▶ Task[] ──▶ TasksView renders
   ▲                                                  │
   │                                          user action (check/add/edit/delete)
   │                                                  ▼
   └──modify── vault ◀── serializeTask ◀── TaskInput / Task
```

External edit → `vault.on('modify')` (main.ts) → `refreshViews()` → re-render.

## Persistence

`saveData()` stores the whole `TasksPluginSettings` object, including
`collapseState` (per-section + Completed) and `recentTags`.
