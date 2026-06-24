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

		this.renderPanelHeader(root);

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

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "tasks-section-body" });
			if (sorted.length === 0) {
				body.createDiv({ cls: "tasks-empty", text: "Nothing due here" });
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
		this.renderHeader(sectionEl, "Completed", tasks.length, collapsed, false, async (next) => {
			await this.setCollapsed(COMPLETED_KEY, next);
			this.refresh();
		});

		if (!collapsed) {
			const body = sectionEl.createDiv({ cls: "tasks-section-body" });
			if (sorted.length === 0) {
				body.createDiv({ cls: "tasks-empty", text: "Completed tasks land here" });
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
				text: `Done ${formatDueDisplay(task.doneDate)}`,
			});
		} else if (task.due) {
			const dueEl = meta.createSpan({ cls: "tasks-due", text: formatDueDisplay(task.due) });
			if (isOverdue(task.due)) dueEl.addClass("is-overdue");
			else if (task.due === todayISO()) dueEl.addClass("is-today");
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
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
	return SECTION_ACCENTS[Math.abs(hash) % SECTION_ACCENTS.length];
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
