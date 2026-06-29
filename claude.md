# claude.md (include verbatim as a file)

# claude.md — Toolbox (Obsidian plugin)

## 1. Core Map & Rules (MANDATORY INITIALIZATION)
Before writing any code or running any commands, you MUST read these files:
- `manifest.json` (Plugin ID, name, and minimum Obsidian API version)
- `src/main.ts` (Plugin entry point — understand registered views and commands before adding new ones)
- `src/taskParser.ts` (Canonical task parsing logic — all reads and writes go through here only)
- `src/settings.ts` (All configurable values — never hardcode anything that appears here)
- `documentation/ARCHITECTURE.md` (Live map of how the plugin is structured)

If `documentation/ARCHITECTURE.md` does not exist, create it before proceeding.

## 2. Domain-Specific Documentation (Read Only When Relevant)

**Task Format & Parsing:**
- `documentation/task-format.md`

**Obsidian API:**
- `documentation/api-notes.md`
- Reference: https://docs.obsidian.md/
- Reference: https://github.com/obsidianmd/obsidian-api

**UI & Sidebar View:**
- `documentation/ui.md`

If a relevant documentation file does not exist, create it in `documentation/` before proceeding.

## 3. Strict Rules — Never Violate These

- **Never use Node.js `fs`.** Always use `this.app.vault.read()` and `this.app.vault.modify()`.
- **Never parse task lines outside `taskParser.ts`.**
- **Never hardcode tag names, section names, file paths, or sort orders.** Everything user-facing comes from settings.
- **Never overwrite the tasks file.** Always read current content first, then merge changes.
- **Always register vault event listeners via `this.registerEvent()`.**
- **Always persist collapse state and recently used tags via `this.loadData()` / `this.saveData()`.**
- **Always test in the development vault, never the main vault.**

## 4. Project Context

**Toolbox** is a single Obsidian plugin (id `toolbox`) that bundles several utilities. Each utility is a *feature* registered from `src/main.ts`; as new features land they get their own module(s) under `src/` and their own doc under `documentation/`.

Its current (and so far only) feature is the **Tasks panel** — a sidebar that reads from and writes to a user-configured tasks file. Tasks are stored in Obsidian Tasks plugin-compatible markdown syntax. All sections, tags, sort orders, and the file path are user-configured via the native settings page — nothing is hardcoded. **Planned features:** custom columns and a timesheet. The rules and notes below currently describe the Tasks feature; new features extend them rather than replace them.

**Task format:**
- [ ] Description #tag 📅 YYYY-MM-DD
- [ ] Description #tag 📅 YYYY-MM-DD ⏫
- [x] Description #tag 📅 YYYY-MM-DD ✅ YYYY-MM-DD

**Priority emojis:** 🔺 highest, ⏫ high, 🔼 medium, 🔽 low, ⏬ lowest (matches the official Obsidian Tasks plugin)

**Date display in UI:** "Thursday 25th" — day name + day number + ordinal suffix, no year. Overdue = red.

## 5. The Continuous Learning Loop

If you fix a non-obvious bug or discover an Obsidian API quirk:
1. Analyse the root cause.
2. Amend `documentation/api-notes.md` or `documentation/DEV_RULES.md` with a rule to prevent recurrence.
3. Confirm in your output that the rule was added and what it says.

## 6. Before Marking Any Task Complete

- [ ] Does the change touch task parsing? Confirm it only happens in `taskParser.ts`.
- [ ] Does the change write to the tasks file? Confirm it reads first and merges.
- [ ] Does the change register a vault event? Confirm it uses `this.registerEvent()`.
- [ ] Does the change involve a tag, section name, file path, or sort order? Confirm it comes from settings, not hardcoded.
- [ ] Has `documentation/ARCHITECTURE.md` been updated to reflect structural changes?