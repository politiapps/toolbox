# Dev Rules

Hard rules for working in this codebase. These mirror `claude.md` §3 and exist
so the constraints live next to the code. Violating any of these is a bug.

## File access
1. **Never use Node.js `fs`.** Use `this.app.vault.read/modify/create`.
2. **Never overwrite the tasks file blindly.** Read current content first, edit
   the line array, write back (`appendLine` / `replaceLine` do this).

## Parsing
3. **Never parse or build task line strings outside `packages/task-core/src/taskParser.ts`.** If
   the format changes, change it there and only there. UI date formatting is not
   task parsing and is allowed in `taskView.ts`.
    - The `🔁` **task-line token** (its place in the line, stripping it from the
      description, emitting it) is owned by `taskParser.ts`, which stores the rule
      as raw text. The recurrence **rule sub-grammar** (`every month on the 2nd
      Monday` → structured rule) and the next-occurrence date math live only in
      `packages/task-core/src/recurrence.ts` (pure, like `calendar.ts`). Do not
      interpret rule text anywhere else.

## Configuration
4. **Never hardcode** tag names, section names, file paths, or sort orders.
   Everything user-facing comes from `settings.ts` / the settings tab.

## Events & persistence
5. **Always register vault listeners with `this.registerEvent()`.** The single
   `modify` listener lives in `main.ts`. Do not add per-view listeners.
6. **Persist collapse state and recent tags** via `loadData()`/`saveData()`
   (wrapped by `plugin.loadSettings()` / `saveSettings()`).

## Time-relative data
8. **Compute "today"/"now"-relative data at render, not at fetch.** Cache raw
   inputs (e.g. the raw `.ics` feed text in `calendarFeeds`), and derive
   date-dependent views (`getTodayEvents()`) each render against `new Date()`. A
   long-running session (sleep/wake across midnight) otherwise shows a stale
   day's data. Occurrences carry no date, so a cached list silently misrepresents
   the current day.
   - **This binds hardest on snapshots read by another process.** The widget
     cache (`widgetCache.ts` → `WidgetCache.java`) first shipped storing
     `dueDays`/`dueLabel`/`dueClass`, all resolved against the day the *app*
     last rendered. Nothing regenerates that snapshot unless the app is opened,
     so a task stayed labelled "Today", kept its `is-today` colour and stayed in
     the Today group for as long as the app went untouched. It now stores the
     absolute `due` date only, and `WidgetDates.java` derives all three on every
     read. **Rule: a cache crossing a process boundary carries absolute values;
     the reader resolves them against its own "now".** The writer's "now" is not
     a fact about the reader.
   - Anything keyed to the current date also needs a trigger at midnight —
     `TaskWidgetProvider.scheduleDateRoll()` sets an inexact RTC alarm, because
     a 30-minute `updatePeriodMillis` alone leaves the turn-over visibly late.

## Dates
9. **Only ever hold/compare ISO dates as zero-padded `YYYY-MM-DD`.** The plugin
   compares dates by string (`day.date < dateFrom`), which is only correct when
   both sides are zero-padded. A user-typed value like `2026-07-1` silently sorts
   *after* `2026-07-09`, so the invoice date-range filter dropped whole days.
   - **Never take a date via a free text input.** Use a `type="date"` picker (the
     `.timesheet-date-field` chip in `timesheetView.ts` / `invoiceModal.ts`),
     which always emits a valid padded value.
   - Defensive callers can pass through `normalizeISO()` (`invoiceGenerator.ts`)
     before comparing.

10. **Absent scalars on `Task` are `null`, not `undefined`.** `due`, `doneDate`
    and `recurrence` are all typed `string | null`. A helper that derives from
    them must return `string | null` too — writing `string | undefined` compiles
    (the parser's `null` flows straight through an untested branch) and only
    fails at the call site or in a `toBeUndefined()` assertion. Prefer explicit
    `=== null` checks over truthiness when the distinction between "absent" and
    "empty" could ever matter.

## Aggregates
11. **Anything that counts tasks must agree with anything that lists them.**
    The header's `countPressure(flat)` walks every task at any depth, while
    `sortTasks` / `dueBucket` read only a top-level task's own `due`. A dated
    subtask was therefore counted in "N overdue" but never shown as a row — the
    panel asserted work it then hid. Whenever a field gains a new consumer, walk
    *every* consumer of it (sort, group, filter, count, badge) in the same
    change, or the UI starts contradicting itself.
    - Prefer **lifting the real row into the list** over rolling a value up onto
      an ancestor. A roll-up makes a parent claim a deadline it doesn't own, and
      if the child is visible anywhere else you get two rows competing for one
      piece of work. `scheduledSubtasks()` is the pattern to copy.
    - Section membership is by tag, and a subtask may carry none. Any code that
      lifts a nested task into a tag-filtered list has to consider **inherited**
      tags (`ScheduledSubtask.tags`), or the lifted row matches nothing and
      silently disappears.

## Cross-surface presentation
12. **A presentation rule with two renderers belongs in `task-core`.** The due
    label, its proximity ramp, the priority meter and the section accent hue
    were hand-copied from `taskView.ts` into `apps/android/src/dates.ts`. Two
    copies of a rule is a rule that will diverge — the copies had already
    started to, and nothing failed when they did, because neither surface tests
    the other. They now live in `presentation.ts` and both import them.
    A helper is task-core's if it is *pure* and both surfaces must agree on its
    answer; it stays local if it needs the DOM, the vault, or Capacitor.
13. **The widget is the exception, so treat it as one.** RemoteViews cannot
    import TypeScript, so `WidgetTheme.java` is a deliberate hand-port of the
    ramp. Any change to the `--overdue / --today / --soon` values or to
    `SECTION_ACCENTS` has to be made there too — it is the only duplicated
    design constant left, and it is documented as such in `ui.md`.
    - Porting a hash to Java, mind the sign: JS `Math.abs` on `-2^31` gives
      `+2^31` (numbers are doubles) while Java's `int` overload returns
      `-2^31` unchanged, which then indexes an array negatively. Widen to
      `long` before `Math.abs` to reproduce the JS result.

## Testing
7. **Always test in a separate development vault**, never the main vault.

## The continuous learning loop
When you fix a non-obvious bug or hit an Obsidian API quirk:
1. Find the root cause.
2. Add a rule/note to `api-notes.md` (quirks) or this file (process rules).
3. State in your output what rule you added.

## Before marking a task complete
- [ ] Parsing change? Only in `packages/task-core/src/taskParser.ts`.
- [ ] File write? Reads first and merges.
- [ ] Vault event? Uses `this.registerEvent()`.
- [ ] Tag / section / path / sort? Comes from settings.
- [ ] `ARCHITECTURE.md` updated for structural changes.
