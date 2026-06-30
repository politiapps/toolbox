# Editable Columns

A Live Preview multi-row / multi-column layout where each cell renders **real**
Obsidian content — transclusions, `dataviewjs`, and Tasks execute, they don't
appear as raw text — and embedded notes are click-to-edit.

Toggle it in **Settings → Toolbox → Editable Columns**.

## Inserting a block

Two ways to drop in a starter two-column block at the cursor (then just edit the
cells):

- The **"Insert columns"** ribbon icon (left ribbon, columns glyph).
- The command palette → **"Insert columns block"**.

Both insert the `%% columns %%` markup below and put the cursor in the first cell.

## Attribution

- Layout and CSS lineage: [Live Columns](https://github.com/nhiwentwest/live-columns) (MIT).
- Click-to-edit-embed mechanism: [Embed Editor](https://github.com/xmisio72/obsidian-embed-editor) (MIT).

## Syntax

Columns are authored with Obsidian **comment markers**, not a code fence. That is
deliberate: a fenced ` ```columns ` container could not hold a cell's own
` ```dataviewjs ` / ` ```tasks ` block (markdown can't nest same-character
fences). Comment markers have no such limit, and they vanish gracefully when the
feature is off.

```
%% columns:start %%
%% col %%
First cell — plain markdown, can include ![[Note A]]
%% col %%
```dataviewjs
dv.list(dv.pages().file.name)
```
%% row %%
A full-width second row (no %% col %% means a single column)
%% columns:end %%
```

| Marker | Meaning |
| --- | --- |
| `%% columns:start %%` | Opens a columns block. |
| `%% columns:end %%` | Closes the block. |
| `%% row %%` | Starts a new row. |
| `%% col %%` | Starts a new column in the current row. |

- Everything between two markers is one **cell**, rendered through Obsidian's
  full markdown pipeline.
- A row with no `%% col %%` is a single full-width column.
- The markers are fixed grammar (like the Tasks priority emojis), not a
  user-configurable setting.

## How cells render

Each cell's markdown is rendered with
`MarkdownRenderer.render(app, cellMarkdown, cellEl, sourcePath, child)`, where
`child` is a loaded `MarkdownRenderChild`. Routing through the real renderer is
the whole point — it runs the registered post-processors, so embeds transclude
and `dataviewjs` / Tasks execute. (Live Columns hand-built HTML and skipped this,
which is why its cells showed raw text.)

### Toolbox's own calendar in a cell

To show the same merged "today" list as the sidebar inside a cell, drop in the
`toolbox-calendar` block (no Dataview or ics-plugin needed):

````
Today's Calendar
```toolbox-calendar
```
````

It reads Toolbox's configured `.ics` feeds and re-renders when they refresh.

### Choices that matter

- **Put `dataviewjs` directly in a cell**, not inside an embedded note.
  Direct blocks render reliably; `dataviewjs` *inside a transclusion* has a known
  tendency to drop to a placeholder until refreshed.
- **Use `![[Note]]` for editable text cells.** Click-to-edit applies to embeds,
  so each editable text cell is its own source note.

## Editing

- **Embeds:** click a transcluded `![[Note]]` inside a cell to open a floating
  editor pre-filled with the source lines; **Save** (or `Mod+Enter`) splices the
  edit back into the source note, and Obsidian re-renders the embed. Only embeds
  are click-to-edit — `dataviewjs` output is not editable.
- **The columns markup itself:** click on empty cell background (not on an
  embed/link/checkbox) to move the cursor into the block, which reveals the raw
  markers for editing. Toggling to Source mode works too.

## Live updates

- A block re-renders only when **its own source changes** — unrelated edits
  elsewhere in the note keep the existing DOM (and any running `dataviewjs`),
  because the widget's `eq()` compares the block's source text.
- `dataviewjs` cells refresh through Dataview's own reactivity: each cell is
  rendered under a live `MarkdownRenderChild`, which Dataview ties its refresh to.

## Dependencies

No hard dependency on Dataview or Tasks. Cells just contain markdown; whatever
the user has installed handles its own blocks, and the layout degrades
gracefully if either plugin is absent.

## Limitations

- Designed for **Live Preview**. (Reading-view rendering of the markers is not
  wired up.)
- Click-to-edit covers `![[note]]` embeds, not arbitrary rendered output.
