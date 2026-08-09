# UI & Sidebar View

Component structure of the sidebar panel and the CSS class conventions. The view
lives in `src/taskView.ts`; styles in `styles.css`.

## Three surfaces, one language

The same triage rules are rendered by three things, and this document governs
all of them:

| Surface | Renderer | Styles | Class prefix |
| --- | --- | --- | --- |
| Obsidian sidebar | `src/taskView.ts` | `styles.css` (theme variables) | `tasks-` |
| Android app | `apps/android/src/ui/taskRow.ts`, `ui/app.ts` | `apps/android/src/styles.css` (literal hexes) | `task-`, `section-` |
| Home-screen widget | `TaskWidgetService.java` + `res/layout/widget_row.xml` | `WidgetTheme.java` + `res/drawable/widget_*.xml` | n/a (RemoteViews) |

What they share is **behaviour**, not markup: the labels, the proximity buckets,
the priority meter and the section accent hue all come from
`presentation.ts` in `@toolbox/task-core`, so a date cannot read "Tomorrow" in
one place and "Wed 26th" in another. The widget can't import TypeScript, so
`WidgetTheme.java` is a hand-kept port of the ramp — **the one place a change
here has to be made twice.** Its `sectionAccent()` mirrors task-core's
(including the 32-bit hash), and its constants mirror the `--overdue / --today /
--soon` custom properties in the app's `styles.css`.

Where the surfaces legitimately differ, it is because the input device differs,
not the design:

- **Row actions exist only in the sidebar.** It can afford a pencil / + / trash
  because they are revealed on hover and cost nothing until then. A phone has no
  hover, so the same buttons would sit there permanently at 44dp each — ~88px of
  a ~300px row, which measurably broke descriptions across lines mid-word on a
  1080p device. On the app the **row body is the button**: tapping it opens the
  detail sheet, which carries the same actions with room to show them. The
  phone's equivalent of "hidden until hover" is "one layer in", not "always on".
- The app and widget keep 44dp touch targets, and the app's header date is
  larger because it heads a whole screen rather than a pane. The widget drops the priority meter's five-segment *shape* encoding
— RemoteViews can't size views per row below API 31 — and carries rank as the
spine plus the chip's ink decay instead.

## Design language

The panel is framed as a campaign-operator's **triage board for "today"**. It
inherits Obsidian theme variables (native in light/dark). Sections are **cards**
so each life-area reads as a distinct block. Colour is used in deliberate,
separate languages: a per-section **identity spine** (a stable hashed hue down
the card's left edge), a **priority urgency ramp** (warm = urgent) carried by
each row's own left spine plus its chip, and a **due-date proximity ramp**
(overdue red → today orange) that the header's triage status line reuses.
Personality comes from type *treatment*, not imported fonts:

- **Uppercase, letter-spaced monospace eyebrows** for structure (section titles,
  the "Today" label, modal heading).
- **Tabular monospace** for counts and dates — an "ops console" register.
- The theme's body face for task descriptions.
- Overdue is the only element allowed to shout (alarm red).

The **hero** is the header's triage status line (`.tasks-pressure`): below the
date it reports today's load as a typeset console readout — `N overdue · N due
today`, overdue in the alarm red — or "Nothing due today" when clear. Counts come
from `countPressure(flat)` over all incomplete dated tasks. It is deliberately a
status line in the existing mono register, not a dashboard stat card.

Per-section colour comes from `sectionAccent(section.id)` in `taskView.ts` — a
stable hue hashed from the section id (follows the section, not its position),
applied via the `--section-accent` CSS custom property as the card's left spine.

## Layout (top to bottom)

```
┌─ .tasks-panel-content ────────────────┐
│  .tasks-header (sticky)               │
│    .tasks-header-top                  │
│      .tasks-today                     │
│        .tasks-today-eyebrow "TODAY"   │
│        .tasks-today-date "Wednesday 24th"
│      button.tasks-add  (circular "+", right)
│    .tasks-pressure  (triage status line)
│      .tasks-stat.is-overdue  "N overdue"
│      .tasks-stat-sep  "·"             │
│      .tasks-stat.is-today  "N due today"
│      (or .tasks-pressure-clear "Nothing due today")
│      [⟳]  (reschedule-overdue button, only when overdue > 0)
│  .tasks-view-switcher  (All · Today · This week · one chip per section)
│  .tasks-pomodoro  (focus timer, if enabled)
│    .tasks-pomodoro-top (phase + cycle dots)
│    .tasks-pomodoro-clock  "MM:SS"     │
│    .tasks-pomodoro-task (task selector)
│    .tasks-pomodoro-total  "N on this task"
│    .tasks-pomodoro-controls (start/skip/reset)
│  .tasks-calendar  (card, only if ics URL set)
│    .tasks-calendar-header "Today's events"
│    .tasks-event (time + title) …      │
│  ── for each configured section ──    │
│  .tasks-section  (card, left spine [--section-accent])
│    .tasks-section-header              │
│      .tasks-chevron                   │
│      .tasks-section-title (heading)   │
│      .tasks-count-badge   (incomplete)│
│      button.tasks-section-add ("+", hover)
│    .tasks-section-body                │
│      .tasks-due-group (.is-overdue/.is-today/
│        .is-upcoming/.is-undated) — only when
│        sort = "due" and >1 bucket present
│      .tasks-row …                     │
│  ── always last ──                    │
│  .tasks-section.tasks-section-completed
│    (dashed card, "Completed", neutral │
│     spine, collapsed by default)      │
└────────────────────────────────────────┘
```

## Task row (`.tasks-row`)

```
[spine][checkbox] Description                        ( Today )
                  ▁▂▃▄▅ HIGH   #tag                  [✏️] [🗑️]
.tasks-row  (::before = priority spine, [--priority-color]; .is-due-overdue)
.tasks-checkbox
.tasks-row-main
  .tasks-desc-line                                (flex: text | due column)
    .tasks-desc-text > .tasks-desc + .tasks-note-indicator
    .tasks-due-slot.tasks-due (.is-overdue/.is-today/…)   ← fixed right column
      | .tasks-due-slot.tasks-done-date
  .tasks-meta                                     (hidden when :empty)
    .tasks-priority.tasks-priority-<level>       (squared chip, leads)
      .tasks-priority-meter > .tasks-priority-seg ×5 (.is-on = lit)
      .tasks-priority-label
    .tasks-tag-pill          (one per tag)
.tasks-actions
  .tasks-icon-button          (pencil → edit)
  .tasks-icon-button.tasks-delete-button (trash → delete)
```

- Tasks with subtasks show a `.tasks-twisty` expand/collapse chevron (state
  persisted per task), a `.tasks-progress` `done/total` badge, and render their
  `.tasks-children` recursively, indented with a hairline guide. See
  **Subtask integration** below.
- A `.tasks-note-indicator` icon appears when a task has notes.
- Clicking the description (or the pencil) opens `TaskDetailModal`: editable
  fields, a notes textarea, and a subtask list (toggle + add).
- Adding a subtask (row `+` or the detail modal) opens the full add form
  pre-tagged with the parent's project tag, with due date + priority.
- A subtask hides any tag pill it shares with its parent (inherited, not new),
  and a top-level task renders in only the first section it matches — so nothing
  appears twice.
- The checkbox is a custom round control (CSS `appearance: none`), filled with
  the theme accent when checked.
- **Triage salience.** Priority and due date are the two facts the panel exists
  to surface. They previously shared the meta line, which is what made them hard
  to tell apart at speed: both were ~10px chips whose horizontal offset changed
  from row to row, so neither could be scanned as a column and the two ramps
  (red priority / red overdue) sat side by side. They are now split across the
  row and encoded four ways over:
  1. **Opposite edges** — priority owns the row's **left** edge (spine + chip),
     the due date owns a fixed **right-hand column** on the description line.
     Position alone tells them apart, before any colour is resolved.
  2. **Vertical alignment** — the due column is fixed-width (`.tasks-due-slot`,
     `min-width: 62px`, `flex-shrink: 0`), so every row's date starts and ends at
     the same x. Comparing dates down a list is what the column is *for*; that
     alignment does more work than any colour on the badges.
  3. **Silhouette** — priority is a *squared* chip, a due date a *rounded*
     badge, so the two never share a shape even out of the corner of the eye.
  4. **Ink decay** — loudness falls off with distance/rank, so "loud" always
     means "sooner or more important" without resolving the hue:
     solid → tinted → outlined → bare text. Both ramps step at *every* level;
     hue is never the only difference between adjacent levels (highest vs high
     as red vs orange at 10px is the hardest discrimination to make quickly).
- `.tasks-due` carries a state class driving that ramp. The first two steps are
  both **filled**, because "act now" vs "act later" is the split that matters and
  the fade is better spent on the later steps: `.is-overdue` (solid alarm red,
  white text), `.is-today` (solid orange, white text), `.is-tomorrow` (amber tint
  + hairline), `.is-soon` (neutral outline, 2 days), `.is-upcoming` (no badge at
  all — faint text, so a wall of future dates reads as texture).
- Dates in the column use the **short** weekday form (`formatDueShort` →
  "Thu 25th"); the full "Thursday 25th" would wrap or eat the description at
  sidebar width, and survives in the badge's `aria-label`.
- **Overdue washes the whole row** (`.tasks-row.is-due-overdue`, a ~7% red tint,
  plus `font-weight: 600` on the description). It is the one state that must be
  findable in any section under any sort order without reading. Only overdue
  gets a wash — giving one to "today" as well leaves two competing washes and
  neither reads as an alarm.
- Completed rows get `.is-completed` (strikethrough description); their done
  date sits in the same right-hand column, faint.
- Action buttons are hidden until row hover/focus (`.tasks-actions` opacity).

## Subtask integration

The panel used to treat a subtask two contradictory ways at once: as a **real
task** when counting (`countPressure(flat)` walks every task at any depth), but
as **decoration on its parent** when sorting and grouping (`sortTasks` /
`dueBucket` read only a top-level task's own `due`). So a subtask due today,
hanging off an undated parent, was counted in the header's "N overdue" while its
parent sat at the bottom of the list under "No date" — the header claimed work
the list never showed.

**A dated subtask is a scheduled commitment in its own right**, so it is lifted
into the list where its date puts it rather than being represented by proxy.
`sectionCandidates(tasks)` (task-core) is the single source of what a section
lists: every incomplete top-level task, plus every incomplete **dated** subtask
at any depth, each as a `SectionCandidate { task, tags, parent }`. Both
`taskView.render()` and the Android app's `App.render()` build their sections
from it, so the two can't drift on which rows appear or how tags match. From
there rows sort, group and render exactly like any other.

- **The lifted row is a second view, not a move.** The subtask still renders
  under its parent as well, so a parent's subtask list stays a complete plan.
  The two views are separate rows over one task — checking either writes the
  same line.
- **Nesting *is* tag inheritance.** A subtask belongs to its parent's project
  whether or not anyone retyped the tag on it, so `SectionCandidate.tags` is the
  task's own tags plus every ancestor's, de-duplicated, outermost first.
  Matching on raw `task.tags` would drop a hand-written untagged subtask out of
  every section — the exact failure this feature exists to fix.
- **A lifted row is not demoted.** Its deadline is real, so it keeps a top-level
  task's full treatment — spine, priority chip, due badge, overdue wash — and
  adds only a `.tasks-parent-crumb` breadcrumb (`↳ Parent title`) leading the
  meta line. That position is deliberate: placing the task ("outline — of
  what?") comes before any other context. The crumb truncates rather than
  wrapping, and clicking it opens the parent's detail modal.
- **No due-date roll-up.** A parent never inherits a subtask's urgency:
  `dueBucket` reads the task's own `due` only. With the subtask present as its
  own row, rolling the date up as well would file two rows under Overdue for one
  piece of late work.
- **Subtasks fold by default** (`isCollapsed(key, true)`). The panel is a triage
  board of top-level commitments, not a full outline. Nothing urgent hides this
  way, because anything dated has already been lifted into the list.

Nested subtask rows are **subordinate in type, not in treatment**: the
description steps down to 0.83rem so the hierarchy is legible, but chips, badges
and the row spine are identical to a top-level task's. The `.tasks-children`
indent is wider (13px) and its guide rail fainter than before, because at the
old spacing the rail and the row's own 4px priority spine sat ~9px apart and
read as a doubled rail, which stopped the spine registering as a signal at all.

**A task's own subtask list — inside its detail modal, not the main list —
carries the same two facts.** `TaskDetailModal.renderSubtasks()` (and the
app's `openDetail()`) show each subtask's due badge and priority chip
(`renderDueSlot`/`renderPriorityChip` — the same helpers a row uses, factored
out so the two can't drift), and `orderSubtasks()` (task-core) lists them by
**due date, then priority** — the same rule a due-sorted section uses —
before sinking completed ones to the bottom. Opening a task to plan its
subtasks used to show only a checkbox and a description in whatever order
they were typed; the schedule wasn't visible until you opened each subtask in
turn, and the list didn't reflect what was actually most pressing.

## Due-date group dividers (`.tasks-due-group`)

A section sorted by **Due date** is really three jobs stacked — what's late,
what's due today, what's ahead — so the list is broken at those boundaries
instead of running together as one column of rows. `renderDueGroups()` in
`taskView.ts` splits the already-sorted list with `groupTasksByDue()` (task-core)
into `overdue → today → upcoming → undated`, dropping empty buckets, and emits a
divider per bucket: a mono uppercase label, a count, and a hairline rule running
to the lane's edge.

- Dividers appear **only** when the section's sort is `due` **and** more than one
  bucket is present — a single-bucket list needs no label, the whole list is that
  bucket. Other sort orders render rows exactly as before.
- The divider colours reuse the due-badge ramp so a divider and the rows under it
  read as one signal: `.is-overdue` (filled alarm-red tab — the loudest thing on
  the panel after the badges), `.is-today` (orange tint + hairline outline),
  `.is-upcoming` / `.is-undated` (faint, reference only) via `--group-colour`.
- Grouping never reorders: it only inserts boundaries into `sortTasks()` output.

## View switcher and mass reschedule

Both surfaces used to show every configured section stacked at once, with no
way to focus on one category or to see "everything due soon" across
categories, and no bulk action for a backlog of overdue work. The **view
switcher** (`.tasks-view-switcher` / `.view-switcher`) and **mass reschedule**
address that, sharing `ViewId`/`VIEW_ALL`/`VIEW_TODAY`/`VIEW_WEEK` and
`dueWithin()` from `presentation.ts` so the two surfaces can't drift on what a
view contains.

- **The chip strip** sits between the header and the Pomodoro/calendar cards:
  `All` (the historical stacked-everything view, still the default) · `Today`
  · `This week` · one chip per configured section, each carrying that
  section's own accent dot (`sectionAccent(section.id)`) so identity follows
  through from its card. The active chip is solid/filled; inactive chips are
  outlined — the panel's existing ink-decay language (solid = active/urgent,
  faint = quiet), not a new colour introduced for this. Selection is
  persisted per surface (`settings.activeView` / `AppSettings.activeView`),
  like `collapseState` already is — the plugin and the app each remember
  their own last-viewed tab, not synced between them. A view naming a
  since-deleted section falls back to `All` (`resolveActiveView()`).
- **A section chip** renders just that one section's card, nothing else
  (`Completed` still follows). Deleting a section resets `activeView` to
  `All` if it was the active one.
- **`Today` / `This week`** render a flat, cross-cutting list instead of any
  section's card: every incomplete task in the file, any section, any depth
  (via `sectionCandidates()`, same as a normal section), filtered by
  `dueWithin(due, days)` and run through the same `renderDueGroups()` /
  `groupTasksByDue()` divider machinery a due-sorted section uses. `Today` is
  `days = 0` (overdue + due today only); `This week` is `days = 6` — a
  **rolling 7-day span** (today + the next 6 days), not a calendar week, to
  match the panel's existing rolling relative-date language ("Tomorrow", "3d
  late"). Undated tasks never appear in either. An empty result says "Nothing
  due today" / "Nothing due this week" rather than showing nothing.
- **Mass reschedule**: when there's a backlog (`pressure.overdue > 0` in the
  active scope), a small calendar-glyph button rides on the header's "N
  overdue" stat. Its scope always matches the active view — a section chip
  reschedules only that section's overdue tasks (by tag, own + inherited);
  `All`/`Today`/`This week` reschedule every incomplete overdue task in the
  file. The scoped count is computed the same way the header counts overdue
  work in the first place (`overdueCandidates()`), so the number shown and
  the set acted on can never disagree (`DEV_RULES.md` §11).
  - The plugin opens an inline popover (`.tasks-reschedule-popup`, styled
    like the existing `.tasks-confirm-popup` delete-confirm): `Today` /
    `Tomorrow` quick picks plus a `type="date"` field (never free text, per
    `DEV_RULES.md` §9), then Confirm/Cancel.
  - The app opens a bottom sheet instead (`ui/reschedule.ts`, via the same
    `openModal()` every other app action uses) — an anchored popover risks
    running off a phone-width header, and a sheet is this surface's own
    pattern for anything needing more than a tap (see `ui/addModal.ts`). Same
    Today/Tomorrow/custom-date content.
  - Confirming re-reads the file, re-selects the same scoped overdue set from
    a fresh parse (so a task that changed since the view last rendered isn't
    touched), and rewrites every match's `due` line via `serializeTask` in a
    single read-modify-write pass — `rescheduleOverdue()` in `taskView.ts` /
    `taskService.ts`.
- **The home-screen widget is unaffected.** It keeps mirroring *every*
  category regardless of which view the phone app is showing
  (`buildWidgetSnapshot()` in `app.ts` always walks every configured
  section) — RemoteViews can't host a chip strip or a popover, so the widget
  stays the fixed, read-only surface it already was.

## Behaviours

- **Sort within a section**: "Due date" orders by date and then breaks ties by
  **priority**, so the most urgent thing on a given day heads that day's run.
  ("Priority, then due date" remains the inverse.) See `sortTasks()` in
  `packages/task-core/src/sort.ts`.
- **Collapse**: clicking a `.tasks-section-header` toggles the section. State is
  persisted in `settings.collapseState` keyed by `section.id` (or
  `COMPLETED_KEY`). Initial state falls back to the section's
  `collapsedByDefault` (Completed defaults to collapsed).
- **Count badge**: shows the number of *incomplete* tasks for user sections, and
  the total count for Completed.
- **Mark done**: checking the box rewrites the line to `[x]` + `✅ today` and the
  row moves to Completed on the next refresh.
- **Due date**: the near term reads *relatively*, because how far off a date is
  is the triage fact — "Today", "Tomorrow", "Yesterday", "Nd late" (up to a week
  overdue). Beyond that window it formats as "Thu 25th" (short weekday + day +
  ordinal, no year), where the calendar date carries more meaning than the gap.
  See `dueLabel()` / `dueState()` / `dueClass()` / `formatDueShort()` in
  task-core's `presentation.ts`. `formatDueDisplay()` keeps the long form for
  `aria-label`s and the detail modal.
- **Priority**: `.tasks-row` gets `is-priority-<level>`, which sets
  `--priority-color` for both the row's left spine (`::before`) and the chip.
  Only highest/high/medium paint the spine — low and lowest deliberately leave
  it blank so ink always means urgency. Every row reserves the gutter
  (`padding-left`) whether it paints or not, so descriptions stay aligned.
  The spine is 4px (a 3px hairline reads as a divider at sidebar width, not as a
  signal) and encodes rank as **length** too — highest runs the row's full
  height, high and medium are progressively shorter stubs — so the top three
  levels stay apart in a greyscale or high-contrast theme.
  The chip's five-segment meter lights `priorityFilled()` bars (5 = highest …
  1 = lowest), encoding rank as **shape**, so the level survives without colour
  vision. The bars are 3px wide with a 1.5px gap: at the previous 2px/1px they
  read as texture rather than a count, which defeats the purpose.
- **Delete**: shows an inline `.tasks-confirm-popup` ("Delete this task?") with
  Delete / Cancel before removing the line.
- **Drag to subtask**: each `.tasks-row` is draggable. While dragging it gets
  `.is-dragging` (dimmed); the row under the cursor gets `.is-drop-target` (accent
  spine). Dropping re-parents the dragged task — with its whole subtree — as a
  child of the drop target (`moveTaskUnder` → `moveTaskAsChild`). Dropping onto
  itself or one of its own descendants is ignored.

The "Today's events" list (`.tasks-calendar`) is rendered by
`calendarView.renderTodayCalendar`, shared with the `toolbox-calendar` code block
so both look identical.

## Add / Edit form (`TaskFormModal`)

An Obsidian `Modal` with `.tasks-form-modal`. Fields:
1. Description (text, autofocused).
2. Tag — a dropdown of existing tags (most-recently-used first) plus a
   "+ Create new tag" option that reveals a text box (`newTagSetting`, hidden by
   default). "No tag" is also available.
3. Due date — a `type="date"` input driven by the custom calendar popover
   (see below), clearable back to "no date".
4. Priority — dropdown: None / Highest / High / Medium / Low / Lowest, matching
   the official Tasks plugin emoji (🔺 ⏫ 🔼 🔽 ⏬).

Submit appends (add) or replaces (edit) the line and refreshes. Used tags are
promoted via `touchRecentTag()`.

## Date picker

Every date field in the plugin (task due date in the add/detail modals, the
reschedule popover, the timesheet entry date, the invoice From/To/Invoice-date
chips) opens the same custom calendar via `attachDatePicker()`
(`src/datePicker.ts`), never the OS/browser one — Chromium gives that native
popup no CSS hooks, so "today" and past dates couldn't be told apart at a
glance inside it (see `DEV_RULES.md` #14). The Android app has its own
equivalent (`apps/android/src/ui/datePicker.ts`), rendered as an inline
reveal instead of a popover — a bottom sheet is already open at every call
site there, and stacking a floating popover on top of one risks clipping on a
phone-width screen. Both share the same grid math
(`datePickerGrid.buildMonthGrid`, task-core) so "today" and "this month"
can't mean something different on the two surfaces.

- **Header**: `‹ August 2026 ›` — month nav either side of a mono uppercase
  label.
- **Weekday row**: locale-short initials (Su Mo Tu …), faint.
- **Day grid**: Sunday-first, padded with faint adjacent-month days so every
  row has 7 cells.
- **Today** gets a ring (`box-shadow`/outline in the accent colour), not a
  fill — it has to stay legible as "today" even once another date is
  selected (which *is* filled), so the two states can't be confused with each
  other.
- **Selected** (the field's current value) is filled solid in the accent
  colour.
- **Past dates** (and other-month days) recede to `--text-faint` — the same
  ink-decay idea the due-date ramp already uses, just applied to a grid
  instead of a badge. Past dates stay clickable: due dates and timesheet
  entries can be legitimately backdated, so the picker only marks lateness,
  it never blocks picking it.
- **Footer**: a "Today" jump, plus "Clear" where an empty date is valid (the
  task due-date field; not the reschedule popover, timesheet, or invoice
  fields, which always need a value).

`attachDatePicker()` only takes over *opening* the field: it sets the input
`readOnly` (blocks the native picker/keyboard, leaves it focusable) and, on a
day click, sets `input.value` and dispatches `input`/`change` — so every
existing `onChange` / `addEventListener("change", …)` at the call site keeps
working unmodified. It never introduces a new value channel.

## Class naming convention

All classes are prefixed `tasks-` to avoid collisions. State modifiers use
Obsidian's `is-` convention (`is-collapsed`, `is-completed`, `is-overdue`).
Colours come from Obsidian CSS variables (`--text-error`, `--text-muted`, …) so
the panel follows the active theme.
