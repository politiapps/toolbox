# UI & Sidebar View

Component structure of the sidebar panel and the CSS class conventions. The view
lives in `src/taskView.ts`; styles in `styles.css`.

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
  `.tasks-children` recursively, indented with a hairline guide.
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
  `taskView.ts`. `formatDueDisplay()` keeps the long form for `aria-label`s and
  the detail modal.
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
3. Due date — native `type="date"` input that calls `showPicker()` on
   click/focus so the calendar opens from anywhere in the field.
4. Priority — dropdown: None / Highest / High / Medium / Low / Lowest, matching
   the official Tasks plugin emoji (🔺 ⏫ 🔼 🔽 ⏬).

Submit appends (add) or replaces (edit) the line and refreshes. Used tags are
promoted via `touchRecentTag()`.

## Class naming convention

All classes are prefixed `tasks-` to avoid collisions. State modifiers use
Obsidian's `is-` convention (`is-collapsed`, `is-completed`, `is-overdue`).
Colours come from Obsidian CSS variables (`--text-error`, `--text-muted`, …) so
the panel follows the active theme.
