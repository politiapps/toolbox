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
  Tasks plugin-compatible syntax, so other Tasks queries keep working. Supports
  **recurring tasks** via the Tasks `🔁` signifier (e.g. `every month on the 2nd
  Monday`): completing one spawns its next occurrence. Its modules and behaviour
  are mapped in the rest of this document.
- **Editable Columns** (current) — a Live Preview multi-row / multi-column
  layout. `%% columns %%` comment-marker blocks are replaced by a CSS-grid
  widget whose cells are rendered through Obsidian's real markdown pipeline
  (so embeds / dataviewjs / Tasks execute). Embeds inside cells are
  click-to-edit. Documented in `documentation/editable-columns.md`.
- **Timesheet** (current) — a sidebar `ItemView` for tracking work sessions with a
  running timer. Reads from and writes to a user-configured markdown file (default
  `timesheet.md`). Tracks start/end times, multiple breaks per session, and
  supports multiple organisations per day. Shows today's entries and a weekly
  summary with hours, fractional days (7h = 1 day), and earnings (from hourly
  rates configured in settings). It can also **generate a PDF invoice** from the
  tracked hours for an org and date range (with an editable line-item description
  and arbitrary custom items), saved to the vault and opened in Obsidian's PDF
  viewer.

As each new feature lands it gets its own module(s) under `src/` and its own
doc under `documentation/`, and is added to the list above.

## Modules

```
src/
  main.ts            Plugin entry point + lifecycle + vault watcher + calendar
                     fetch + Editable Columns registration / embed-click listener
                     + Timesheet registration / vault watcher
  taskParser.ts      THE ONLY place task LINES are parsed / serialised
  recurrence.ts      THE ONLY place 🔁 recurrence RULES are interpreted; pure
                     rule grammar + next-occurrence date math (no vault access)
  calendar.ts        THE ONLY place .ics feeds are parsed (pure; no vault access)
  calendarView.ts    Shared DOM render of the "Today's events" list (pure view)
  settings.ts        Settings model, defaults, native settings tab + Org mgmt
  taskView.ts        Sidebar ItemView, rendering, interactions, add/edit modal
  timesheetParser.ts THE ONLY place timesheet entries are parsed / serialised
  timesheetView.ts   Sidebar ItemView, running timer, entries, weekly summary,
                     add/edit modal
  invoiceGenerator.ts Build the invoice PDF (pdf-lib) + aggregate hours; save
                     binary to the vault
  invoiceModal.ts    Generate-invoice modal: org/date range, editable description,
                     custom items, preview; opens the saved PDF
  editableColumns.ts Editable Columns: CM6 extension, marker parsing, cell render
  embedEditor.ts     Editable Columns: resolve a clicked embed → floating editor
styles.css           Sidebar + columns + timesheet + invoice + modal styling
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
- `fetchCalendar()` pulls every feed in `settings.calendars` via `requestUrl`
  (no CORS), in parallel (`Promise.allSettled`), merges today's events with
  `mergeOccurrences`, and caches them on the plugin (`calendarEvents` /
  `calendarError`). An error is surfaced only when *all* feeds fail; partial
  successes show what loaded. Called on load, on a 30-minute `registerInterval`,
  and when calendars change in settings. `fetchOneCalendar(url)` fetches a single
  feed (used by the settings UI for per-calendar sync status).
- `loadSettings()` runs `migrateCalendars()` once to fold the legacy
  newline-separated `icsUrl` into the `calendars` list.
- **Editable Columns wiring:** registers a mutable editor-extension array via
  `registerEditorExtension`; `applyEditableColumns()` fills/empties it to match
  the setting and calls `workspace.updateOptions()`. A single
  `registerDomEvent(document, "click", …)` handler opens the embed editor for
  embeds clicked inside a `.toolbox-columns` cell (scoped so ordinary embeds are
  untouched). An **"Insert columns"** ribbon icon and the `insert-columns-block`
  command call `insertColumnsBlock(editor)` to drop a starter block at the cursor.
- **`toolbox-calendar` code block:** `registerMarkdownCodeBlockProcessor` renders
  the same merged "today" list as the sidebar anywhere in a note (incl. inside a
  columns cell). Mounted blocks are tracked in `calendarBlocks` and re-rendered by
  `refreshViews()` → `refreshCalendarBlocks()`; each is untracked on unload via a
  `MarkdownRenderChild`.

### `calendar.ts`
- Minimal iCalendar (`.ics`) parsing — pure functions, no vault/network code.
- `getEventsForToday(ics)` → today's `CalendarOccurrence[]` (parse + filter).
- `mergeOccurrences(lists)` → one sorted, de-duplicated list across feeds
  (same event in multiple shared calendars is dropped once).
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
  `addChildTaskLine`, `insertTaskLineBefore` (place a line at `blockStart`, used
  for a recurring task's next occurrence), `removeTaskBlock`, `moveTaskAsChild`
  (re-parent a task's whole block under another, re-indented; rejects cyclic
  moves), plus `findTaskByRaw`, `childIndentOf`.
- `collectTags(tasks)` → unique tags in first-seen order.
- The `🔁` **token** is owned here: `recurrence` on `Task`/`TaskInput` holds the
  raw rule text; its *meaning* is `recurrence.ts`'s job, not this file's.
- **No other file may parse or build task line strings.**

### `recurrence.ts`
- Pure recurrence engine (no vault/DOM/network), modelled on `calendar.ts`.
- `RecurrenceRule` (unit/interval + optional weekday, dayOfMonth, ordinal).
- `parseRecurrence(text)` → structured rule; `recurrenceToText(rule)` → canonical
  Tasks string (round-trips); `describeRecurrence`/`describeRecurrenceText` →
  short UI labels; `nextDueDate(rule, dueISO)` → next occurrence **from the due
  date** (day/week/month-by-date/month-by-nth-weekday/year; clamps day-of-month
  and Feb-29 overflow to the month's last valid day).
- `WEEKDAY_LABELS` (Sun=0…Sat=6) is exported for the modal's weekday dropdowns.
- **No other file may interpret or build recurrence rule text.**

### `settings.ts`
- `TasksPluginSettings`: `tasksFilePath`, `sections[]`, `recentTags[]`,
  `collapseState{}`, `calendars[]`, `editableColumnsEnabled`, `timesheetFilePath`,
  `timesheetOrgs[]`, `activeTimer`, `invoice{businessName,abn,businessAddress,bankName,

  bsb,accountNumber,invoiceFolder}` (plus deprecated `icsUrl`, migrated into
  `calendars`).
- `CalendarSource`: `id`, `title`, `url`. `migrateCalendars()` converts the legacy
  `icsUrl`; `newCalendarId()` mints ids. The settings tab manages calendars
  (add / title / URL / delete) with an inline per-calendar sync check
  (`fetchOneCalendar`).
- `TimesheetOrg`: `id`, `name`, `colour`, `rate`. `newOrgId()` mints ids.
  `TIMESHEET_ORG_COLORS` is the default palette.
- `ActiveTimer`: persisted timer state (`org`, `startTime`, `breakStart`, `breaks[]`).
- `SectionConfig`: `id`, `name`, `tag`, `sort`, `collapsedByDefault`.
- `SortOrder`: `due | priority-due | priority | file`.
- `TasksSettingTab`: native settings UI to edit the file path and manage
  sections (add / remove / reorder / rename / retag / sort / default collapse),
  plus timesheet file path and orgs (add / remove / name / colour / rate).
- `touchRecentTag()` promotes a tag to the front of the recently-used list.
- `COMPLETED_KEY` is the persistence key for the always-present Completed
  section's collapse state.

### `taskView.ts` — `TasksView extends ItemView`
- Rendering: header (today + add + triage status line) → user sections (in
  settings order) → Completed. If the configured file does not exist, renders a
  "No tasks file found" notice (with a Create-file action) instead of empty
  sections.
- **Triage status line (the panel's hero):** below the date, `renderPanelHeader`
  shows today's load — `countPressure(flat)` counts incomplete dated tasks that
  are overdue / due today, rendered as a mono console readout (overdue in alarm
  red, colour-bonded to the due-date ramp) or "Nothing due today" when clear.
- Each section header shows display name + incomplete-count badge and toggles
  collapse (persisted via `collapseState`). The section's hashed accent
  (`sectionAccent(id)` → `--section-accent`) is rendered as the card's left spine.
- Each task row: checkbox, description, tag pill(s), due date ("Thursday 25th",
  overdue in red), priority indicator, pencil (edit), trash (delete w/ inline
  confirm).
- File IO helpers (`readContent`, `ensureTasksFile`, `appendLine`,
  `replaceLine`) all go through `this.app.vault` and **read-before-write**.
  `replaceLine` relocates the target line by exact text match so concurrent
  external edits don't clobber the wrong line.
- Actions: `markDone` (sets `[x]` + `✅ today`), `markUndone`, delete, add, edit.
  For a **recurring** task with a due date, `markDone` instead routes through
  `applyStructural`: it completes the current line and `insertTaskLineBefore` a
  fresh incomplete copy dated `nextDueDate(rule, due)` just above it.
- **Recurrence UI:** `buildRecurrenceSetting()` (shared by the add and edit
  modals) renders a "Repeat" toggle + revealed sub-fields (interval/unit, weekly
  weekday, monthly day-of-month or Nth-weekday) and emits canonical rule text via
  `recurrence.ts`. Recurring rows show a `🔁` pill (`describeRecurrenceText`).
- **Drag-to-subtask:** each task row is draggable; dropping it on another row
  calls `moveTaskUnder` (re-read → locate both by raw → `moveTaskAsChild` → write),
  re-parenting the dragged block as a child of the drop target.
- The "Today's events" list is rendered by `calendarView.renderTodayCalendar`
  (shared with the `toolbox-calendar` block).
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

### `timesheetParser.ts`
- Exports `TimesheetEntry`, `TimesheetDay`, `ParsedTimesheet`, `BreakPeriod`.
- `parseTimesheet(content)` → `{ days, lines }` for a full file.
- `serializeEntry(entry)` → canonical markdown lines for one session + its breaks.
- Pure helpers: `timeToMinutes`, `formatMinutes`, `minutesToDays`, `entryWorkMinutes`.
- Structural editors: `addEntryToContent(lines, date, entryLines)` and
  `updateEntryLines(lines, entry, newLines|null)` (read-before-write compatible).
- **No other file may parse or build timesheet entry lines.**

### `timesheetView.ts` — `TimesheetView extends ItemView`
- New sidebar panel (view type `timesheet-view`, icon `clock`).
- **Timer section (the panel's hero):** a "live chronograph". `buildTimer(parent)`
  is the single source of the timer card's DOM (used both for the initial render
  and for in-place rebuilds via `rebuildTimer()`); `makeTimerBtn()` builds the
  icon+label action buttons (play / coffee / square). When a session is running
  the card tints to the active org's colour (`--org-colour`, set inline) via a
  faint `color-mix` wash and a breathing status dot, and shifts amber on break.
  Org selector + Start/Break/Resume/Stop. The big tabular-nums clock shows the
  actively-counting value (work, or break time while on break); the off-clock value
  is shown as meta. 1s tick patches `.timesheet-timer-clock` /
  `.timesheet-timer-subvalue` in place (`updateTimerDisplay`). Timer state persisted
  via `activeTimer` in settings (survives restart). Three states: idle → working →
  on_break.
- **Today section:** lists today's entries with an org-coloured left edge, time
  range, break lines, hours, inline edit (pencil) and delete (trash). Total row at
  bottom.
- **Weekly summary:** groups this week's entries by org. A proportion bar
  (`.timesheet-week-bar`, org-coloured segments) shows the week's split across orgs
  at a glance; the per-org rows below are its legend. Each row shows hours,
  fractional days (at 7h/day), and estimated earnings (rate × hours). Grand total
  and total earnings at bottom.
- `TimesheetEntryModal` — add/edit form with org dropdown, time inputs (type="time"),
  and dynamic break list (add/remove with start/end time inputs).
- File IO goes through `this.app.vault`, read-before-write on all mutations.
- Vault 'modify'/'create'/'rename' listeners in `main.ts` trigger re-render.

### `invoiceGenerator.ts`

- Exports `generateInvoice()` (orchestrator), `buildInvoiceMarkdown()` (content),
  `aggregateEntries()` (timesheet → line items), and `nextInvoiceLabel()`.
- Reads the timesheet file, parses via `timesheetParser.parseTimesheet()`, filters
  for org + date range, multiplies hours × org rate for line-item amounts.
- Saves the markdown file to the configured `invoiceFolder`, updating the org's
  `lastInvoiceDate` and `lastInvoiceNumber`.

### `invoiceModal.ts`

- `InvoiceModal extends Modal` — dropdown for org, date-from / date-to text inputs,
  auto-computed invoice number label, optional notes textarea, preview summary,
  and a CTA "Generate Invoice" button.
- Default date-from: day after `org.lastInvoiceDate`, or 30 days ago.
- Launches `generateInvoice()` on submit, shows notice with the file path.

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
