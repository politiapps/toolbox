/**
 * taskView.ts — The sidebar ItemView plus the add/edit task modal.
 *
 * This file owns rendering and user interaction. It NEVER parses or serialises
 * task lines itself — it delegates every such operation to taskParser.ts.
 *
 * File access goes exclusively through this.app.vault (read / modify / create).
 * Writes always read current content first and merge, never overwrite blindly.
 */

import {
	ItemView,
	WorkspaceLeaf,
	Modal,
	Setting,
	Notice,
	TFile,
	TextComponent,
	setIcon,
} from "obsidian";
import type TasksPlugin from "./main";
import {
	Task,
	TaskInput,
	Priority,
	SortOrder,
	parseTasks,
	serializeTask,
	serializeTaskBlock,
	collectTags,
	childIndentOf,
	findTaskByRaw,
	setTaskNotes,
	addChildTaskLine,
	removeTaskBlock,
	moveTaskAsChild,
	insertTaskLineBefore,
	RecurrenceRule,
	WEEKDAY_LABELS,
	parseRecurrence,
	recurrenceToText,
	describeRecurrenceText,
	nextDueDate,
	PRIORITY_RANK,
	PRIORITY_LABEL,
	sortTasks,
	groupTasksByDue,
	DUE_BUCKET_LABELS,
	tagListHasTag,
	countDescendants,
	orderSubtasks,
	sectionCandidates,
	SectionCandidate,
	todayISO,
	formatDueDisplay,
	formatDueShort,
	daysUntil,
	dueLabel,
	dueState,
	dueClass,
	PRIORITY_SEGMENTS,
	priorityFilled,
	formatClock,
	formatFocus,
	sectionAccent,
	hash32,
	dueWithin,
	addDaysISO,
	ViewId,
	VIEW_ALL,
	VIEW_TODAY,
	VIEW_WEEK,
} from "@toolbox/task-core";
import { renderTodayCalendar } from "./calendarView";
import { attachDatePicker } from "./datePicker";
import {
	SectionConfig,
	COMPLETED_KEY,
	PomodoroState,
	touchRecentTag,
} from "./settings";

export const VIEW_TYPE_TASKS = "tasks-panel-view";

/* ------------------------------------------------------------------ */
/* View-local helpers                                                  */
/* ------------------------------------------------------------------ */
/* Date formatting, the due-date ramp, the priority meter and the section
   accent hue live in `@toolbox/task-core` (presentation.ts) — the Android app
   presents the same facts, and a second copy here is how the two drift. */

/**
 * The due badge (or, once completed, the done date) in the shared
 * `.tasks-due-slot` treatment. Shared by a task row and the detail modal's
 * subtask list so a subtask reads the same due state either place it's
 * shown, not just in the main list.
 */
function renderDueSlot(parent: HTMLElement, task: Task): void {
	if (task.completed && task.doneDate) {
		parent.createSpan({
			cls: "tasks-due-slot tasks-done-date",
			text: formatDueShort(task.doneDate),
			attr: { "aria-label": `Done ${formatDueDisplay(task.doneDate)}` },
		});
	} else if (task.due) {
		const dueEl = parent.createSpan({
			cls: "tasks-due-slot tasks-due",
			text: dueLabel(task.due),
			attr: { "aria-label": `Due ${formatDueDisplay(task.due)}` },
		});
		dueEl.addClass(dueClass(task.due));
	}
}

/**
 * The priority chip (five-segment meter + label), or nothing for `normal`.
 * Shared by a task row and the detail modal's subtask list — see
 * `renderDueSlot`.
 */
function renderPriorityChip(parent: HTMLElement, priority: Priority): void {
	if (priority === "normal") return;
	const chip = parent.createSpan({
		cls: `tasks-priority tasks-priority-${priority}`,
		attr: { "aria-label": `${PRIORITY_LABEL[priority]} priority` },
	});
	const meter = chip.createSpan({ cls: "tasks-priority-meter" });
	const lit = priorityFilled(priority);
	for (let i = 1; i <= PRIORITY_SEGMENTS; i++) {
		const seg = meter.createSpan({ cls: "tasks-priority-seg" });
		if (i <= lit) seg.addClass("is-on");
	}
	chip.createSpan({ cls: "tasks-priority-label", text: PRIORITY_LABEL[priority] });
}

/** Unique descriptions of incomplete tasks, first-seen order (Pomodoro picker). */
function uniqueIncompleteNames(flat: Task[]): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const t of flat) {
		if (t.completed) continue;
		const d = t.description.trim();
		if (d && !seen.has(d)) {
			seen.add(d);
			names.push(d);
		}
	}
	return names;
}

/* ------------------------------------------------------------------ */
/* The sidebar view                                                    */
/* ------------------------------------------------------------------ */

export class TasksView extends ItemView {
	plugin: TasksPlugin;
	private allTags: string[] = [];
	/** Raw line text of the task currently being dragged (drag-to-subtask). */
	private draggedTaskRaw: string | null = null;
	/** Pomodoro card element + tick handle + current task options. */
	private pomodoroEl: HTMLElement | null = null;
	private pomodoroInterval: number | null = null;
	private pomodoroTaskNames: string[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: TasksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TASKS;
	}

	getDisplayText(): string {
		return "Tasks";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("tasks-panel");
		await this.refresh();
	}

	async onClose(): Promise<void> {
		// The vault 'modify' listener lives in main.ts; only the Pomodoro tick is
		// owned by this view.
		this.stopPomodoroTick();
	}

	/* ----------------------------- file IO ----------------------------- */

	/** Resolve the configured tasks file, or null if it does not exist yet. */
	private getTasksFile(): TFile | null {
		const path = this.plugin.settings.tasksFilePath;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	/** Ensure the tasks file exists, creating it (and parent folders) if needed. */
	private async ensureTasksFile(): Promise<TFile> {
		const existing = this.getTasksFile();
		if (existing) return existing;
		const path = this.plugin.settings.tasksFilePath;
		return this.app.vault.create(path, "");
	}

	/**
	 * Append a new line to the tasks file, reading current content first.
	 */
	private async appendLine(line: string): Promise<void> {
		const file = await this.ensureTasksFile();
		const content = await this.app.vault.read(file);
		const needsNewline = content.length > 0 && !content.endsWith("\n");
		const next = content + (needsNewline ? "\n" : "") + line + "\n";
		await this.app.vault.modify(file, next);
	}

	/**
	 * Replace (newLine !== null) or delete (newLine === null) the first line that
	 * exactly matches oldLine. Re-reads the file so external edits are respected.
	 */
	private async replaceLine(oldLine: string, newLine: string | null): Promise<void> {
		const file = this.getTasksFile();
		if (!file) return;
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const idx = lines.indexOf(oldLine);
		if (idx === -1) {
			new Notice("Could not locate the task — it may have changed externally.");
			return;
		}
		if (newLine === null) {
			lines.splice(idx, 1);
		} else {
			lines[idx] = newLine;
		}
		await this.app.vault.modify(file, lines.join("\n"));
	}

	/* ---------------------------- rendering ---------------------------- */

	async refresh(): Promise<void> {
		const file = this.getTasksFile();
		const content = file ? await this.app.vault.read(file) : "";
		const { tasks, flat } = parseTasks(content);
		this.allTags = this.mergedTagList(flat);
		this.pomodoroTaskNames = uniqueIncompleteNames(flat);

		// Incomplete top-level tasks plus every dated subtask lifted to stand on
		// its own, each carrying its inherited tags. Shared with the Android app
		// so the two can't drift on what's listed or how tags match. Computed once
		// up front so the header's scoped overdue count, the view switcher and
		// whichever view is active all agree on the same candidate set.
		const candidates = sectionCandidates(tasks);
		const activeView = this.resolveActiveView();
		const scopeTag = this.scopeTagFor(activeView);

		const root = this.contentEl;
		root.empty();
		root.addClass("tasks-panel-content");

		this.renderPanelHeader(root, countPressure(flat), candidates, scopeTag);
		this.renderViewSwitcher(root, activeView);
		this.renderPomodoro(root);
		this.renderCalendar(root);

		// No file at the configured path — say so plainly instead of showing an
		// empty panel that looks like "you have no tasks".
		if (!file) {
			this.renderMissingFileNotice(root);
			return;
		}

		if (activeView === VIEW_TODAY || activeView === VIEW_WEEK) {
			this.renderCrossCuttingView(root, candidates, activeView === VIEW_TODAY ? 0 : 6);
		} else {
			// A task renders in the first section it matches only — never twice
			// within the section list. A lifted subtask's nested copy is rendered by
			// its parent's row, not from here, so the two views don't collide.
			const shown = new Set<Task>();
			const sectionsToShow =
				activeView === VIEW_ALL
					? this.plugin.settings.sections
					: this.plugin.settings.sections.filter((s) => s.id === activeView);
			for (const section of sectionsToShow) {
				const matching = candidates.filter(
					(c) => !shown.has(c.task) && tagListHasTag(c.tags, section.tag)
				);
				matching.forEach((c) => shown.add(c.task));
				this.renderSection(root, section, matching);
			}
		}

		const completed = tasks.filter((t) => t.completed);
		this.renderCompletedSection(root, completed);
	}

	/** The active view, falling back to "All" if it names a since-deleted section. */
	private resolveActiveView(): ViewId {
		const v = this.plugin.settings.activeView;
		if (v === VIEW_ALL || v === VIEW_TODAY || v === VIEW_WEEK) return v;
		return this.plugin.settings.sections.some((s) => s.id === v) ? v : VIEW_ALL;
	}

	/** The section tag a view is scoped to, or null when it spans every task. */
	private scopeTagFor(view: ViewId): string | null {
		if (view === VIEW_ALL || view === VIEW_TODAY || view === VIEW_WEEK) return null;
		return this.plugin.settings.sections.find((s) => s.id === view)?.tag ?? null;
	}

	private async setActiveView(view: ViewId): Promise<void> {
		if (this.plugin.settings.activeView === view) return;
		this.plugin.settings.activeView = view;
		await this.plugin.saveSettings();
		await this.refresh();
	}

	/**
	 * The chip strip below the header: "All", the two cross-cutting due-window
	 * views, then one chip per configured section (carrying that section's own
	 * accent dot, so identity follows through from its card). Replaces showing
	 * every section stacked at once with a choice of what to look at.
	 */
	private renderViewSwitcher(root: HTMLElement, activeView: ViewId): void {
		const strip = root.createDiv({ cls: "tasks-view-switcher" });

		const chip = (id: ViewId, label: string, accent?: string): void => {
			const btn = strip.createEl("button", { cls: "tasks-view-chip" });
			if (id === activeView) btn.addClass("is-active");
			if (accent) {
				const dot = btn.createSpan({ cls: "tasks-view-chip-dot" });
				dot.style.setProperty("--section-accent", accent);
			}
			btn.createSpan({ text: label });
			btn.addEventListener("click", () => this.setActiveView(id));
		};

		chip(VIEW_ALL, "All");
		chip(VIEW_TODAY, "Today");
		chip(VIEW_WEEK, "This week");
		for (const section of this.plugin.settings.sections) {
			chip(section.id, section.name, sectionAccent(section.id));
		}
	}

	/**
	 * Every incomplete task in the file (any section, any depth, via the same
	 * `sectionCandidates` a normal section uses) whose due date falls inside the
	 * window, run through the same due-group dividers a due-sorted section uses.
	 * `days` is 0 for "Today" (overdue + due today only) and 6 for "This week"
	 * (a rolling 7-day span, not a calendar week) — undated tasks never appear
	 * in either.
	 */
	private renderCrossCuttingView(root: HTMLElement, candidates: SectionCandidate[], days: number): void {
		const filtered = candidates.filter((c) => c.task.due && dueWithin(c.task.due, days));
		const promotedBy = new Map<Task, Task>();
		for (const c of filtered) if (c.parent) promotedBy.set(c.task, c.parent);
		const sorted = sortTasks(
			filtered.map((c) => c.task),
			"due"
		);

		const wrap = root.createDiv({ cls: "tasks-section tasks-section-crosscut" });
		if (sorted.length === 0) {
			wrap.createDiv({
				cls: "tasks-empty",
				text: days === 0 ? "Nothing due today" : "Nothing due this week",
			});
			return;
		}
		const body = wrap.createDiv({ cls: "tasks-section-body" });
		this.renderDueGroups(body, sorted, promotedBy);
	}

	/** Tags from the file, ordered by recently-used first, then file order. */
	private mergedTagList(tasks: Task[]): string[] {
		const fileTags = collectTags(tasks);
		const fileSet = new Set(fileTags);
		const recent = this.plugin.settings.recentTags.filter((t) => fileSet.has(t));
		const recentSet = new Set(recent);
		const rest = fileTags.filter((t) => !recentSet.has(t));
		return [...recent, ...rest];
	}

	private renderPanelHeader(
		root: HTMLElement,
		pressure: Pressure,
		candidates: SectionCandidate[],
		scopeTag: string | null
	): void {
		// The panel is framed around "today" — the lens for due-date triage.
		const header = root.createDiv({ cls: "tasks-header" });

		const top = header.createDiv({ cls: "tasks-header-top" });
		const date = top.createDiv({ cls: "tasks-today" });
		date.createDiv({ cls: "tasks-today-eyebrow", text: "Today" });
		date.createDiv({ cls: "tasks-today-date", text: formatDueDisplay(todayISO()) });

		const add = top.createEl("button", { cls: "tasks-add" });
		setIcon(add, "plus");
		add.setAttr("aria-label", "Add task");
		add.addEventListener("click", () => this.openAddForm());

		// Triage status line: today's load, in the ops-console register. Overdue is
		// the one thing allowed to shout, colour-bonded to the due-date ramp below.
		const status = header.createDiv({ cls: "tasks-pressure" });
		if (pressure.overdue === 0 && pressure.dueToday === 0) {
			status.createSpan({ cls: "tasks-pressure-clear", text: "Nothing due today" });
		} else {
			if (pressure.overdue > 0) {
				const s = status.createDiv({ cls: "tasks-stat is-overdue" });
				s.createSpan({ cls: "tasks-stat-num", text: String(pressure.overdue) });
				s.createSpan({ cls: "tasks-stat-label", text: "overdue" });
			}
			if (pressure.overdue > 0 && pressure.dueToday > 0) {
				status.createSpan({ cls: "tasks-stat-sep", text: "·" });
			}
			if (pressure.dueToday > 0) {
				const s = status.createDiv({ cls: "tasks-stat is-today" });
				s.createSpan({ cls: "tasks-stat-num", text: String(pressure.dueToday) });
				s.createSpan({ cls: "tasks-stat-label", text: "due today" });
			}
		}

		// Mass reschedule, scoped to whatever view is active — offered only when
		// there's a backlog to act on, so "Reschedule" never appears with nothing
		// behind it. Matches `pressure.overdue` exactly when unscoped (both walk
		// every incomplete dated task), so the header's count and the button's
		// reach can never disagree (see DEV_RULES.md §11).
		const overdue = overdueCandidates(candidates, scopeTag, todayISO());
		if (overdue.length > 0) {
			const wrap = status.createSpan({ cls: "tasks-reschedule-wrap" });
			const btn = wrap.createEl("button", { cls: "tasks-reschedule-btn" });
			setIcon(btn, "calendar-clock");
			btn.setAttr("aria-label", "Reschedule overdue tasks");
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.openReschedulePopup(
					wrap,
					overdue.map((c) => c.task),
					scopeTag
				);
			});
		}
	}

	/**
	 * Inline popover (styled like `.tasks-confirm-popup`) offering Today /
	 * Tomorrow / a custom date, then applying it via `rescheduleOverdue`.
	 */
	private openReschedulePopup(anchor: HTMLElement, targets: Task[], scopeTag: string | null): void {
		anchor.querySelector(".tasks-reschedule-popup")?.remove();

		const today = todayISO();
		let selected = today;

		const popup = anchor.createDiv({ cls: "tasks-reschedule-popup" });
		popup.createDiv({
			cls: "tasks-reschedule-title",
			text: `Reschedule ${targets.length} overdue task${targets.length === 1 ? "" : "s"} to…`,
		});

		const quick = popup.createDiv({ cls: "tasks-reschedule-quick" });
		const todayBtn = quick.createEl("button", {
			cls: "tasks-reschedule-quick-btn is-selected",
			text: "Today",
		});
		const tomorrowBtn = quick.createEl("button", { cls: "tasks-reschedule-quick-btn", text: "Tomorrow" });

		const dateRow = popup.createDiv({ cls: "tasks-reschedule-date-row" });
		dateRow.createSpan({ cls: "tasks-reschedule-date-label", text: "or pick a date" });
		const dateInput = dateRow.createEl("input", { cls: "tasks-reschedule-date", type: "date" });
		dateInput.value = today;
		attachDatePicker(dateInput);

		const selectQuick = (btn: HTMLButtonElement, iso: string): void => {
			selected = iso;
			dateInput.value = iso;
			todayBtn.removeClass("is-selected");
			tomorrowBtn.removeClass("is-selected");
			btn.addClass("is-selected");
		};
		todayBtn.addEventListener("click", () => selectQuick(todayBtn, today));
		tomorrowBtn.addEventListener("click", () => selectQuick(tomorrowBtn, addDaysISO(today, 1)));
		dateInput.addEventListener("change", () => {
			if (!dateInput.value) return;
			selected = dateInput.value;
			todayBtn.removeClass("is-selected");
			tomorrowBtn.removeClass("is-selected");
		});

		const actions = popup.createDiv({ cls: "tasks-reschedule-actions" });
		const confirmBtn = actions.createEl("button", { cls: "mod-cta", text: "Confirm" });
		const cancelBtn = actions.createEl("button", { text: "Cancel" });
		const cleanup = (): void => popup.remove();
		confirmBtn.addEventListener("click", async () => {
			cleanup();
			await this.rescheduleOverdue(selected, scopeTag);
		});
		cancelBtn.addEventListener("click", cleanup);
	}

	/**
	 * Push every overdue task in scope to `newDue`. Re-reads and re-selects the
	 * target set from a fresh parse — like `applyStructural` — so a task that
	 * changed or was completed since the view last rendered isn't touched, then
	 * rewrites every match's `due` in a single read-modify-write pass.
	 */
	private async rescheduleOverdue(newDue: string, scopeTag: string | null): Promise<void> {
		const file = this.getTasksFile();
		if (!file) return;
		const content = await this.app.vault.read(file);
		const { tasks, lines } = parseTasks(content);
		const targets = overdueCandidates(sectionCandidates(tasks), scopeTag, todayISO());
		if (targets.length === 0) return;

		for (const { task: t } of targets) {
			lines[t.blockStart] = serializeTask({
				indent: t.indent,
				description: t.description,
				tags: t.tags,
				due: newDue,
				priority: t.priority,
				recurrence: t.recurrence,
				completed: false,
				doneDate: null,
			});
		}
		await this.app.vault.modify(file, lines.join("\n"));
		await this.refresh();
	}

	/** "Today" calendar block above the tasks (only when an .ics URL is set). */
	private renderCalendar(root: HTMLElement): void {
		if (this.plugin.settings.calendars.length === 0) return;
		renderTodayCalendar(root, this.plugin.getTodayEvents(), this.plugin.calendarError);
	}

	/* ----------------------------- Pomodoro ---------------------------- */

	/** Current state, or a fresh idle Focus phase when never started. */
	private pomoState(): PomodoroState {
		const s = this.plugin.settings.pomodoro;
		if (s) return s;
		return {
			phase: "work",
			running: false,
			endsAt: null,
			remaining: this.pomoDurationMs("work"),
			completed: 0,
			taskKey: null,
			focusStart: null,
		};
	}

	private pomoDurationMs(phase: PomodoroState["phase"]): number {
		const st = this.plugin.settings;
		const min =
			phase === "work" ? st.pomodoroWorkMin : phase === "short" ? st.pomodoroShortMin : st.pomodoroLongMin;
		return Math.max(1, min) * 60_000;
	}

	private pomoRemainingMs(s: PomodoroState): number {
		if (s.running && s.endsAt !== null) return Math.max(0, s.endsAt - Date.now());
		return Math.max(0, s.remaining);
	}

	/** Which phase follows the current one, and the running focus-session count. */
	private nextPhase(s: PomodoroState): { phase: PomodoroState["phase"]; completed: number } {
		if (s.phase === "work") {
			const completed = s.completed + 1;
			const every = Math.max(1, this.plugin.settings.pomodoroLongEvery);
			return { phase: completed % every === 0 ? "long" : "short", completed };
		}
		return { phase: "work", completed: s.completed };
	}

	/** Set a phase's fields in place (duration, end, and focus anchor). */
	private applyPhase(
		s: PomodoroState,
		next: { phase: PomodoroState["phase"]; completed: number },
		running: boolean,
	): void {
		const dur = this.pomoDurationMs(next.phase);
		s.phase = next.phase;
		s.completed = next.completed;
		s.running = running;
		s.remaining = dur;
		s.endsAt = running ? Date.now() + dur : null;
		s.focusStart = running && next.phase === "work" ? Date.now() : null;
	}

	/** Bank focus time accrued since `focusStart` to the current task. */
	private flushFocus(): void {
		const s = this.plugin.settings.pomodoro;
		if (!s || !s.running || s.phase !== "work" || s.focusStart === null || !s.taskKey) return;
		const secs = Math.floor((Date.now() - s.focusStart) / 1000);
		if (secs > 0) {
			const map = this.plugin.settings.taskFocusSeconds;
			map[s.taskKey] = (map[s.taskKey] ?? 0) + secs;
		}
		s.focusStart = Date.now();
	}

	/** Catch up a timer that ran past its end while the panel was closed. */
	private reconcilePomodoro(): void {
		const s = this.plugin.settings.pomodoro;
		if (!s || !s.running || s.endsAt === null) return;
		let changed = false;
		let guard = 0;
		while (s.running && s.endsAt !== null && s.endsAt <= Date.now() && guard < 300) {
			if (s.phase === "work" && s.focusStart !== null && s.taskKey) {
				const secs = Math.max(0, Math.floor((s.endsAt - s.focusStart) / 1000));
				if (secs > 0) {
					const map = this.plugin.settings.taskFocusSeconds;
					map[s.taskKey] = (map[s.taskKey] ?? 0) + secs;
				}
			}
			const phaseStart: number = s.endsAt;
			const next = this.nextPhase(s);
			const dur = this.pomoDurationMs(next.phase);
			s.phase = next.phase;
			s.completed = next.completed;
			s.endsAt = phaseStart + dur;
			s.remaining = dur;
			s.focusStart = next.phase === "work" ? phaseStart : null;
			changed = true;
			guard++;
		}
		if (changed) void this.plugin.saveSettings();
	}

	/** Total focus seconds for a task, including the interval in progress. */
	private taskFocusTotal(desc: string): number {
		const stored = this.plugin.settings.taskFocusSeconds[desc] ?? 0;
		const s = this.plugin.settings.pomodoro;
		if (s && s.running && s.phase === "work" && s.focusStart !== null && s.taskKey === desc) {
			return stored + Math.max(0, Math.floor((Date.now() - s.focusStart) / 1000));
		}
		return stored;
	}

	private renderPomodoro(root: HTMLElement): void {
		if (!this.plugin.settings.pomodoroEnabled) return;
		const card = root.createDiv({ cls: "tasks-pomodoro" });
		this.pomodoroEl = card;
		this.buildPomodoro(card);
	}

	private rebuildPomodoro(): void {
		if (this.pomodoroEl) this.buildPomodoro(this.pomodoroEl);
	}

	private buildPomodoro(parent: HTMLElement): void {
		this.reconcilePomodoro();
		parent.empty();
		parent.removeClass("is-work");
		parent.removeClass("is-break");

		const s = this.pomoState();
		parent.addClass(s.phase === "work" ? "is-work" : "is-break");

		const top = parent.createDiv({ cls: "tasks-pomodoro-top" });
		const phaseText = s.phase === "work" ? "Focus" : s.phase === "short" ? "Break" : "Long break";
		top.createSpan({ cls: "tasks-pomodoro-phase", text: phaseText });

		const every = Math.max(1, this.plugin.settings.pomodoroLongEvery);
		const dots = top.createDiv({ cls: "tasks-pomodoro-dots" });
		const done = s.completed % every;
		for (let i = 0; i < every; i++) {
			const dot = dots.createSpan({ cls: "tasks-pomodoro-dot" });
			if (i < done) dot.addClass("is-done");
		}

		const clock = parent.createDiv({ cls: "tasks-pomodoro-clock" });
		clock.textContent = formatClock(this.pomoRemainingMs(s));

		// Task focus selector.
		const taskRow = parent.createDiv({ cls: "tasks-pomodoro-task" });
		taskRow.createSpan({ cls: "tasks-pomodoro-task-label", text: "On" });
		const select = taskRow.createEl("select", { cls: "tasks-pomodoro-select" });
		const NONE = "__none__";
		select.createEl("option", { text: "Nothing in particular", value: NONE });
		const names = [...this.pomodoroTaskNames];
		if (s.taskKey && !names.includes(s.taskKey)) names.unshift(s.taskKey);
		for (const n of names) {
			const opt = select.createEl("option", { text: n, value: n });
			if (s.taskKey === n) opt.selected = true;
		}
		if (!s.taskKey) select.value = NONE;
		select.addEventListener("change", () =>
			this.pomoSetTask(select.value === NONE ? null : select.value),
		);

		if (s.taskKey) {
			parent.createDiv({
				cls: "tasks-pomodoro-total",
				text: `${formatFocus(this.taskFocusTotal(s.taskKey))} on this task`,
			});
		}

		const controls = parent.createDiv({ cls: "tasks-pomodoro-controls" });
		const primary = controls.createEl("button", { cls: "tasks-pomodoro-btn is-primary" });
		setIcon(primary.createSpan({ cls: "tasks-pomodoro-btn-icon" }), s.running ? "pause" : "play");
		primary.createSpan({ text: s.running ? "Pause" : "Start" });
		primary.addEventListener("click", () => this.pomoToggle());

		const skip = controls.createEl("button", { cls: "tasks-pomodoro-btn" });
		setIcon(skip, "skip-forward");
		skip.setAttr("aria-label", "Skip to next phase");
		skip.addEventListener("click", () => this.pomoSkip());

		const reset = controls.createEl("button", { cls: "tasks-pomodoro-btn" });
		setIcon(reset, "rotate-ccw");
		reset.setAttr("aria-label", "Reset timer");
		reset.addEventListener("click", () => this.pomoReset());

		if (s.running) this.startPomodoroTick();
		else this.stopPomodoroTick();
	}

	private async pomoToggle(): Promise<void> {
		const s = this.pomoState();
		this.plugin.settings.pomodoro = s;
		if (s.running) {
			this.flushFocus();
			s.remaining = this.pomoRemainingMs(s);
			s.running = false;
			s.endsAt = null;
			s.focusStart = null;
		} else {
			const rem = s.remaining > 0 ? s.remaining : this.pomoDurationMs(s.phase);
			s.running = true;
			s.remaining = rem;
			s.endsAt = Date.now() + rem;
			s.focusStart = s.phase === "work" ? Date.now() : null;
		}
		await this.plugin.saveSettings();
		this.rebuildPomodoro();
	}

	private async pomoSkip(): Promise<void> {
		const s = this.pomoState();
		this.plugin.settings.pomodoro = s;
		const wasRunning = s.running;
		this.flushFocus();
		this.applyPhase(s, this.nextPhase(s), wasRunning);
		await this.plugin.saveSettings();
		this.rebuildPomodoro();
	}

	private async pomoReset(): Promise<void> {
		const s = this.pomoState();
		this.plugin.settings.pomodoro = s;
		this.flushFocus();
		s.phase = "work";
		s.completed = 0;
		s.running = false;
		s.remaining = this.pomoDurationMs("work");
		s.endsAt = null;
		s.focusStart = null;
		await this.plugin.saveSettings();
		this.rebuildPomodoro();
	}

	/** Change the focused task, banking any in-progress focus to the old one. */
	private async pomoSetTask(taskKey: string | null): Promise<void> {
		const s = this.pomoState();
		this.plugin.settings.pomodoro = s;
		this.flushFocus();
		s.taskKey = taskKey;
		await this.plugin.saveSettings();
		this.rebuildPomodoro();
	}

	private async pomoComplete(): Promise<void> {
		const s = this.pomoState();
		this.plugin.settings.pomodoro = s;
		this.flushFocus();
		const next = this.nextPhase(s);
		this.applyPhase(s, next, true);
		await this.plugin.saveSettings();
		new Notice(next.phase === "work" ? "Focus time" : next.phase === "long" ? "Long break" : "Break time");
		this.rebuildPomodoro();
	}

	private startPomodoroTick(): void {
		this.stopPomodoroTick();
		this.pomodoroInterval = window.setInterval(() => this.pomodoroTick(), 250);
	}

	private stopPomodoroTick(): void {
		if (this.pomodoroInterval !== null) {
			window.clearInterval(this.pomodoroInterval);
			this.pomodoroInterval = null;
		}
	}

	private pomodoroTick(): void {
		const s = this.plugin.settings.pomodoro;
		if (!s || !s.running) {
			this.stopPomodoroTick();
			return;
		}
		const rem = this.pomoRemainingMs(s);
		const clock = this.pomodoroEl?.querySelector<HTMLElement>(".tasks-pomodoro-clock");
		if (clock) clock.textContent = formatClock(rem);
		const total = this.pomodoroEl?.querySelector<HTMLElement>(".tasks-pomodoro-total");
		if (total && s.taskKey) total.textContent = `${formatFocus(this.taskFocusTotal(s.taskKey))} on this task`;
		if (rem <= 0) {
			this.stopPomodoroTick();
			void this.pomoComplete();
		}
	}

	private renderMissingFileNotice(root: HTMLElement): void {
		const path = this.plugin.settings.tasksFilePath;
		const notice = root.createDiv({ cls: "tasks-missing" });
		notice.createDiv({ cls: "tasks-missing-title", text: "No tasks file found" });
		notice.createDiv({
			cls: "tasks-missing-body",
			text: "Nothing exists at this path. Check it in settings, or create the file here.",
		});
		notice.createEl("code", { cls: "tasks-missing-path", text: path });

		const actions = notice.createDiv({ cls: "tasks-missing-actions" });
		const createBtn = actions.createEl("button", { cls: "mod-cta", text: "Create file" });
		createBtn.addEventListener("click", async () => {
			try {
				await this.ensureTasksFile();
				await this.refresh();
			} catch (e) {
				new Notice(`Couldn't create ${path} — its folder may not exist.`);
			}
		});
	}

	private isCollapsed(key: string, fallback: boolean): boolean {
		const state = this.plugin.settings.collapseState;
		return key in state ? state[key] : fallback;
	}

	private async setCollapsed(key: string, collapsed: boolean): Promise<void> {
		this.plugin.settings.collapseState[key] = collapsed;
		await this.plugin.saveSettings();
	}

	private renderSection(root: HTMLElement, section: SectionConfig, entries: SectionCandidate[]): void {
		const collapsed = this.isCollapsed(section.id, section.collapsedByDefault);
		// Ordering and grouping stay pure `Task[]` operations (task-core owns
		// them); the lifted-subtask parentage rides alongside in a lookup.
		const promotedBy = new Map<Task, Task>();
		for (const c of entries) if (c.parent) promotedBy.set(c.task, c.parent);
		const tasks = entries.map((c) => c.task);
		const sorted = sortTasks(tasks, section.sort);

		const sectionEl = root.createDiv({ cls: "tasks-section" });
		// Each lane carries a stable accent hue derived from its id — the one
		// place colour is spent. Rows indent off this left spine.
		sectionEl.style.setProperty("--section-accent", sectionAccent(section.id));

		const header = this.renderHeader(sectionEl, section.name, tasks.length, collapsed, async (next) => {
			await this.setCollapsed(section.id, next);
			this.refresh();
		});
		header.dataset.sectionId = section.id;

		// Per-section add: opens the form pre-assigned to this category's tag.
		const addBtn = header.createEl("button", { cls: "tasks-section-add" });
		setIcon(addBtn, "plus");
		addBtn.setAttr("aria-label", `Add task to ${section.name}`);
		addBtn.addEventListener("click", (e) => {
			e.stopPropagation(); // don't toggle collapse
			this.openAddForm(section.tag);
		});

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "tasks-section-body" });
			if (sorted.length === 0) {
				body.createDiv({ cls: "tasks-empty", text: "Nothing due here" });
			} else if (section.sort === "due") {
				this.renderDueGroups(body, sorted, promotedBy);
			} else {
				for (const task of sorted) this.renderTask(body, task, [], promotedBy.get(task));
			}
		}
	}

	/**
	 * Render a due-sorted list broken at its proximity boundaries. What's late
	 * and what's due today are different jobs, so they get a visible edge
	 * between them rather than running together as one column of rows. A single
	 * bucket needs no label — the whole list is that bucket.
	 */
	private renderDueGroups(body: HTMLElement, sorted: Task[], promotedBy: Map<Task, Task>): void {
		const groups = groupTasksByDue(sorted, todayISO());
		for (const group of groups) {
			if (groups.length > 1) {
				const divider = body.createDiv({
					cls: `tasks-due-group is-${group.bucket}`,
				});
				divider.createSpan({
					cls: "tasks-due-group-label",
					text: DUE_BUCKET_LABELS[group.bucket],
				});
				divider.createSpan({
					cls: "tasks-due-group-count",
					text: String(group.tasks.length),
				});
			}
			for (const task of group.tasks) this.renderTask(body, task, [], promotedBy.get(task));
		}
	}

	private renderCompletedSection(root: HTMLElement, tasks: Task[]): void {
		const collapsed = this.isCollapsed(COMPLETED_KEY, true);
		// Most recently completed first.
		const sorted = [...tasks].sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));

		const sectionEl = root.createDiv({ cls: "tasks-section tasks-section-completed" });
		this.renderHeader(sectionEl, "Completed", tasks.length, collapsed, async (next) => {
			await this.setCollapsed(COMPLETED_KEY, next);
			this.refresh();
		});

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "tasks-section-body" });
			if (sorted.length === 0) {
				body.createDiv({ cls: "tasks-empty", text: "Completed tasks land here" });
			} else {
				for (const task of sorted) this.renderTask(body, task);
			}
		}
	}

	private renderHeader(
		parent: HTMLElement,
		title: string,
		count: number,
		collapsed: boolean,
		onToggle: (collapsed: boolean) => void
	): HTMLElement {
		const header = parent.createDiv({ cls: "tasks-section-header" });
		if (collapsed) header.addClass("is-collapsed");

		const chevron = header.createSpan({ cls: "tasks-chevron" });
		setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

		header.createSpan({ cls: "tasks-section-title", text: title });
		header.createSpan({ cls: "tasks-count-badge", text: String(count) });

		header.addEventListener("click", () => onToggle(!collapsed));
		return header;
	}

	/**
	 * Render one task row.
	 *
	 * `parentTags` suppresses tag pills inherited from the row's parent when the
	 * row is nested. `promotedFrom` is set only on the *lifted* copy of a dated
	 * subtask standing in the main list — it names the parent for the breadcrumb
	 * and marks the row so it can't be mistaken for a top-level commitment.
	 */
	private renderTask(
		parent: HTMLElement,
		task: Task,
		parentTags: string[] = [],
		promotedFrom?: Task
	): void {
		const item = parent.createDiv({ cls: "tasks-item" });
		const row = item.createDiv({ cls: "tasks-row" });
		if (task.completed) row.addClass("is-completed");
		if (promotedFrom) row.addClass("is-promoted");
		// Priority is a property of the whole task, so it also colours the row's
		// left spine — readable while scanning, before any label is read.
		if (task.priority !== "normal") row.addClass(`is-priority-${task.priority}`);
		// Due state is carried by the whole row too (a faint wash), not only the
		// badge: an overdue row should register peripherally, without reading it.
		if (!task.completed && task.due) row.addClass(`is-due-${dueState(task.due)}`);

		this.attachDragHandlers(row, task);

		const hasChildren = task.children.length > 0;
		const collapseKey = "task:" + hashKey(task.raw);
		// Subtasks fold away by default: the panel is a triage board of top-level
		// commitments, not a full outline, and expanding everything buries that
		// structure. Nothing urgent hides this way — a dated subtask is lifted
		// into the list as its own row by `scheduledSubtasks()`, so it is visible
		// whether or not its parent happens to be open.
		const collapsed = hasChildren && this.isCollapsed(collapseKey, true);

		// Expand/collapse twisty (or a spacer to keep rows aligned).
		const twisty = row.createSpan({ cls: "tasks-twisty" });
		if (hasChildren) {
			setIcon(twisty, collapsed ? "chevron-right" : "chevron-down");
			twisty.addClass("is-clickable");
			twisty.addEventListener("click", async (e) => {
				e.stopPropagation();
				await this.setCollapsed(collapseKey, !collapsed);
				this.refresh();
			});
		}

		const checkbox = row.createEl("input", { type: "checkbox", cls: "tasks-checkbox" });
		checkbox.checked = task.completed;
		checkbox.addEventListener("change", () => {
			if (checkbox.checked && !task.completed) this.markDone(task);
			else if (!checkbox.checked && task.completed) this.markUndone(task);
		});

		const main = row.createDiv({ cls: "tasks-row-main" });

		const descLine = main.createDiv({ cls: "tasks-desc-line" });
		const descWrap = descLine.createSpan({ cls: "tasks-desc-text" });
		const desc = descWrap.createSpan({ cls: "tasks-desc is-clickable", text: task.description });
		desc.setAttr("aria-label", "Open task");
		desc.addEventListener("click", () => this.openDetail(task));
		if (task.notes) {
			const note = descWrap.createSpan({ cls: "tasks-note-indicator" });
			setIcon(note, "align-left");
			note.setAttr("aria-label", "Has notes");
		}

		// The due date lives in a fixed right-hand column on the description line,
		// so dates form a scannable vertical strip: the eye compares them down the
		// list instead of hunting for them at a different offset in every row.
		// Priority owns the left edge, due owns the right — the two facts triage
		// turns on are separated by *position* before any colour is resolved.
		renderDueSlot(descLine, task);

		const meta = main.createDiv({ cls: "tasks-meta" });

		// On a lifted row, the parent leads the meta line: it is the first thing
		// you need in order to place the task ("outline — of what?"), and without
		// it the row is indistinguishable from a top-level commitment.
		if (promotedFrom) {
			const crumb = meta.createSpan({
				cls: "tasks-parent-crumb",
				attr: { "aria-label": `Subtask of ${promotedFrom.description}` },
			});
			crumb.createSpan({ cls: "tasks-parent-crumb-mark", text: "↳" });
			crumb.createSpan({ cls: "tasks-parent-crumb-name", text: promotedFrom.description });
			crumb.addEventListener("click", (e) => {
				e.stopPropagation();
				this.openDetail(promotedFrom);
			});
		}

		// Priority leads the meta line — it is the other fact triage turns on, so
		// it gets first read; context (tags, recurrence, progress) follows.
		renderPriorityChip(meta, task.priority);

		// Skip a tag pill the parent already shows — it's inherited, not new info.
		for (const tag of task.tags) {
			if (parentTags.includes(tag)) continue;
			meta.createSpan({ cls: "tasks-tag-pill", text: tag });
		}

		if (task.recurrence) {
			const recur = meta.createSpan({ cls: "tasks-recur" });
			setIcon(recur.createSpan({ cls: "tasks-recur-icon" }), "repeat");
			recur.createSpan({ cls: "tasks-recur-label", text: describeRecurrenceText(task.recurrence) });
		}

		if (hasChildren) {
			const done = task.children.filter((c) => c.completed).length;
			meta.createSpan({
				cls: "tasks-progress",
				text: `${done}/${task.children.length}`,
				attr: { "aria-label": `${done} of ${task.children.length} subtasks done` },
			});
		}

		// Focus time logged against this task via the Pomodoro timer.
		const focusSecs = this.taskFocusTotal(task.description);
		if (focusSecs > 0) {
			const focus = meta.createSpan({ cls: "tasks-focus-time" });
			setIcon(focus.createSpan({ cls: "tasks-focus-icon" }), "timer");
			focus.createSpan({ text: formatFocus(focusSecs) });
		}

		const actions = row.createDiv({ cls: "tasks-actions" });

		const addSubBtn = actions.createEl("button", { cls: "tasks-icon-button" });
		setIcon(addSubBtn, "plus");
		addSubBtn.setAttr("aria-label", "Add subtask");
		addSubBtn.addEventListener("click", () => this.openAddSubtask(task));

		const editBtn = actions.createEl("button", { cls: "tasks-icon-button" });
		setIcon(editBtn, "pencil");
		editBtn.setAttr("aria-label", "Open task");
		editBtn.addEventListener("click", () => this.openDetail(task));

		const delBtn = actions.createEl("button", { cls: "tasks-icon-button tasks-delete-button" });
		setIcon(delBtn, "trash-2");
		delBtn.setAttr("aria-label", "Delete task");
		delBtn.addEventListener("click", () => this.confirmDelete(task, delBtn));

		if (hasChildren && !collapsed) {
			const childWrap = item.createDiv({ cls: "tasks-children" });
			for (const child of orderSubtasks(task.children)) this.renderTask(childWrap, child, task.tags);
		}
	}

	/* --------------------------- task actions -------------------------- */

	private async markDone(task: Task): Promise<void> {
		// A recurring task with a due date spawns its next occurrence (above the
		// now-completed line) instead of just being ticked off — matching the
		// Obsidian Tasks plugin's per-line behaviour.
		const rule = task.recurrence ? parseRecurrence(task.recurrence) : null;
		if (rule && task.due) {
			await this.applyStructural(task.raw, (lines, t) => {
				lines[t.blockStart] = serializeTask({
					indent: t.indent,
					description: t.description,
					tags: t.tags,
					due: t.due,
					priority: t.priority,
					recurrence: t.recurrence,
					completed: true,
					doneDate: todayISO(),
				});
				// Guard the re-parsed due (a concurrent external edit could have
				// dropped it); without one there's no occurrence to advance to.
				if (!t.due) return lines;
				const nextLine = serializeTask({
					indent: t.indent,
					description: t.description,
					tags: t.tags,
					due: nextDueDate(rule, t.due),
					priority: t.priority,
					recurrence: t.recurrence,
					completed: false,
					doneDate: null,
				});
				return insertTaskLineBefore(lines, t, nextLine);
			});
			await this.refresh();
			return;
		}

		const updated = serializeTask({
			indent: task.indent,
			description: task.description,
			tags: task.tags,
			due: task.due,
			priority: task.priority,
			recurrence: task.recurrence,
			completed: true,
			doneDate: todayISO(),
		});
		await this.replaceLine(task.raw, updated);
		await this.refresh();
	}

	private async markUndone(task: Task): Promise<void> {
		const updated = serializeTask({
			indent: task.indent,
			description: task.description,
			tags: task.tags,
			due: task.due,
			priority: task.priority,
			recurrence: task.recurrence,
			completed: false,
			doneDate: null,
		});
		await this.replaceLine(task.raw, updated);
		await this.refresh();
	}

	private confirmDelete(task: Task, anchor: HTMLElement): void {
		const popup = anchor.createDiv({ cls: "tasks-confirm-popup" });
		const n = countDescendants(task);
		popup.createSpan({
			text: n > 0 ? `Delete task and ${n} subtask${n === 1 ? "" : "s"}?` : "Delete this task?",
		});
		const yes = popup.createEl("button", { text: "Delete", cls: "mod-warning" });
		const no = popup.createEl("button", { text: "Cancel" });

		const cleanup = () => popup.remove();
		yes.addEventListener("click", async (e) => {
			e.stopPropagation();
			cleanup();
			await this.removeTask(task);
		});
		no.addEventListener("click", (e) => {
			e.stopPropagation();
			cleanup();
		});
	}

	private openAddForm(prefillTag?: string): void {
		new TaskFormModal(
			this,
			"Add task",
			this.allTags,
			null,
			async (input, notes) => {
				await this.createTask(input, notes);
			},
			prefillTag,
			{
				label: "Add & open",
				tooltip: "Create the task and open it to add notes and subtasks",
				handler: async (input, notes) => {
					const task = await this.createTask(input, notes);
					if (task) this.openDetail(task);
				},
			}
		).open();
	}

	/**
	 * Append a new top-level task (plus its note lines, when given), refresh,
	 * and return the freshly parsed Task (located by its serialised line) so
	 * callers can open it for further editing.
	 */
	private async createTask(input: TaskInput, notes?: string): Promise<Task | null> {
		const block = serializeTaskBlock(
			{
				indent: "",
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				recurrence: input.recurrence,
				completed: false,
				doneDate: null,
			},
			notes
		);
		const line = block[0];
		await this.appendLine(block.join("\n"));
		for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
		await this.plugin.saveSettings();
		await this.refresh();
		return this.reloadTask(line);
	}

	/**
	 * Open the full add form for a subtask, pre-tagged with the parent's project.
	 * The secondary "Add & open" action creates it and opens its own detail modal
	 * (`onDone` still fires first, so the parent modal's subtask list — if this
	 * was opened from one — is already refreshed underneath).
	 */
	openAddSubtask(parent: Task, onDone?: () => void): void {
		const prefill = parent.tags[0];
		new TaskFormModal(
			this,
			"Add subtask",
			this.allTags,
			null,
			async (input, notes) => {
				await this.addSubtask(parent, input, notes);
				onDone?.();
			},
			prefill,
			{
				label: "Add & open",
				tooltip: "Create the subtask and open it to add notes and subtasks",
				handler: async (input, notes) => {
					const task = await this.addSubtask(parent, input, notes);
					onDone?.();
					if (task) this.openDetail(task);
				},
			}
		).open();
	}

	/** Open a task's detail modal; `onCloseCallback` fires once it's closed. */
	openDetail(task: Task, onCloseCallback?: () => void): void {
		new TaskDetailModal(this, task, onCloseCallback).open();
	}

	/** Exposed so the detail modal can populate its tag dropdown. */
	knownTagList(): string[] {
		return this.allTags;
	}

	/* ----------------------- structural writes ------------------------ */

	/**
	 * Re-read the file, locate `targetRaw` in a fresh parse, apply a pure line
	 * edit, and write back. The task passed to `edit` has block indices valid
	 * for the `lines` array given to `edit`.
	 */
	private async applyStructural(
		targetRaw: string,
		edit: (lines: string[], task: Task) => string[]
	): Promise<void> {
		const file = this.getTasksFile();
		if (!file) return;
		const content = await this.app.vault.read(file);
		const { flat, lines } = parseTasks(content);
		const task = findTaskByRaw(flat, targetRaw);
		if (!task) {
			new Notice("Couldn't locate the task — it may have changed externally.");
			return;
		}
		await this.app.vault.modify(file, edit(lines, task).join("\n"));
	}

	/* ----------------------- drag to make subtask ---------------------- */

	/** Make a task row draggable, and a drop target that re-parents the drag. */
	private attachDragHandlers(row: HTMLElement, task: Task): void {
		row.setAttr("draggable", "true");

		row.addEventListener("dragstart", (e) => {
			this.draggedTaskRaw = task.raw;
			row.addClass("is-dragging");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				// Some platforms require data to be set for the drag to begin.
				e.dataTransfer.setData("text/plain", task.description);
			}
		});

		row.addEventListener("dragend", () => {
			this.draggedTaskRaw = null;
			row.removeClass("is-dragging");
			this.clearDropTargets();
		});

		row.addEventListener("dragover", (e) => {
			// Only react while one of our own rows is in flight, and never onto the
			// row being dragged itself.
			if (this.draggedTaskRaw === null || this.draggedTaskRaw === task.raw) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.clearDropTargets();
			row.addClass("is-drop-target");
		});

		row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));

		row.addEventListener("drop", (e) => {
			e.preventDefault();
			row.removeClass("is-drop-target");
			const draggedRaw = this.draggedTaskRaw;
			this.draggedTaskRaw = null;
			if (draggedRaw && draggedRaw !== task.raw) void this.moveTaskUnder(draggedRaw, task.raw);
		});
	}

	private clearDropTargets(): void {
		this.containerEl.findAll(".tasks-row.is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
	}

	/**
	 * Re-parent the dragged task under `targetRaw`. Re-reads and locates both
	 * tasks in a fresh parse (read-before-write); a cyclic / no-op move is
	 * silently ignored by the parser.
	 */
	private async moveTaskUnder(draggedRaw: string, targetRaw: string): Promise<void> {
		const file = this.getTasksFile();
		if (!file) return;
		const content = await this.app.vault.read(file);
		const { flat, lines } = parseTasks(content);
		const dragged = findTaskByRaw(flat, draggedRaw);
		const target = findTaskByRaw(flat, targetRaw);
		if (!dragged || !target) {
			new Notice("Couldn't move the task — it may have changed externally.");
			return;
		}
		const next = moveTaskAsChild(lines, dragged, target);
		if (next === lines) return; // invalid move (onto itself or a descendant)
		await this.app.vault.modify(file, next.join("\n"));
		await this.refresh();
	}

	private async removeTask(task: Task): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => removeTaskBlock(lines, t));
		await this.refresh();
	}

	deleteTask(task: Task): Promise<void> {
		return this.removeTask(task);
	}

	async setNotes(task: Task, notes: string): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => setTaskNotes(lines, t, notes));
		await this.refresh();
	}

	/**
	 * Add a subtask (plus its note lines, when given) under `parent`, refresh,
	 * and return the freshly parsed Task so callers (e.g. "Add & open") can open
	 * it for further editing.
	 */
	async addSubtask(parent: Task, input: TaskInput, notes?: string): Promise<Task | null> {
		let createdLine: string | null = null;
		await this.applyStructural(parent.raw, (lines, t) => {
			const line = serializeTask({
				indent: childIndentOf(t),
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				recurrence: input.recurrence,
				completed: false,
				doneDate: null,
			});
			createdLine = line;
			return addChildTaskLine(lines, t, line, notes);
		});
		for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
		await this.plugin.saveSettings();
		await this.refresh();
		return createdLine ? this.reloadTask(createdLine) : null;
	}

	/** Save edited fields and notes together in a single read/write. */
	async saveTaskDetail(task: Task, input: TaskInput, notes: string): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => {
			lines[t.blockStart] = serializeTask({
				indent: t.indent,
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				recurrence: input.recurrence,
				completed: t.completed,
				doneDate: t.doneDate,
			});
			return setTaskNotes(lines, t, notes);
		});
		for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
		await this.plugin.saveSettings();
		await this.refresh();
	}

	/** Toggle a task's done state (used by the detail modal's subtask list). */
	toggleTask(task: Task): Promise<void> {
		return task.completed ? this.markUndone(task) : this.markDone(task);
	}

	/** Re-read and return the current version of a task by its line text. */
	async reloadTask(raw: string): Promise<Task | null> {
		const file = this.getTasksFile();
		if (!file) return null;
		const content = await this.app.vault.read(file);
		const { flat } = parseTasks(content);
		return findTaskByRaw(flat, raw);
	}
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Stable persistence key for a task's expand/collapse state. */
function hashKey(s: string): string {
	return hash32(s).toString(36);
}

/** Today's triage load: incomplete tasks already overdue or due today. */
interface Pressure {
	overdue: number;
	dueToday: number;
}

function countPressure(flat: Task[]): Pressure {
	let overdue = 0;
	let dueToday = 0;
	for (const t of flat) {
		if (t.completed || !t.due) continue;
		const d = daysUntil(t.due);
		if (d < 0) overdue++;
		else if (d === 0) dueToday++;
	}
	return { overdue, dueToday };
}

/**
 * Overdue, incomplete candidates — every dated task at any depth (matching
 * `countPressure`'s "every incomplete dated task" rule) when `scopeTag` is
 * null, or just the ones matching that tag (own + inherited, like section
 * membership) when scoped to one view. Shared by the header's reschedule
 * button and `rescheduleOverdue` so the count shown and the set acted on are
 * always the same tasks.
 */
function overdueCandidates(
	candidates: SectionCandidate[],
	scopeTag: string | null,
	todayIso: string
): SectionCandidate[] {
	return candidates
		.filter((c) => !c.task.completed && c.task.due && c.task.due < todayIso)
		.filter((c) => !scopeTag || tagListHasTag(c.tags, scopeTag));
}

/**
 * Build a "Repeat" control (a toggle plus revealed sub-fields) into `contentEl`,
 * shared by the add and edit modals. It emits canonical recurrence rule text
 * (via recurrence.ts) through `onChange`. `onChange` fires only on user
 * interaction — never during setup — so a rule the control can't fully model is
 * left untouched by the caller until the user actually edits the repeat fields.
 */
function buildRecurrenceSetting(
	contentEl: HTMLElement,
	initial: string | null,
	getCurrentDue: () => string | null,
	onChange: (rule: string | null) => void
): void {
	const parsed = initial ? parseRecurrence(initial) : null;

	const dueDay = (): number => {
		const iso = getCurrentDue();
		const d = iso ? parseInt(iso.split("-")[2], 10) : NaN;
		return Number.isFinite(d) ? d : new Date().getDate();
	};

	const state = {
		enabled: parsed !== null,
		interval: parsed?.interval ?? 1,
		unit: (parsed?.unit ?? "week") as RecurrenceRule["unit"],
		weekWeekday: parsed?.unit === "week" ? parsed.weekday ?? null : null,
		monthMode: (parsed?.unit === "month" && parsed.ordinal != null && parsed.weekday != null
			? "weekday"
			: "dom") as "dom" | "weekday",
		dayOfMonth: parsed?.dayOfMonth ?? null,
		ordinal: parsed?.ordinal ?? 2,
		monthWeekday: (parsed?.unit === "month" ? parsed.weekday : null) ?? 1,
	};

	const buildRule = (): RecurrenceRule => {
		const interval = Math.max(1, Math.floor(state.interval) || 1);
		switch (state.unit) {
			case "day":
				return { unit: "day", interval };
			case "week":
				return { unit: "week", interval, weekday: state.weekWeekday };
			case "year":
				return { unit: "year", interval };
			case "month":
				if (state.monthMode === "weekday") {
					return { unit: "month", interval, ordinal: state.ordinal, weekday: state.monthWeekday };
				}
				return { unit: "month", interval, dayOfMonth: state.dayOfMonth ?? dueDay() };
		}
	};

	const emit = (): void => onChange(state.enabled ? recurrenceToText(buildRule()) : null);

	new Setting(contentEl).setName("Repeat").addToggle((toggle) => {
		toggle.setValue(state.enabled).onChange((v) => {
			state.enabled = v;
			renderSub();
			emit();
		});
	});

	const sub = contentEl.createDiv({ cls: "tasks-recur-fields" });

	function renderSub(): void {
		sub.empty();
		if (!state.enabled) return;

		new Setting(sub)
			.setName("Every")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.addClass("tasks-recur-interval");
				text.setValue(String(state.interval));
				text.onChange((v) => {
					state.interval = Math.max(1, parseInt(v, 10) || 1);
					emit();
				});
			})
			.addDropdown((dd) => {
				dd.addOption("day", "day(s)");
				dd.addOption("week", "week(s)");
				dd.addOption("month", "month(s)");
				dd.addOption("year", "year(s)");
				dd.setValue(state.unit);
				dd.onChange((v) => {
					state.unit = v as RecurrenceRule["unit"];
					renderSub();
					emit();
				});
			});

		if (state.unit === "week") {
			new Setting(sub).setName("On day").addDropdown((dd) => {
				dd.addOption("any", "Any day");
				WEEKDAY_LABELS.forEach((label, i) => dd.addOption(String(i), label));
				dd.setValue(state.weekWeekday == null ? "any" : String(state.weekWeekday));
				dd.onChange((v) => {
					state.weekWeekday = v === "any" ? null : parseInt(v, 10);
					emit();
				});
			});
		}

		if (state.unit === "month") {
			new Setting(sub).setName("On").addDropdown((dd) => {
				dd.addOption("dom", "A day of the month");
				dd.addOption("weekday", "A weekday of the month");
				dd.setValue(state.monthMode);
				dd.onChange((v) => {
					state.monthMode = v as "dom" | "weekday";
					renderSub();
					emit();
				});
			});

			if (state.monthMode === "dom") {
				new Setting(sub).setName("Day of month").addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.min = "1";
					text.inputEl.max = "31";
					text.setValue(String(state.dayOfMonth ?? dueDay()));
					text.onChange((v) => {
						const n = parseInt(v, 10);
						state.dayOfMonth = Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : null;
						emit();
					});
				});
			} else {
				new Setting(sub)
					.setName("Weekday")
					.addDropdown((dd) => {
						dd.addOption("1", "1st");
						dd.addOption("2", "2nd");
						dd.addOption("3", "3rd");
						dd.addOption("4", "4th");
						dd.addOption("-1", "last");
						dd.setValue(String(state.ordinal));
						dd.onChange((v) => {
							state.ordinal = parseInt(v, 10);
							emit();
						});
					})
					.addDropdown((dd) => {
						WEEKDAY_LABELS.forEach((label, i) => dd.addOption(String(i), label));
						dd.setValue(String(state.monthWeekday));
						dd.onChange((v) => {
							state.monthWeekday = parseInt(v, 10);
							emit();
						});
					});
			}
		}
	}

	renderSub();
}

/* ------------------------------------------------------------------ */
/* Add / edit modal                                                    */
/* ------------------------------------------------------------------ */

/** An extra button on the add form (e.g. "Add & open") alongside the primary. */
interface FormSecondaryAction {
	label: string;
	tooltip?: string;
	handler: (input: TaskInput, notes: string) => Promise<void>;
}

class TaskFormModal extends Modal {
	private view: TasksView;
	private titleText: string;
	private knownTags: string[];
	private initial: TaskInput | null;
	private onSubmit: (input: TaskInput, notes: string) => Promise<void>;
	private secondary: FormSecondaryAction | null;

	private description = "";
	private tag = "";
	private due: string | null = null;
	private priority: Priority = "normal";
	private recurrence: string | null = null;
	private notes = "";

	constructor(
		view: TasksView,
		titleText: string,
		knownTags: string[],
		initial: TaskInput | null,
		onSubmit: (input: TaskInput, notes: string) => Promise<void>,
		prefillTag?: string,
		secondary?: FormSecondaryAction
	) {
		super(view.app);
		this.view = view;
		this.titleText = titleText;
		this.knownTags = knownTags;
		this.initial = initial;
		this.onSubmit = onSubmit;
		this.secondary = secondary ?? null;

		if (initial) {
			this.description = initial.description;
			this.tag = initial.tags[0] ?? "";
			this.due = initial.due;
			this.priority = initial.priority;
			this.recurrence = initial.recurrence ?? null;
		} else if (prefillTag) {
			// Adding from a section's "+": start with that category's tag.
			this.tag = prefillTag;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tasks-form-modal");
		contentEl.createEl("h3", { text: this.titleText });

		new Setting(contentEl).setName("Description").addText((text) => {
			text.setValue(this.description).onChange((v) => (this.description = v));
			text.inputEl.classList.add("tasks-form-description");
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		// Tag: a plain dropdown of existing tags (most-recently-used first), with a
		// "create new" option that reveals a text box. Easier to click than a
		// typeahead, and new tags are still one step away.
		const NEW_TAG = "__new_tag__";
		const NO_TAG = "__no_tag__";
		const tagOptions = [...this.knownTags];
		if (this.tag && !tagOptions.includes(this.tag)) tagOptions.unshift(this.tag);

		let newTagComponent: TextComponent | null = null;
		let setNewTagVisible: (show: boolean) => void = () => {};

		new Setting(contentEl).setName("Tag").addDropdown((dd) => {
			dd.addOption(NO_TAG, "No tag");
			for (const t of tagOptions) dd.addOption(t, t);
			dd.addOption(NEW_TAG, "+ Create new tag");
			dd.setValue(this.tag ? this.tag : NO_TAG);
			dd.onChange((v) => {
				if (v === NEW_TAG) {
					this.tag = "";
					setNewTagVisible(true);
				} else {
					this.tag = v === NO_TAG ? "" : v;
					setNewTagVisible(false);
				}
			});
		});

		const newTagSetting = new Setting(contentEl).setName("New tag").addText((text) => {
			text.setPlaceholder("#tag").onChange((v) => (this.tag = v.trim()));
			newTagComponent = text;
		});
		newTagSetting.settingEl.style.display = "none";
		setNewTagVisible = (show: boolean) => {
			newTagSetting.settingEl.style.display = show ? "" : "none";
			if (show) window.setTimeout(() => newTagComponent?.inputEl.focus(), 0);
		};

		new Setting(contentEl).setName("Due date").addText((text) => {
			const input = text.inputEl;
			input.type = "date";
			input.addClass("tasks-form-date");
			if (this.due) text.setValue(this.due);
			text.onChange((v) => (this.due = v || null));
			attachDatePicker(input, { allowClear: true });
		});

		new Setting(contentEl).setName("Priority").addDropdown((dd) => {
			dd.addOption("none", "None");
			dd.addOption("highest", "🔺 Highest");
			dd.addOption("high", "⏫ High");
			dd.addOption("medium", "🔼 Medium");
			dd.addOption("low", "🔽 Low");
			dd.addOption("lowest", "⏬ Lowest");
			dd.setValue(this.priority === "normal" ? "none" : this.priority);
			dd.onChange((v) => (this.priority = v === "none" ? "normal" : (v as Priority)));
		});

		buildRecurrenceSetting(
			contentEl,
			this.recurrence,
			() => this.due,
			(rule) => (this.recurrence = rule)
		);

		contentEl.createEl("div", { cls: "tasks-detail-label", text: "Notes" });
		const notesArea = contentEl.createEl("textarea", { cls: "tasks-notes-input" });
		notesArea.value = this.notes;
		notesArea.rows = 4;
		notesArea.placeholder = "Add notes…";
		notesArea.addEventListener("input", () => (this.notes = notesArea.value));

		const buttons = new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.initial ? "Save" : "Add task")
				.setCta()
				.onClick(() => this.submit())
		);
		if (this.secondary && !this.initial) {
			const secondary = this.secondary;
			buttons.addButton((btn) => {
				btn.setButtonText(secondary.label).onClick(() => this.submitSecondary());
				if (secondary.tooltip) btn.setTooltip(secondary.tooltip);
			});
		}
	}

	/** Validate and gather the form into a TaskInput, or null (with a notice) if invalid. */
	private collectInput(): TaskInput | null {
		const description = this.description.trim();
		if (!description) {
			new Notice("Description is required.");
			return null;
		}
		let tag = this.tag.trim();
		if (tag && !tag.startsWith("#")) tag = "#" + tag;

		return {
			description,
			tags: tag ? [tag] : [],
			due: this.due,
			priority: this.priority,
			recurrence: this.recurrence,
		};
	}

	private async submit(): Promise<void> {
		const input = this.collectInput();
		if (!input) return;
		this.close();
		await this.onSubmit(input, this.notes);
	}

	private async submitSecondary(): Promise<void> {
		if (!this.secondary) return;
		const input = this.collectInput();
		if (!input) return;
		this.close();
		await this.secondary.handler(input, this.notes);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ------------------------------------------------------------------ */
/* Task detail modal — open a task to edit fields, notes, subtasks      */
/* ------------------------------------------------------------------ */

class TaskDetailModal extends Modal {
	private view: TasksView;
	private task: Task;
	private onCloseCallback?: () => void;

	private description: string;
	private tag: string;
	private due: string | null;
	private priority: Priority;
	private recurrence: string | null;
	private notes: string;

	constructor(view: TasksView, task: Task, onCloseCallback?: () => void) {
		super(view.app);
		this.view = view;
		this.task = task;
		this.onCloseCallback = onCloseCallback;
		this.description = task.description;
		this.tag = task.tags[0] ?? "";
		this.due = task.due;
		this.priority = task.priority;
		this.recurrence = task.recurrence;
		this.notes = task.notes;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tasks-form-modal", "tasks-detail-modal");
		contentEl.createEl("h3", { text: "Task" });

		new Setting(contentEl).setName("Description").addText((t) => {
			t.setValue(this.description).onChange((v) => (this.description = v));
			t.inputEl.classList.add("tasks-form-description");
		});

		const NEW_TAG = "__new_tag__";
		const NO_TAG = "__no_tag__";
		const tagOptions = [...this.view.knownTagList()];
		if (this.tag && !tagOptions.includes(this.tag)) tagOptions.unshift(this.tag);
		let newTagComponent: TextComponent | null = null;
		let setNewTagVisible: (show: boolean) => void = () => {};

		new Setting(contentEl).setName("Tag").addDropdown((dd) => {
			dd.addOption(NO_TAG, "No tag");
			for (const t of tagOptions) dd.addOption(t, t);
			dd.addOption(NEW_TAG, "+ Create new tag");
			dd.setValue(this.tag ? this.tag : NO_TAG);
			dd.onChange((v) => {
				if (v === NEW_TAG) {
					this.tag = "";
					setNewTagVisible(true);
				} else {
					this.tag = v === NO_TAG ? "" : v;
					setNewTagVisible(false);
				}
			});
		});

		const newTagSetting = new Setting(contentEl).setName("New tag").addText((t) => {
			t.setPlaceholder("#tag").onChange((v) => (this.tag = v.trim()));
			newTagComponent = t;
		});
		newTagSetting.settingEl.style.display = "none";
		setNewTagVisible = (show: boolean) => {
			newTagSetting.settingEl.style.display = show ? "" : "none";
			if (show) window.setTimeout(() => newTagComponent?.inputEl.focus(), 0);
		};

		new Setting(contentEl).setName("Due date").addText((t) => {
			const input = t.inputEl;
			input.type = "date";
			input.addClass("tasks-form-date");
			if (this.due) t.setValue(this.due);
			t.onChange((v) => (this.due = v || null));
			attachDatePicker(input, { allowClear: true });
		});

		new Setting(contentEl).setName("Priority").addDropdown((dd) => {
			dd.addOption("none", "None");
			dd.addOption("highest", "🔺 Highest");
			dd.addOption("high", "⏫ High");
			dd.addOption("medium", "🔼 Medium");
			dd.addOption("low", "🔽 Low");
			dd.addOption("lowest", "⏬ Lowest");
			dd.setValue(this.priority === "normal" ? "none" : this.priority);
			dd.onChange((v) => (this.priority = v === "none" ? "normal" : (v as Priority)));
		});

		buildRecurrenceSetting(
			contentEl,
			this.recurrence,
			() => this.due,
			(rule) => (this.recurrence = rule)
		);

		// Notes
		contentEl.createEl("div", { cls: "tasks-detail-label", text: "Notes" });
		const notesArea = contentEl.createEl("textarea", { cls: "tasks-notes-input" });
		notesArea.value = this.notes;
		notesArea.rows = 4;
		notesArea.placeholder = "Add notes…";
		notesArea.addEventListener("input", () => (this.notes = notesArea.value));

		// Subtasks
		contentEl.createEl("div", { cls: "tasks-detail-label", text: "Subtasks" });
		const subWrap = contentEl.createDiv({ cls: "tasks-detail-subtasks" });
		this.renderSubtasks(subWrap);

		const addRow = contentEl.createDiv({ cls: "tasks-detail-addsub" });
		addRow
			.createEl("button", { text: "+ Add subtask" })
			.addEventListener("click", () => this.view.openAddSubtask(this.task, () => this.reload()));

		const footer = contentEl.createDiv({ cls: "tasks-detail-footer" });
		footer.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => this.save());
		footer.createEl("button", { text: "Delete", cls: "mod-warning" }).addEventListener("click", () => {
			this.close();
			this.view.deleteTask(this.task);
		});
	}

	private renderSubtasks(wrap: HTMLElement): void {
		wrap.empty();
		if (this.task.children.length === 0) {
			wrap.createDiv({ cls: "tasks-empty", text: "No subtasks yet" });
			return;
		}
		for (const child of orderSubtasks(this.task.children)) {
			const row = wrap.createDiv({ cls: "tasks-detail-subrow" });
			const cb = row.createEl("input", { type: "checkbox", cls: "tasks-checkbox" });
			cb.checked = child.completed;
			cb.addEventListener("change", async () => {
				await this.view.toggleTask(child);
				await this.reload();
			});
			const span = row.createSpan({ cls: "tasks-detail-subtitle is-clickable", text: child.description });
			if (child.completed) span.addClass("is-completed");
			// Opens the subtask's own detail modal (on top of this one), same as
			// clicking a task's description does in the main list — a subtask is
			// still a task, so it gets the same notes/subtasks/edit surface. When
			// it closes, this list re-reads so any change (due, priority, notes,
			// its own subtasks) shows immediately underneath.
			span.setAttr("aria-label", "Open subtask");
			span.addEventListener("click", (e) => {
				e.stopPropagation();
				this.view.openDetail(child, () => this.reload());
			});
			// Same due badge / priority chip a top-level row shows, so a subtask's
			// own schedule is visible without opening it — and matches the order
			// `orderSubtasks` now lists them in (due date, then priority).
			renderDueSlot(row, child);
			renderPriorityChip(row, child.priority);
		}
	}

	/** Re-read the task (after a subtask change) and re-render the subtask list. */
	private async reload(): Promise<void> {
		const fresh = await this.view.reloadTask(this.task.raw);
		if (!fresh) return;
		this.task = fresh;
		const wrap = this.contentEl.querySelector(".tasks-detail-subtasks");
		if (wrap instanceof HTMLElement) this.renderSubtasks(wrap);
	}

	private async save(): Promise<void> {
		const description = this.description.trim();
		if (!description) {
			new Notice("Description is required.");
			return;
		}
		let tag = this.tag.trim();
		if (tag && !tag.startsWith("#")) tag = "#" + tag;
		this.close();
		await this.view.saveTaskDetail(
			this.task,
			{
				description,
				tags: tag ? [tag] : [],
				due: this.due,
				priority: this.priority,
				recurrence: this.recurrence,
			},
			this.notes
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onCloseCallback?.();
	}
}
