# Android Tasks App — Build Plan

Goal: a standalone **Android app** that behaves **exactly like the Tasks feature set** of the
Toolbox Obsidian plugin, minus the calendar. The user points it at a single `tasks.md`
somewhere on the phone; the app reads and writes that file directly. No monthly fee.

The guiding principle of this whole plan: **reuse, don't reimplement.** The plugin's task
logic is already Obsidian-free TypeScript, and its UI is already plain DOM + CSS. So the
app runs the *same code* inside a native webview and replaces only the handful of Obsidian
API calls. "Exactly like" then falls out by construction instead of by careful re-testing.

---

## 1. Feature parity checklist (what "exactly like" means)

Everything the Tasks feature does today, to be reproduced 1:1:

**Task model & format** (from `taskParser.ts` — reused verbatim)
- [ ] `- [ ]` / `- [x]` checkbox lines
- [ ] `#tags`, `📅` due, priority emojis `🔺⏫🔼🔽⏬`, `🔁` recurrence, `✅` done
- [ ] Nested **subtasks** (indentation tree) and **notes** (indented non-task lines)
- [ ] Canonical token order on write; read-first-then-merge writes (never overwrite blind)

**Rendering & interaction** (from `taskView.ts` — ported, Obsidian deps swapped)
- [ ] User-configured **sections**, each matched by a tag, with per-section **sort order**
      (`due`, `priority`, `priority-due`, `file`)
- [ ] Each top-level task shown in the first matching section only; subtasks under parent
- [ ] Completed section, "most-recently-done first"
- [ ] Completed **subtasks sink to the bottom** of the subtask list (the beta.11 behavior)
- [ ] Due-date colour ramp: overdue / today / tomorrow / soon / upcoming; "Thursday 25th" format
- [ ] Priority chips, `done/total` subtask progress counter, per-task focus time badge
- [ ] "Today" header + pressure line (overdue / due-today counts)
- [ ] Add form + detail modal (description, tag dropdown with recent-first, due date,
      priority, recurrence builder, notes, subtasks); the **"Add & open"** button
- [ ] Collapse state per section, recurrence spawning on complete, drag-to-reparent subtask
- [ ] **Pomodoro** focus timer with per-task accumulated seconds

**Settings** (mirror of `settings.ts`, minus calendar)
- [ ] tasks file location (see §4 — this is the Android-specific part the user asked for)
- [ ] sections (add / reorder / delete, tag, sort, collapsed-by-default)
- [ ] Pomodoro enabled + work/short/long/long-every minutes
- [ ] persisted: `recentTags`, `collapseState`, `pomodoro` state, `taskFocusSeconds`

**Explicitly out of scope:** calendar feed / today-calendar (`calendar.ts`, `calendarView.ts`).

---

## 2. Recommended stack: Capacitor (webview + native shell)

| Option | Reuse of your code | Effort to parity | Verdict |
|---|---|---|---|
| **Capacitor** (recommended) | Parser + recurrence **verbatim**; view DOM + `styles.css` ported | Lowest | ✅ |
| React Native | Parser/recurrence verbatim; UI rewritten in RN components | Medium | ok, more UI work |
| Flutter / native Kotlin | Everything reimplemented in Dart/Kotlin | Highest; will drift | ✗ for "exactly like" |

Capacitor wins because the plugin is *already a web app*: `taskView.ts` builds DOM nodes and
`styles.css` themes them. Capacitor ships that inside an Android WebView and gives native
plugins for the things a webview can't do (file access, notifications). You keep one language
(TypeScript) and one rendering path, so the app can be pixel-identical to the plugin.

---

## 3. Architecture — three layers

```
packages/
  task-core/            ← EXTRACTED FROM THIS REPO, shared by plugin + app
    taskParser.ts       ← moved as-is (already Obsidian-free)
    recurrence.ts       ← moved as-is
    sort.ts             ← sortTasks + section grouping, lifted out of taskView.ts
    __tests__/          ← golden round-trip tests (guard "exactly like")

apps/android/           ← the Capacitor app
  src/
    view/               ← ported taskView rendering (DOM building, no Obsidian imports)
    ui/                 ← Modal/Setting/setIcon replacements (plain DOM + inlined icons)
    storage/            ← file adapter (read/modify tasks.md) + settings store
    styles.css          ← copied from the plugin, tweaked for touch
  android/              ← Capacitor native project (SAF plugin, notifications)
```

The **Obsidian touchpoints to replace** (the entire porting surface) are small and known:

| Obsidian API in `taskView.ts` | App replacement |
|---|---|
| `this.app.vault.read / modify / create` | `storage/file.ts` over the chosen `tasks.md` (§4) |
| `this.app.vault.getAbstractFileByPath` | resolve the persisted file URI |
| `Modal` (add form, detail) | plain fullscreen/bottom-sheet DOM component |
| `Setting` (form rows) | small labelled-input helper |
| `setIcon` (lucide) | inline the specific lucide SVGs used |
| `Notice` | toast (Capacitor Toast or a DOM snackbar) |
| `TextComponent`, `ItemView`, `WorkspaceLeaf` | drop; render into the app root |

Everything else in `taskView.ts` — sorting, section matching, due-date maths, subtask
ordering, recurrence spawning, Pomodoro accrual — is pure logic that moves unchanged.

---

## 4. The "tell it where tasks.md is" problem (Android-specific)

This is the one genuinely new thing to build. Android sandboxes file access, so you can't just
take a raw path. Two viable approaches:

1. **Storage Access Framework (SAF)** — the app opens the system document picker; the user
   taps their `tasks.md`; Android returns a `content://` URI. Request **persistable URI
   permission** so the grant survives reboots. Store the URI in settings. Read/write via a
   Capacitor plugin. **This is the right UX for "point at any file on my phone."**
   - Use an existing community plugin (e.g. a SAF/document-picker Capacitor plugin) or write a
     ~100-line native plugin exposing `pickFile()`, `readFile(uri)`, `writeFile(uri, text)`.
2. **App-scoped / Documents folder** — simpler (Capacitor Filesystem `Directory.Documents`),
   no picker, but the file must live in a fixed app-visible folder. Weaker fit for "anywhere,"
   fine for a first cut if the file sits in `Documents/`.

**Recommendation:** ship with SAF. Budget real time here — persistable-permission edge cases
(file moved, permission revoked, cloud-provider URIs) are the fiddly part.

**External edits & sync:** because the file may be synced (Syncthing/Dropbox) or edited on
desktop, keep the plugin's discipline: **re-read the file immediately before every write and
locate the target by its exact raw line** (this is exactly what `replaceLine`/`applyStructural`
already do — port that logic unchanged). Optionally watch the file / re-read on app resume.

---

## 5. Phased milestones

**Phase 0 — Extract the core (in *this* repo).** Move `taskParser.ts`, `recurrence.ts`, and the
`sortTasks` + section-grouping helpers into a standalone `task-core` package with no Obsidian
imports. Point the plugin at it. Add round-trip golden tests. *Value even if you stop here.*
→ ~1–2 days.

**Phase 1 — Read-only Android app.** Capacitor project; SAF file picker; read `tasks.md`; parse
with `task-core`; render the section list + completed section using ported view code + copied
`styles.css`. No editing yet. → ~1 week. *Milestone: your real tasks render on the phone.*

**Phase 2 — Writes & core interactions.** Complete/uncomplete (with recurrence spawn), add task,
edit in detail modal, notes, add/toggle subtasks, delete, drag-to-reparent. All via re-read-then-
merge writes. → ~2 weeks. *Milestone: full parity with the panel's task actions.*

**Phase 3 — Settings & persistence.** Settings screen (file location, sections CRUD + reorder,
sort orders, Pomodoro config); persist `recentTags`, `collapseState`, `taskFocusSeconds`,
`pomodoro` in app storage (Capacitor Preferences / SQLite). → ~1 week.

**Phase 4 — Pomodoro.** Port the timer; compute elapsed from `focusStart` epoch so it survives
webview suspension; per-task seconds. Add `LocalNotifications` for session-end alerts. → ~3–5 days.

**Phase 5 — Polish & ship.** Touch targets, dark/light theme parity, external-edit reconciliation
on resume, app icon, signing, sideload APK (no Play Store fee required for personal use).
→ ~1 week. *Optional later: home-screen widget.*

**Total to full parity:** ~5–8 weeks part-time. Phase 0–2 (the useful core) is ~3–4 weeks.

---

## 6. Testing — how "exactly like" stays true

- **Shared golden tests** in `task-core`: a corpus of `tasks.md` snippets asserted through
  parse → serialize → parse round-trips. Both the plugin and the app import the same package,
  so they can't diverge on format behavior.
- **Fixture parity:** render the same `tasks.md` in plugin and app, compare section/sort output.
- Manual: external-edit-during-write, recurrence rollover across month boundaries, subtask
  reparent, Pomodoro accrual across background/resume.

---

## 7. Decisions — LOCKED

1. **File access:** ✅ **SAF picker.** User taps `tasks.md` in Android's system file browser;
   app stores the persistable `content://` URI. Works for a file anywhere, incl. synced folders.
2. **Distribution:** ✅ **Sideloaded APK** for now (free, no Play Store $25 fee). Signed debug/
   release APK installed directly. Play Store deferred.
3. **Pomodoro notifications:** ✅ **In this version.** `LocalNotifications` fires on focus/break
   end. Part of Phase 4, not deferred.
4. **Repo layout:** ✅ **Same repo (monorepo).** `task-core` (shared by plugin + app) and
   `apps/android` live here; the plugin build repoints at `task-core`. No copy-paste of logic.
