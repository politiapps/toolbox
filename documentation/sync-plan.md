# Sync Plan — keeping the phone fresh without opening anything

**Status:** deferred. The date-staleness half is **done** (see §5); the transport
and background-regeneration halves below are not started.

**Goal:** the Android app *and* its home-screen widget reflect tasks created on
the desktop, without opening Obsidian on the phone and without opening Toolbox.

---

## 1. Why this is three problems, not one

Widget staleness has three independent causes. Fixing any one alone leaves the
widget wrong, which is why the obvious fixes kept not working.

| # | Cause | Symptom | Fixed by |
|---|---|---|---|
| 1 | **Transport.** Obsidian Sync only runs while Obsidian mobile is foregrounded, so `tasks.md` on disk is stale. | Tasks created on desktop never appear. | §2 Syncthing |
| 2 | **No cache regeneration.** `widget_cache` is written only by `writeWidgetCache()` from the webview (`ui/app.ts`). | A fresh file on disk still doesn't reach the widget until Toolbox is opened. | §3 regeneration service |
| 3 | **Frozen dates.** The snapshot stored `dueDays`/`dueLabel`/`dueClass` resolved against the day it was written. | "Today" stays "Today" for days; overdue tasks sit in the Today group. | §5 — **done** |

The ordering matters: #2 sits downstream of #1. A regeneration job re-reads the
same stale file, so it would faithfully and promptly render yesterday's tasks.
Obsidian Sync + regeneration does **not** solve the desktop-tasks problem.

## 2. Transport — replace Obsidian Sync with Syncthing

Obsidian Sync cannot be driven from outside Obsidian: no CLI, no public API, no
Android background service. The `obsidian://open?vault=…` intent launches the app
visibly and reports no completion. So as long as it is the transport, "without
opening Obsidian" is unreachable. It has to be replaced for the phone leg.

**Setup**

1. **PC:** `winget install Syncthing.Syncthing` → GUI at `http://127.0.0.1:8384`.
   Allow through the firewall on private networks. Give it a startup entry or a
   tray wrapper and verify it survives a reboot.
2. **Phone:** Syncthing-Fork (Catfriend1) — the original official Android app was
   archived. Exempt it from battery optimisation, and set run conditions to
   always run (it defaults to charging/Wi-Fi only).
3. **Pair:** PC → Actions → Show ID; phone scans the QR; accept on the PC.
4. **Share:** PC → Add Folder → the vault → Sharing → tick the phone.
5. **Phone path:** shared storage, e.g. `/storage/emulated/0/Documents/Vault`.
   **Not** under `/Android/data/` — the SAF tree grant cannot reach app-private
   dirs on Android 11+. Then re-pick the vault in Toolbox so the grant follows.
6. **Turn off Obsidian Sync** for the phone leg. Two engines on one folder fight
   and generate conflict copies.

**Ignore patterns — one trap.** The usual advice is to ignore all of `.obsidian`.
**Do not.** `syncObsidianConfig()` reads `.obsidian/plugins/toolbox/data.json`
(`storage/types.ts`) on every launch to mirror sections and the tasks path; that
is what makes the app zero-config. Ignore only the churn:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash
```

Set the folder to **staggered file versioning** — that replaces Obsidian Sync's
history, and it is off by default.

**The tradeoff to accept.** Syncthing is peer-to-peer, so both devices must be
online *at the same time*. A sleeping PC means nothing arrives. If that grates,
add an always-on node (NAS, Pi, cheap VPS) to restore store-and-forward.
Concurrent edits produce `.sync-conflict-*` files rather than merging;
`taskService.ts`'s read-then-merge discipline keeps this rare for `tasks.md`.

**Keeping Obsidian Sync is only coherent** if the desktop is a hub — Obsidian
Sync for desktop ↔ other desktops, Syncthing for desktop ↔ phone, each engine
owning a different device pair. With one desktop and one phone it is a
subscription doing nothing Syncthing isn't.

## 3. Background regeneration — getting disk → widget

Only needed after §2; before that it regenerates from stale bytes.

The job must not parse markdown in Java — the parser stays single-sourced in
`@toolbox/task-core` (the premise `WidgetCache.java` is built on). So the Kotlin
side stays dumb: read the file's bytes, hand the string to a headless WebView
running the app bundle, take back the JSON, write it to `Preferences` under
`widget_cache`, and call the existing `TaskWidgetProvider.updateWidget()` path.

Two trigger options:

- **`WorkManager` periodic job.** 15-minute floor; `androidx.work` is not yet in
  `app/build.gradle`. Simple, but Doze and OEM battery managers defer these,
  sometimes for hours. Freshness is best-effort.
- **Foreground service + `FileObserver`** on `tasks.md`, regenerating the moment
  Syncthing writes. The only genuinely reliable "never stale" mechanism on
  modern Android. Costs a persistent (minimisable) notification and needs a real
  filesystem path — i.e. `MANAGE_EXTERNAL_STORAGE`, acceptable given
  distribution is locked to a sideloaded APK.

Recommended: the foreground service. Syncthing already runs a permanent
notification, so a second is a small marginal cost for actual freshness.

## 4. Rejected

- **Forcing Obsidian Sync via `obsidian://` intent** — visible app launch, no
  completion signal, seconds of latency. Not a background mechanism.
- **Self-hosted LiveSync's CouchDB** — plain HTTP, but it stores chunked and
  encrypted documents rather than files; the app would be reimplementing its
  storage format.
- **Cloud-remote for `tasks.md` only** (WebDAV/S3 alongside Obsidian Sync) —
  gives the file two writers on the phone and an ambiguous source of truth.
- **Re-parsing markdown in Kotlin** for the widget — duplicates the parser and
  will drift.

## 5. Done — the frozen-date fix

Landed independently of transport, because it was wrong regardless of it.

- `widgetCache.ts` `WidgetTask` now carries absolute `due: string | null` instead
  of the precomputed `dueDays` / `dueLabel` / `dueClass` trio.
- New `WidgetDates.java` mirrors task-core's `presentation.ts` date rules
  (`daysUntil`, `label`, `state`/`cssClass`, `formatDueShort`, `ordinalSuffix`)
  in Java, for use when no webview is alive. Uses `Calendar`, not `java.time`
  (minSdk 23, no desugaring).
- `WidgetCache.parseTasks()` derives days/label/class on **every** read, so the
  due colour ramp and the date-bucket grouping track the real current date.
- `TaskWidgetProvider.scheduleDateRoll()` sets an inexact `RTC` alarm for the
  next local midnight and re-arms on each fire and each `onUpdate`; cancelled in
  `onDisabled`. Inexact is deliberate — no exact-alarm permission needed, and
  Doze releases it when the phone wakes, which is the only time the widget is
  read.

**Effect:** an untouched widget now keeps its dates, colours and groups correct
as days pass. It still will not show tasks created elsewhere — that is §2 + §3.

Recorded as an extension of DEV_RULES rule 8: *a cache crossing a process
boundary carries absolute values; the reader resolves them against its own now.*
