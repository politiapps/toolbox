# UI & Sidebar View

Component structure of the sidebar panel and the CSS class conventions. The view
lives in `src/taskView.ts`; styles in `styles.css`.

## Layout (top to bottom)

```
┌─ .tasks-panel-content ───────────────┐
│  .tasks-toolbar                       │  (sticky)
│    button.tasks-add-button  "Add Task"│
│  ── for each configured section ──    │
│  .tasks-section                       │
│    .tasks-section-header              │
│      .tasks-chevron                   │
│      .tasks-section-title             │
│      .tasks-count-badge   (incomplete)│
│    .tasks-section-body                │
│      .tasks-row …                     │
│  ── always last ──                    │
│  .tasks-section.tasks-section-completed
│    (header "Completed", collapsed by  │
│     default; rows show ✅ done date)  │
└───────────────────────────────────────┘
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
    .tasks-due (.is-overdue) | .tasks-done-date
    .tasks-priority.tasks-priority-<level>
.tasks-actions
  .tasks-icon-button          (pencil → edit)
  .tasks-icon-button.tasks-delete-button (trash → delete)
```

- Completed rows get `.is-completed` (strikethrough description).
- Action buttons are hidden until row hover (`.tasks-actions` opacity).

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
2. Tag — text input backed by a `<datalist>` of tags found in the file, ordered
   most-recently-used first. New tags can be typed directly.
3. Due date — native `type="date"` input.
4. Priority — dropdown: None / Low / High / Highest.

Submit appends (add) or replaces (edit) the line and refreshes. Used tags are
promoted via `touchRecentTag()`.

## Class naming convention

All classes are prefixed `tasks-` to avoid collisions. State modifiers use
Obsidian's `is-` convention (`is-collapsed`, `is-completed`, `is-overdue`).
Colours come from Obsidian CSS variables (`--text-error`, `--text-muted`, …) so
the panel follows the active theme.
