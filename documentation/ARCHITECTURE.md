# Architecture

Live map of how the Tasks Panel plugin is structured. Update this whenever the
structure changes.

## Overview

A single Obsidian plugin that renders a sidebar `ItemView`. The view reads and
writes one user-configured markdown file (default `tasks.md`) whose lines use
Obsidian Tasks plugin-compatible syntax, so other Tasks queries keep working.

```
src/
  main.ts        Plugin entry point + lifecycle + vault watcher + calendar fetch
  taskParser.ts  THE ONLY place tasks are parsed / serialised
  calendar.ts    THE ONLY place .ics feeds are parsed (pure; no vault access)
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
- Registers vault listeners (`modify`, `create`, `delete`, `rename`) via
  `this.registerEvent()`. When the configured tasks file changes — including
  being created or renamed into the path — it calls `refreshViews()`.
- `activateView()` opens/reveals the view in the right sidebar.
- `refreshViews()` re-renders every open `TasksView`.
- `fetchCalendar()` pulls the configured `.ics` feed via `requestUrl` (no CORS),
  caches today's events on the plugin (`calendarEvents` / `calendarError`), and
  refreshes views. Called on load, on a 30-minute `registerInterval`, and when
  the URL changes in settings.

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
  `collapseState{}`, `icsUrl`.
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
