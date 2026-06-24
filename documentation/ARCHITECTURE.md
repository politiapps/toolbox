# Architecture

Live map of how the Tasks Panel plugin is structured. Update this whenever the
structure changes.

## Overview

A single Obsidian plugin that renders a sidebar `ItemView`. The view reads and
writes one user-configured markdown file (default `tasks.md`) whose lines use
Obsidian Tasks plugin-compatible syntax, so other Tasks queries keep working.

```
src/
  main.ts        Plugin entry point + lifecycle + global vault watcher
  taskParser.ts  THE ONLY place tasks are parsed / serialised
  settings.ts    Settings model, defaults, native settings tab
  taskView.ts    Sidebar ItemView, rendering, interactions, add/edit modal
styles.css       Sidebar styling (auto-loaded by Obsidian)
manifest.json    Plugin id/name/minAppVersion (1.4.0)
```

## Module responsibilities

### `main.ts` — `TasksPlugin extends Plugin`
- Loads/saves settings and persisted UI state via `loadData()` / `saveData()`.
- Registers the view type (`VIEW_TYPE_TASKS`), a ribbon icon, and the
  `open-tasks-panel` command.
- Registers the **single** `vault.on('modify')` listener via
  `this.registerEvent()`. When the configured tasks file changes (including
  external edits), it calls `refreshViews()`.
- `activateView()` opens/reveals the view in the right sidebar.
- `refreshViews()` re-renders every open `TasksView`.

### `taskParser.ts`
- Exports `Task`, `TaskInput`, `Priority`, `PRIORITY_EMOJI`.
- `parseTask(line, index)` → `Task | null` for one line.
- `parseTasks(content)` → `{ tasks, lines }` for the whole file.
- `serializeTask(input)` → canonical markdown line.
- `collectTags(tasks)` → unique tags in first-seen order.
- **No other file may parse or build task line strings.**

### `settings.ts`
- `TasksPluginSettings`: `tasksFilePath`, `sections[]`, `recentTags[]`,
  `collapseState{}`.
- `SectionConfig`: `id`, `name`, `tag`, `sort`, `collapsedByDefault`.
- `SortOrder`: `due | priority-due | priority | file`.
- `TasksSettingTab`: native settings UI to edit the file path and manage
  sections (add / remove / reorder / rename / retag / sort / default collapse).
- `touchRecentTag()` promotes a tag to the front of the recently-used list.
- `COMPLETED_KEY` is the persistence key for the always-present Completed
  section's collapse state.

### `taskView.ts` — `TasksView extends ItemView`
- Rendering: Add button → user sections (in settings order) → Completed.
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
- `TaskFormModal` (same file) is the add/edit form: description, tag (datalist
  of file tags ordered most-recently-used, free typing allowed), due date,
  priority. Used for both add and edit.
- Date formatting helpers are UI-only and never parse task syntax.

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
