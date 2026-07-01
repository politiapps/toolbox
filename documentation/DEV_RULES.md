# Dev Rules

Hard rules for working in this codebase. These mirror `claude.md` §3 and exist
so the constraints live next to the code. Violating any of these is a bug.

## File access
1. **Never use Node.js `fs`.** Use `this.app.vault.read/modify/create`.
2. **Never overwrite the tasks file blindly.** Read current content first, edit
   the line array, write back (`appendLine` / `replaceLine` do this).

## Parsing
3. **Never parse or build task line strings outside `src/taskParser.ts`.** If
   the format changes, change it there and only there. UI date formatting is not
   task parsing and is allowed in `taskView.ts`.
   - The `🔁` **task-line token** (its place in the line, stripping it from the
     description, emitting it) is owned by `taskParser.ts`, which stores the rule
     as raw text. The recurrence **rule sub-grammar** (`every month on the 2nd
     Monday` → structured rule) and the next-occurrence date math live only in
     `src/recurrence.ts` (pure, like `calendar.ts`). Do not interpret rule text
     anywhere else.

## Configuration
4. **Never hardcode** tag names, section names, file paths, or sort orders.
   Everything user-facing comes from `settings.ts` / the settings tab.

## Events & persistence
5. **Always register vault listeners with `this.registerEvent()`.** The single
   `modify` listener lives in `main.ts`. Do not add per-view listeners.
6. **Persist collapse state and recent tags** via `loadData()`/`saveData()`
   (wrapped by `plugin.loadSettings()` / `saveSettings()`).

## Testing
7. **Always test in a separate development vault**, never the main vault.

## The continuous learning loop
When you fix a non-obvious bug or hit an Obsidian API quirk:
1. Find the root cause.
2. Add a rule/note to `api-notes.md` (quirks) or this file (process rules).
3. State in your output what rule you added.

## Before marking a task complete
- [ ] Parsing change? Only in `taskParser.ts`.
- [ ] File write? Reads first and merges.
- [ ] Vault event? Uses `this.registerEvent()`.
- [ ] Tag / section / path / sort? Comes from settings.
- [ ] `ARCHITECTURE.md` updated for structural changes.
