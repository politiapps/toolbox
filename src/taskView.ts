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
	parseTasks,
	serializeTask,
	collectTags,
	childIndentOf,
	findTaskByRaw,
	setTaskNotes,
	addChildTaskLine,
	removeTaskBlock,
	moveTaskAsChild,
} from "./taskParser";
import { renderTodayCalendar } from "./calendarView";
import {
	SectionConfig,
	SortOrder,
	COMPLETED_KEY,
	touchRecentTag,
} from "./settings";

export const VIEW_TYPE_TASKS = "tasks-panel-view";

const PRIORITY_RANK: Record<Priority, number> = {
	highest: 0,
	high: 1,
	medium: 2,
	normal: 3,
	low: 4,
	lowest: 5,
};

const PRIORITY_LABEL: Record<Priority, string> = {
	highest: "Highest",
	high: "High",
	medium: "Medium",
	normal: "Normal",
	low: "Low",
	lowest: "Lowest",
};

/* ------------------------------------------------------------------ */
/* Date helpers (UI presentation only — no task syntax is parsed here) */
/* ------------------------------------------------------------------ */

function todayISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date (avoids UTC off-by-one). */
function parseLocalDate(iso: string): Date {
	const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
	return new Date(y, m - 1, d);
}

function ordinalSuffix(n: number): string {
	const v = n % 100;
	if (v >= 11 && v <= 13) return "th";
	switch (n % 10) {
		case 1:
			return "st";
		case 2:
			return "nd";
		case 3:
			return "rd";
		default:
			return "th";
	}
}

/** Format a due date as "Thursday 25th" — weekday + day + ordinal, no year. */
function formatDueDisplay(iso: string): string {
	const d = parseLocalDate(iso);
	const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
	return `${weekday} ${d.getDate()}${ordinalSuffix(d.getDate())}`;
}

/** Whole days from today to the given date (negative = past). */
function daysUntil(iso: string): number {
	const today = parseLocalDate(todayISO()).getTime();
	const due = parseLocalDate(iso).getTime();
	return Math.round((due - today) / 86_400_000);
}

/** Human label for a due date: "Today"/"Tomorrow" for the near term, else date. */
function dueLabel(iso: string): string {
	const d = daysUntil(iso);
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	return formatDueDisplay(iso);
}

/** Proximity class driving the due-date colour ramp (sooner = warmer). */
function dueClass(iso: string): string {
	const d = daysUntil(iso);
	if (d < 0) return "is-overdue";
	if (d === 0) return "is-today";
	if (d === 1) return "is-tomorrow";
	if (d === 2) return "is-soon";
	return "is-upcoming";
}

/* ------------------------------------------------------------------ */
/* The sidebar view                                                    */
/* ------------------------------------------------------------------ */

export class TasksView extends ItemView {
	plugin: TasksPlugin;
	private allTags: string[] = [];
	/** Raw line text of the task currently being dragged (drag-to-subtask). */
	private draggedTaskRaw: string | null = null;

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
		// No per-view listeners to clean up; the vault 'modify' listener lives in
		// main.ts and is owned by the plugin lifecycle.
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

		const root = this.contentEl;
		root.empty();
		root.addClass("tasks-panel-content");

		this.renderPanelHeader(root);
		this.renderCalendar(root);

		// No file at the configured path — say so plainly instead of showing an
		// empty panel that looks like "you have no tasks".
		if (!file) {
			this.renderMissingFileNotice(root);
			return;
		}

		const incomplete = tasks.filter((t) => !t.completed);

		// A top-level task renders in the first section it matches only — never
		// twice. Subtasks are never section rows; they render under their parent.
		const shown = new Set<Task>();
		for (const section of this.plugin.settings.sections) {
			const matching = incomplete.filter((t) => !shown.has(t) && taskHasTag(t, section.tag));
			matching.forEach((t) => shown.add(t));
			this.renderSection(root, section, matching);
		}

		const completed = tasks.filter((t) => t.completed);
		this.renderCompletedSection(root, completed);
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

	private renderPanelHeader(root: HTMLElement): void {
		// The panel is framed around "today" — the lens for due-date triage.
		const header = root.createDiv({ cls: "tasks-header" });

		const date = header.createDiv({ cls: "tasks-today" });
		date.createDiv({ cls: "tasks-today-eyebrow", text: "Today" });
		date.createDiv({ cls: "tasks-today-date", text: formatDueDisplay(todayISO()) });

		const add = header.createEl("button", { cls: "tasks-add" });
		setIcon(add, "plus");
		add.setAttr("aria-label", "Add task");
		add.addEventListener("click", () => this.openAddForm());
	}

	/** "Today" calendar block above the tasks (only when an .ics URL is set). */
	private renderCalendar(root: HTMLElement): void {
		if (!this.plugin.settings.icsUrl) return;
		renderTodayCalendar(root, this.plugin.calendarEvents, this.plugin.calendarError);
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

	private renderSection(root: HTMLElement, section: SectionConfig, tasks: Task[]): void {
		const collapsed = this.isCollapsed(section.id, section.collapsedByDefault);
		const sorted = sortTasks(tasks, section.sort);

		const sectionEl = root.createDiv({ cls: "tasks-section" });
		// Each lane carries a stable accent hue derived from its id — the one
		// place colour is spent. Rows indent off this left spine.
		sectionEl.style.setProperty("--section-accent", sectionAccent(section.id));

		const header = this.renderHeader(sectionEl, section.name, tasks.length, collapsed, true, async (next) => {
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
			} else {
				for (const task of sorted) this.renderTask(body, task);
			}
		}
	}

	private renderCompletedSection(root: HTMLElement, tasks: Task[]): void {
		const collapsed = this.isCollapsed(COMPLETED_KEY, true);
		// Most recently completed first.
		const sorted = [...tasks].sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));

		const sectionEl = root.createDiv({ cls: "tasks-section tasks-section-completed" });
		this.renderHeader(sectionEl, "Completed", tasks.length, collapsed, false, async (next) => {
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
		showDot: boolean,
		onToggle: (collapsed: boolean) => void
	): HTMLElement {
		const header = parent.createDiv({ cls: "tasks-section-header" });
		if (collapsed) header.addClass("is-collapsed");

		const chevron = header.createSpan({ cls: "tasks-chevron" });
		setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

		if (showDot) header.createSpan({ cls: "tasks-section-dot" });
		header.createSpan({ cls: "tasks-section-title", text: title });
		header.createSpan({ cls: "tasks-count-badge", text: String(count) });

		header.addEventListener("click", () => onToggle(!collapsed));
		return header;
	}

	private renderTask(parent: HTMLElement, task: Task, parentTags: string[] = []): void {
		const item = parent.createDiv({ cls: "tasks-item" });
		const row = item.createDiv({ cls: "tasks-row" });
		if (task.completed) row.addClass("is-completed");

		this.attachDragHandlers(row, task);

		const hasChildren = task.children.length > 0;
		const collapseKey = "task:" + hashKey(task.raw);
		const collapsed = hasChildren && this.isCollapsed(collapseKey, false);

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
		const desc = descLine.createSpan({ cls: "tasks-desc is-clickable", text: task.description });
		desc.setAttr("aria-label", "Open task");
		desc.addEventListener("click", () => this.openDetail(task));
		if (task.notes) {
			const note = descLine.createSpan({ cls: "tasks-note-indicator" });
			setIcon(note, "align-left");
			note.setAttr("aria-label", "Has notes");
		}

		const meta = main.createDiv({ cls: "tasks-meta" });

		// Skip a tag pill the parent already shows — it's inherited, not new info.
		for (const tag of task.tags) {
			if (parentTags.includes(tag)) continue;
			meta.createSpan({ cls: "tasks-tag-pill", text: tag });
		}

		if (task.completed && task.doneDate) {
			meta.createSpan({ cls: "tasks-done-date", text: `Done ${formatDueDisplay(task.doneDate)}` });
		} else if (task.due) {
			const dueEl = meta.createSpan({ cls: "tasks-due", text: dueLabel(task.due) });
			dueEl.addClass(dueClass(task.due));
		}

		if (hasChildren) {
			const done = task.children.filter((c) => c.completed).length;
			meta.createSpan({ cls: "tasks-progress", text: `${done}/${task.children.length}` });
		}

		if (task.priority !== "normal") {
			const chip = meta.createSpan({
				cls: `tasks-priority tasks-priority-${task.priority}`,
				attr: { "aria-label": `${PRIORITY_LABEL[task.priority]} priority` },
			});
			chip.createSpan({ cls: "tasks-priority-dot" });
			chip.createSpan({ cls: "tasks-priority-label", text: PRIORITY_LABEL[task.priority] });
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
			for (const child of task.children) this.renderTask(childWrap, child, task.tags);
		}
	}

	/* --------------------------- task actions -------------------------- */

	private async markDone(task: Task): Promise<void> {
		const updated = serializeTask({
			indent: task.indent,
			description: task.description,
			tags: task.tags,
			due: task.due,
			priority: task.priority,
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
		new TaskFormModal(this, "Add task", this.allTags, null, async (input) => {
			const line = serializeTask({
				indent: "",
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				completed: false,
				doneDate: null,
			});
			await this.appendLine(line);
			for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
			await this.plugin.saveSettings();
			await this.refresh();
		}, prefillTag).open();
	}

	/** Open the full add form for a subtask, pre-tagged with the parent's project. */
	openAddSubtask(parent: Task, onDone?: () => void): void {
		const prefill = parent.tags[0];
		new TaskFormModal(
			this,
			"Add subtask",
			this.allTags,
			null,
			async (input) => {
				await this.addSubtask(parent, input);
				onDone?.();
			},
			prefill
		).open();
	}

	private openDetail(task: Task): void {
		new TaskDetailModal(this, task).open();
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

	async addSubtask(parent: Task, input: TaskInput): Promise<void> {
		await this.applyStructural(parent.raw, (lines, t) => {
			const line = serializeTask({
				indent: childIndentOf(t),
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				completed: false,
				doneDate: null,
			});
			return addChildTaskLine(lines, t, line);
		});
		for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
		await this.plugin.saveSettings();
		await this.refresh();
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

// A small, theme-agnostic accent set. Each section gets a stable hue from its
// id (so colour follows the lane, not its position) — used only for thin spines
// and dots, never fills, so it sits quietly over any Obsidian theme.
const SECTION_ACCENTS = [
	"#6366f1", // indigo
	"#0ea5e9", // sky
	"#14b8a6", // teal
	"#f59e0b", // amber
	"#ec4899", // pink
	"#8b5cf6", // violet
];

function sectionAccent(id: string): string {
	return SECTION_ACCENTS[hash32(id) % SECTION_ACCENTS.length];
}

function hash32(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/** Stable persistence key for a task's expand/collapse state. */
function hashKey(s: string): string {
	return hash32(s).toString(36);
}

/** Total number of descendant tasks (subtasks at any depth). */
function countDescendants(task: Task): number {
	let n = task.children.length;
	for (const c of task.children) n += countDescendants(c);
	return n;
}

function taskHasTag(task: Task, tag: string): boolean {
	if (!tag) return false;
	const normalised = tag.startsWith("#") ? tag : "#" + tag;
	return task.tags.includes(normalised);
}

function sortTasks(tasks: Task[], order: SortOrder): Task[] {
	const copy = [...tasks];
	const byDue = (a: Task, b: Task): number => {
		if (a.due && b.due) return a.due.localeCompare(b.due);
		if (a.due) return -1; // dated tasks before undated
		if (b.due) return 1;
		return 0;
	};
	const byPriority = (a: Task, b: Task): number =>
		PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

	switch (order) {
		case "due":
			return copy.sort(byDue);
		case "priority":
			return copy.sort(byPriority);
		case "priority-due":
			return copy.sort((a, b) => byPriority(a, b) || byDue(a, b));
		case "file":
		default:
			return copy.sort((a, b) => a.lineIndex - b.lineIndex);
	}
}

/* ------------------------------------------------------------------ */
/* Add / edit modal                                                    */
/* ------------------------------------------------------------------ */

class TaskFormModal extends Modal {
	private view: TasksView;
	private titleText: string;
	private knownTags: string[];
	private initial: TaskInput | null;
	private onSubmit: (input: TaskInput) => Promise<void>;

	private description = "";
	private tag = "";
	private due: string | null = null;
	private priority: Priority = "normal";

	constructor(
		view: TasksView,
		titleText: string,
		knownTags: string[],
		initial: TaskInput | null,
		onSubmit: (input: TaskInput) => Promise<void>,
		prefillTag?: string
	) {
		super(view.app);
		this.view = view;
		this.titleText = titleText;
		this.knownTags = knownTags;
		this.initial = initial;
		this.onSubmit = onSubmit;

		if (initial) {
			this.description = initial.description;
			this.tag = initial.tags[0] ?? "";
			this.due = initial.due;
			this.priority = initial.priority;
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
			// Open the native calendar from anywhere in the field, not just the
			// tiny built-in icon.
			const openPicker = () => {
				const picker = input as unknown as { showPicker?: () => void };
				try {
					picker.showPicker?.();
				} catch (_) {
					/* showPicker unsupported or not user-activated — ignore */
				}
			};
			input.addEventListener("click", openPicker);
			input.addEventListener("focus", openPicker);
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

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(this.initial ? "Save" : "Add task")
				.setCta()
				.onClick(() => this.submit())
		);
	}

	private async submit(): Promise<void> {
		const description = this.description.trim();
		if (!description) {
			new Notice("Description is required.");
			return;
		}
		let tag = this.tag.trim();
		if (tag && !tag.startsWith("#")) tag = "#" + tag;

		const input: TaskInput = {
			description,
			tags: tag ? [tag] : [],
			due: this.due,
			priority: this.priority,
		};
		this.close();
		await this.onSubmit(input);
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

	private description: string;
	private tag: string;
	private due: string | null;
	private priority: Priority;
	private notes: string;

	constructor(view: TasksView, task: Task) {
		super(view.app);
		this.view = view;
		this.task = task;
		this.description = task.description;
		this.tag = task.tags[0] ?? "";
		this.due = task.due;
		this.priority = task.priority;
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
			const open = () => {
				const p = input as unknown as { showPicker?: () => void };
				try {
					p.showPicker?.();
				} catch (_) {
					/* ignore */
				}
			};
			input.addEventListener("click", open);
			input.addEventListener("focus", open);
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
		for (const child of this.task.children) {
			const row = wrap.createDiv({ cls: "tasks-detail-subrow" });
			const cb = row.createEl("input", { type: "checkbox", cls: "tasks-checkbox" });
			cb.checked = child.completed;
			cb.addEventListener("change", async () => {
				await this.view.toggleTask(child);
				await this.reload();
			});
			const span = row.createSpan({ cls: "tasks-detail-subtitle", text: child.description });
			if (child.completed) span.addClass("is-completed");
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
			{ description, tags: tag ? [tag] : [], due: this.due, priority: this.priority },
			this.notes
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
