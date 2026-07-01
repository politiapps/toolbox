# Task Format

Exact markdown syntax used in the tasks file. All parsing and serialisation of
this format lives in `src/taskParser.ts` and nowhere else.

## Line shapes

```
- [ ] Description #tag 📅 YYYY-MM-DD
- [ ] Description #tag 📅 YYYY-MM-DD ⏫
- [ ] Description #tag 📅 YYYY-MM-DD 🔁 every week
- [x] Description #tag 📅 YYYY-MM-DD ✅ YYYY-MM-DD
```

A task line is any list item matching:

```
^(\s*)-\s+\[([ xX])\]\s+(.*)$
```

- Leading whitespace (indent) is preserved so nested items round-trip.
- `[ ]` = incomplete, `[x]`/`[X]` = complete.
- Non-task lines (headings, blank lines, plain bullets) are ignored by the
  parser and left untouched on write.

## Tokens (within the body)

| Token        | Meaning            | Pattern                                   |
|--------------|--------------------|-------------------------------------------|
| `#tag`       | Tag (zero or more) | `#[A-Za-z0-9_\-/]*[A-Za-z_\-/][A-Za-z0-9_\-/]*` |
| `📅 DATE`    | Due date           | `📅 YYYY-MM-DD`                           |
| `🔁 RULE`    | Recurrence         | `🔁 <rule text>` (see below)             |
| `✅ DATE`    | Completion date    | `✅ YYYY-MM-DD` (only on completed tasks) |
| `🔺`         | Highest priority   | —                                         |
| `⏫`         | High priority      | —                                         |
| `🔼`         | Medium priority    | —                                         |
| (none)       | Normal priority    | —                                         |
| `🔽`         | Low priority       | —                                         |
| `⏬`         | Lowest priority    | —                                         |

Priority emoji match the official Obsidian Tasks plugin so its queries/sorts
interpret the same lines identically.

Dates are always `YYYY-MM-DD`. They are parsed as **local** dates to avoid UTC
off-by-one errors.

## Canonical serialisation order

`serializeTask()` always emits tokens in this order:

```
<indent>- [ |x] <description> <#tags…> <📅 due> <priority> <🔁 recurrence> <✅ done>
```

- `<priority>` is omitted entirely for normal priority.
- `<🔁 recurrence>` is omitted when the task is not recurring.
- `<✅ done>` is only emitted when the task is completed and has a done date.
- A task read from the file and re-serialised may have its tokens reordered into
  this canonical order, but its meaning is preserved.

## Description

The description is the body with all tags, dates, and priority emoji stripped
out and internal whitespace collapsed. It may contain any other text.

## Recurrence (🔁)

Recurrence uses the official Obsidian Tasks `🔁` signifier so the same file
round-trips through both plugins. The rule text after `🔁` is stored verbatim by
`taskParser.ts`; its grammar and the next-occurrence date math live in
`src/recurrence.ts` (the only place recurrence rules are interpreted).

Canonical rule strings the UI produces (all parse in the official Tasks plugin):

```
every day                    every N days
every week                   every N weeks
every <Weekday>              every N weeks on <Weekday>
every month on the <Nth>     every N months on the <Nth>       (day of month)
every month on the <ord> <Weekday>                             (ord = 1st–4th | last)
every month on the last                                        (last day of month)
every year                   every N years
```

Behaviour:

- **Next occurrence is computed from the task's due date, not the completion
  date.** e.g. due the 5th + `every 2 weeks` → next due the 19th, whenever it is
  actually ticked off. A recurring task therefore needs a `📅` due date to
  advance; without one it just completes.
- Completing a recurring task inserts a fresh incomplete copy (with the next due
  date) directly **above** the now-completed line, which keeps its `🔁` and gains
  `✅ today`. Only that single line recurs — subtasks are not copied.
- Day-of-month and Feb-29 overflows **clamp** to the target month's last valid
  day (e.g. the 31st recurs to the 30th in a 30-day month) rather than skipping
  the month as strict rrule would.

## Subtasks and notes

Hierarchy and notes come from indentation:

```
- [ ] Parent task #getup 📅 2026-06-26
    A note line (indented, no checkbox) — the parent's note
    - [ ] Subtask one          ← nested task
    - [ ] Subtask two
```

- A task's **subtasks** are deeper-indented task lines directly under it
  (`children` in the parse tree); nesting is unbounded.
- A task's **notes** are the indented, non-task lines immediately following it,
  before its first subtask (`notes`). Opening a task shows/edits these.
- Indentation may be tabs or spaces; tabs count as 4 columns for depth. New
  subtasks/notes reuse the existing child indent, defaulting to four spaces.
- This stays plain Markdown — the official Tasks plugin still reads every
  checkbox line as its own independent task (no parent/child rollup).

`parseTasks` returns the top-level `tasks` (each with `children`/`notes`) plus a
`flat` list of every task. Structural edits (`setTaskNotes`, `addChildTaskLine`,
`removeTaskBlock`) are pure functions over the line array, located by each
task's `blockStart`/`blockEnd`/`noteStart`/`noteEnd` ranges.
