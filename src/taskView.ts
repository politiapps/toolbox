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
} from "./taskParser";
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
	normal: 2,
	low: 3,
};

const PRIORITY_LABEL: Record<Priority, string> = {
	highest: "Highest",
	high: "High",
	normal: "Normal",
	low: "Low",
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

function isOverdue(iso: string): boolean {
	return iso < todayISO();
}

/* ------------------------------------------------------------------ */
/* The sidebar view                                                    */
/* ------------------------------------------------------------------ */

export class TasksView extends ItemView {
	plugin: TasksPlugin;
	private allTags: string[] = [];

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

	private async readContent(): Promise<string> {
		const file = this.getTasksFile();
		if (!file) return "";
		return this.app.vault.read(file);
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
		const content = await this.readContent();
		const { tasks } = parseTasks(content);
		this.allTags = this.mergedTagList(tasks);

		const root = this.contentEl;
		root.empty();
		root.addClass("tasks-panel-content");

		this.renderAddButton(root);

		const incomplete = tasks.filter((t) => !t.completed);

		for (const section of this.plugin.settings.sections) {
			const matching = incomplete.filter((t) => taskHasTag(t, section.tag));
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

	private renderAddButton(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "tasks-toolbar" });
		const btn = bar.createEl("button", { cls: "tasks-add-button mod-cta" });
		setIcon(btn.createSpan({ cls: "tasks-add-icon" }), "plus");
		btn.createSpan({ text: "Add Task" });
		btn.addEventListener("click", () => this.openAddForm());
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
		const header = this.renderHeader(
			sectionEl,
			section.name,
			tasks.length,
			collapsed,
			async (next) => {
				await this.setCollapsed(section.id, next);
				this.refresh();
			}
		);
		header.dataset.sectionId = section.id;

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "tasks-section-body" });
			if (sorted.length === 0) {
				body.createDiv({ cls: "tasks-empty", text: "No tasks" });
			} else {
				for (const task of sorted) this.renderTaskRow(body, task);
			}
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
				body.createDiv({ cls: "tasks-empty", text: "Nothing completed yet" });
			} else {
				for (const task of sorted) this.renderTaskRow(body, task);
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

	private renderTaskRow(parent: HTMLElement, task: Task): void {
		const row = parent.createDiv({ cls: "tasks-row" });
		if (task.completed) row.addClass("is-completed");

		const checkbox = row.createEl("input", {
			type: "checkbox",
			cls: "tasks-checkbox",
		});
		checkbox.checked = task.completed;
		checkbox.addEventListener("change", () => {
			if (checkbox.checked && !task.completed) this.markDone(task);
			else if (!checkbox.checked && task.completed) this.markUndone(task);
		});

		const main = row.createDiv({ cls: "tasks-row-main" });

		const descLine = main.createDiv({ cls: "tasks-desc-line" });
		descLine.createSpan({ cls: "tasks-desc", text: task.description });

		const meta = main.createDiv({ cls: "tasks-meta" });

		for (const tag of task.tags) {
			meta.createSpan({ cls: "tasks-tag-pill", text: tag });
		}

		if (task.completed && task.doneDate) {
			meta.createSpan({
				cls: "tasks-done-date",
				text: `✅ ${formatDueDisplay(task.doneDate)}`,
			});
		} else if (task.due) {
			const dueEl = meta.createSpan({ cls: "tasks-due", text: formatDueDisplay(task.due) });
			if (isOverdue(task.due)) dueEl.addClass("is-overdue");
		}

		if (task.priority !== "normal") {
			meta.createSpan({
				cls: `tasks-priority tasks-priority-${task.priority}`,
				text: priorityIndicator(task.priority),
				attr: { "aria-label": `${PRIORITY_LABEL[task.priority]} priority` },
			});
		}

		const actions = row.createDiv({ cls: "tasks-actions" });

		const editBtn = actions.createEl("button", { cls: "tasks-icon-button" });
		setIcon(editBtn, "pencil");
		editBtn.setAttr("aria-label", "Edit task");
		editBtn.addEventListener("click", () => this.openEditForm(task));

		const delBtn = actions.createEl("button", { cls: "tasks-icon-button tasks-delete-button" });
		setIcon(delBtn, "trash-2");
		delBtn.setAttr("aria-label", "Delete task");
		delBtn.addEventListener("click", () => this.confirmDelete(task, delBtn));
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
		popup.createSpan({ text: "Delete this task?" });
		const yes = popup.createEl("button", { text: "Delete", cls: "mod-warning" });
		const no = popup.createEl("button", { text: "Cancel" });

		const cleanup = () => popup.remove();
		yes.addEventListener("click", async (e) => {
			e.stopPropagation();
			cleanup();
			await this.replaceLine(task.raw, null);
			await this.refresh();
		});
		no.addEventListener("click", (e) => {
			e.stopPropagation();
			cleanup();
		});
	}

	private openAddForm(): void {
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
		}).open();
	}

	private openEditForm(task: Task): void {
		const initial: TaskInput = {
			description: task.description,
			tags: task.tags,
			due: task.due,
			priority: task.priority,
		};
		new TaskFormModal(this, "Edit task", this.allTags, initial, async (input) => {
			const line = serializeTask({
				indent: task.indent,
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				completed: task.completed,
				doneDate: task.doneDate,
			});
			await this.replaceLine(task.raw, line);
			for (const tag of input.tags) touchRecentTag(this.plugin.settings, tag);
			await this.plugin.saveSettings();
			await this.refresh();
		}).open();
	}
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function priorityIndicator(p: Priority): string {
	switch (p) {
		case "highest":
			return "⏫";
		case "high":
			return "🔼";
		case "low":
			return "🔽";
		default:
			return "";
	}
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
		onSubmit: (input: TaskInput) => Promise<void>
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

		// Tag input with a datalist so existing tags autocomplete but new tags
		// can be typed freely. Ordered by most recently used.
		new Setting(contentEl)
			.setName("Tag")
			.setDesc("Pick an existing tag or type a new one.")
			.addText((text) => {
				text.setValue(this.tag).onChange((v) => (this.tag = v.trim()));
				const listId = "tasks-tag-list";
				const datalist = contentEl.createEl("datalist");
				datalist.id = listId;
				for (const t of this.knownTags) {
					datalist.createEl("option", { value: t });
				}
				text.inputEl.setAttr("list", listId);
				text.inputEl.setAttr("placeholder", "#tag");
			});

		new Setting(contentEl).setName("Due date").addText((text) => {
			text.inputEl.type = "date";
			if (this.due) text.setValue(this.due);
			text.onChange((v) => (this.due = v || null));
		});

		new Setting(contentEl).setName("Priority").addDropdown((dd) => {
			dd.addOption("none", "None");
			dd.addOption("low", "Low");
			dd.addOption("high", "High");
			dd.addOption("highest", "Highest");
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
