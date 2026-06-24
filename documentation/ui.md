# UI & Sidebar View

Component structure of the sidebar panel and the CSS class conventions. The view
lives in `src/taskView.ts`; styles in `styles.css`.

## Design language

The panel is framed as a campaign-operator's **triage board for "today"**. It
inherits Obsidian theme variables (native in light/dark). Sections are **cards**
so each life-area reads as a distinct block. Colour is used in two deliberate,
separate languages: a small **section-identity dot** (a stable hashed hue per
section) and a **priority urgency ramp** (warm = urgent) on priority chips.
Personality comes from type *treatment*, not imported fonts:

- **Uppercase, letter-spaced monospace eyebrows** for structure (section titles,
  the "Today" label, modal heading).
- **Tabular monospace** for counts and dates — an "ops console" register.
- The theme's body face for task descriptions.
- Overdue is the only element allowed to shout (theme `--text-error`).

Per-section colour comes from `sectionAccent(section.id)` in `taskView.ts` — a
stable hue hashed from the section id (follows the section, not its position),
applied via the `--section-accent` CSS custom property to the header dot only.

## Layout (top to bottom)

```
┌─ .tasks-panel-content ────────────────┐
│  .tasks-header (sticky)               │
│    .tasks-today                       │
│      .tasks-today-eyebrow "TODAY"     │
│      .tasks-today-date "Wednesday 24th"│
│    button.tasks-add  (circular "+", right)
│  .tasks-calendar  (card, only if ics URL set)
│    .tasks-calendar-header "Today's events"
│    .tasks-event (time + title) …      │
│  ── for each configured section ──    │
│  .tasks-section  (card) [--section-accent]
│    .tasks-section-header              │
│      .tasks-chevron                   │
│      .tasks-section-dot   (identity hue)
│      .tasks-section-title (heading)   │
│      .tasks-count-badge   (incomplete)│
│      button.tasks-section-add ("+", hover)
│    .tasks-section-body                │
│      .tasks-row …                     │
│  ── always last ──                    │
│  .tasks-section.tasks-section-completed
│    (dashed card, "Completed", no dot, │
│     collapsed by default)             │
└────────────────────────────────────────┘
```

## Task row (`.tasks-row`)

```
[checkbox] Description
           #tag   Thursday 25th   ⏫        [✏️] [🗑️]
.tasks-checkbox
.tasks-row-main
  .tasks-desc-line > .tasks-desc
  .tasks-meta
    .tasks-tag-pill          (one per tag)
    .tasks-due (.is-overdue/.is-today) | .tasks-done-date
    .tasks-priority.tasks-priority-<level>
      .tasks-priority-dot + .tasks-priority-label  (chip)
.tasks-actions
  .tasks-icon-button          (pencil → edit)
  .tasks-icon-button.tasks-delete-button (trash → delete)
```

- The checkbox is a custom round control (CSS `appearance: none`), filled with
  the theme accent when checked.
- `.tasks-due` carries a state class: `.is-overdue` (red) when `due < today`,
  `.is-today` (accent) when `due == today`, otherwise muted.
- Completed rows get `.is-completed` (strikethrough description); their date
  reads "Done <date>".
- Action buttons are hidden until row hover/focus (`.tasks-actions` opacity).

## Behaviours

- **Collapse**: clicking a `.tasks-section-header` toggles the section. State is
  persisted in `settings.collapseState` keyed by `section.id` (or
  `COMPLETED_KEY`). Initial state falls back to the section's
  `collapsedByDefault` (Completed defaults to collapsed).
- **Count badge**: shows the number of *incomplete* tasks for user sections, and
  the total count for Completed.
- **Mark done**: checking the box rewrites the line to `[x]` + `✅ today` and the
  row moves to Completed on the next refresh.
- **Due date**: formatted "Thursday 25th" (weekday + day + ordinal, no year).
  Overdue (`due < today`) adds `.is-overdue` → red.
- **Delete**: shows an inline `.tasks-confirm-popup` ("Delete this task?") with
  Delete / Cancel before removing the line.

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
