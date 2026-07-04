import { Task, sortTasks, taskHasTag, collectTags } from "@toolbox/task-core";
import { el } from "./dom";
import { setIcon, iconButton } from "./icons";
import { todayISO, formatDueDisplay, daysUntil, dueLabel, dueClass } from "../dates";
import {
	writeWidgetCache,
	consumePendingWidgetAction,
	type WidgetCategory,
	type WidgetTask,
} from "../widgetCache";
import { renderTask } from "./taskRow";
import { renderPomodoro } from "./pomodoro";
import { renderSettings } from "./settingsScreen";
import { openAddTask } from "./addModal";
import { COMPLETED_KEY, saveSettings, newId } from "../appState";
import type { AppSettings, SectionConfig } from "../appState";
import type { SortOrder } from "@toolbox/task-core";
import type { TaskService } from "../taskService";
import type { StorageAdapter } from "../storage";
import { DATA_JSON_PATH } from "../storage";
import type { AppContext } from "./context";

type Screen = "list" | "settings";

export class App {
	private ctx: AppContext;
	private screen: Screen = "list";

	constructor(
		private root: HTMLElement,
		private settings: AppSettings,
		private service: TaskService,
		private storage: StorageAdapter
	) {
		this.ctx = {
			service,
			settings,
			persist: () => saveSettings(settings),
			refresh: () => this.render(),
			knownTags: [],
			openSettings: () => {
				this.screen = "settings";
				void this.render();
			},
			pickVault: () => this.pickVault(),
		};
	}

	async start(): Promise<void> {
		// Re-mirror categories + tasks path from the vault's data.json each launch,
		// so the app stays matched to the Obsidian plugin with no manual step.
		await this.syncObsidianConfig();
		await this.render();
		await this.handlePendingAction();

		// The widget's + button brings this (singleTask) activity to the front
		// rather than cold-starting it, so also check on every foreground.
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") void this.onForeground();
		});
	}

	/** Re-read the file and honour any queued widget action when returning to front. */
	private async onForeground(): Promise<void> {
		await this.render();
		await this.handlePendingAction();
	}

	/** Open the Add form if the widget's + button queued an "add" action. */
	private async handlePendingAction(): Promise<void> {
		if ((await consumePendingWidgetAction()) === "add") {
			openAddTask(this.ctx);
		}
	}

	/** Re-read the vault's data.json and mirror its sections + tasks path. */
	private async syncObsidianConfig(): Promise<void> {
		const vault = this.settings.vault;
		if (!vault) return;
		try {
			if (!(await this.storage.hasVaultAccess(vault))) return;
			const text = await this.storage.readFile(vault, DATA_JSON_PATH);
			if (text !== null && this.applyObsidianConfig(text) !== null) {
				await saveSettings(this.settings);
			}
		} catch {
			/* data.json missing/unreadable — keep whatever sections we have */
		}
	}

	/**
	 * Parse the Obsidian plugin's data.json and adopt its sections + tasks path so
	 * the app mirrors the plugin. Returns the number of sections applied, or null.
	 */
	private applyObsidianConfig(text: string): number | null {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(text) as Record<string, unknown>;
		} catch {
			return null;
		}
		const rawSections = data.sections;
		if (!Array.isArray(rawSections)) return null;

		if (typeof data.tasksFilePath === "string" && data.tasksFilePath.trim()) {
			this.settings.tasksPath = data.tasksFilePath.trim();
		}

		const validSorts: SortOrder[] = ["due", "priority", "priority-due", "file"];
		this.settings.sections = rawSections
			.filter((s): s is Record<string, unknown> => !!s && typeof (s as Record<string, unknown>).tag === "string")
			.map((s): SectionConfig => ({
				id: typeof s.id === "string" ? s.id : newId("s"),
				name: typeof s.name === "string" ? s.name : String(s.tag),
				tag: String(s.tag),
				sort: validSorts.includes(s.sort as SortOrder) ? (s.sort as SortOrder) : "due",
				collapsedByDefault: s.collapsedByDefault === true,
			}));
		return this.settings.sections.length;
	}

	/** Link the Obsidian vault folder (one-time), then mirror its config. */
	private async pickVault(): Promise<void> {
		const vault = await this.storage.pickVault();
		if (!vault) return;
		this.settings.vault = vault;
		await saveSettings(this.settings);
		await this.syncObsidianConfig();
		this.screen = "list";
		await this.render();
	}

	async render(): Promise<void> {
		if (this.screen === "settings") {
			renderSettings(this.ctx, this.root, () => {
				this.screen = "list";
				void this.render();
			});
			return;
		}
		await this.renderList();
	}

	private async renderList(): Promise<void> {
		const { tasks, flat } = await this.service.load();
		this.ctx.knownTags = this.mergedTags(tasks);

		this.root.replaceChildren();
		const screen = el("div", { cls: "screen list-screen" });

		this.renderHeader(screen, flat);

		if (this.settings.pomodoroConfig.enabled) {
			renderPomodoro(this.ctx, screen, uniqueIncompleteNames(flat));
		}

		if (!this.settings.vault) {
			const empty = el("div", { cls: "empty-state" });
			empty.append(
				el("p", { text: "Link your Obsidian vault to see your tasks." }),
				el("p", {
					cls: "empty-sub",
					text: "One folder pick — the app finds your tasks and mirrors your categories automatically.",
				}),
				(() => {
					const b = el("button", { cls: "btn btn-cta", text: "Link Obsidian vault" });
					b.addEventListener("click", () => this.pickVault());
					return b;
				})()
			);
			screen.append(empty);
			this.root.append(screen);
			return;
		}

		const incomplete = tasks.filter((t) => !t.completed);
		const shown = new Set<Task>();
		const widgetCategories: WidgetCategory[] = [];
		const widgetTasks: WidgetTask[] = [];
		let catOrder = 0;
		const collect = (id: string, name: string, list: Task[]) => {
			widgetCategories.push({ id, name });
			for (const t of list) widgetTasks.push(toWidgetTask(t, id, name, catOrder));
			catOrder++;
		};

		for (const section of this.settings.sections) {
			const matching = incomplete.filter((t) => !shown.has(t) && taskHasTag(t, section.tag));
			matching.forEach((t) => shown.add(t));
			const sorted = sortTasks(matching, section.sort);
			this.renderSection(screen, section.id, section.name, sorted, section.collapsedByDefault);
			collect(section.id, section.name, sorted);
		}

		// Anything not captured by a configured section still needs a home.
		const orphans = incomplete.filter((t) => !shown.has(t));
		if (orphans.length) {
			const sorted = sortTasks(orphans, "due");
			this.renderSection(screen, "__other__", "Other", sorted, false);
			collect("__other__", "Other", sorted);
		}

		const completed = tasks.filter((t) => t.completed);
		this.renderCompleted(screen, completed);

		this.root.append(screen);

		// Refresh the home-screen widget snapshot (fire-and-forget).
		void writeWidgetCache(widgetCategories, widgetTasks);
	}

	private renderHeader(parent: HTMLElement, flat: Task[]): void {
		const header = el("div", { cls: "app-header" });
		const top = el("div", { cls: "app-header-top" });

		const today = el("div", { cls: "app-today" });
		today.append(
			el("div", { cls: "app-today-eyebrow", text: "Today" }),
			el("div", { cls: "app-today-date", text: formatDueDisplay(todayISO()) })
		);
		top.append(today);

		const actions = el("div", { cls: "app-header-actions" });
		const settingsBtn = iconButton("settings", "Settings");
		settingsBtn.addEventListener("click", () => this.ctx.openSettings());
		const addBtn = el("button", { cls: "app-add", attrs: { "aria-label": "Add task" } });
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", () => openAddTask(this.ctx));
		actions.append(settingsBtn, addBtn);
		top.append(actions);
		header.append(top);

		let overdue = 0;
		let dueToday = 0;
		for (const t of flat) {
			if (t.completed || !t.due) continue;
			const d = daysUntil(t.due);
			if (d < 0) overdue++;
			else if (d === 0) dueToday++;
		}
		const pressure = el("div", { cls: "app-pressure" });
		if (overdue === 0 && dueToday === 0) {
			pressure.append(el("span", { cls: "pressure-clear", text: "Nothing due today" }));
		} else {
			if (overdue > 0) {
				pressure.append(el("span", { cls: "pressure-overdue", text: `${overdue} overdue` }));
			}
			if (dueToday > 0) {
				pressure.append(el("span", { cls: "pressure-today", text: `${dueToday} due today` }));
			}
		}
		header.append(pressure);
		parent.append(header);
	}

	private renderSection(
		parent: HTMLElement,
		id: string,
		name: string,
		tasks: Task[],
		collapsedByDefault: boolean
	): void {
		const collapsed = this.settings.collapseState[id] ?? collapsedByDefault;
		const section = el("div", { cls: "section" });

		const head = el("div", { cls: "section-head" });
		const twisty = el("span", { cls: collapsed ? "twisty is-collapsed" : "twisty" });
		setIcon(twisty, "chevron");
		head.append(twisty, el("span", { cls: "section-name", text: name }));
		head.append(el("span", { cls: "section-count", text: String(tasks.length) }));
		head.addEventListener("click", () => {
			this.settings.collapseState[id] = !collapsed;
			void saveSettings(this.settings);
			void this.render();
		});
		section.append(head);

		if (!collapsed) {
			const body = el("div", { cls: "section-body" });
			if (tasks.length === 0) {
				body.append(el("div", { cls: "empty-note", text: "Nothing here" }));
			} else {
				for (const t of tasks) renderTask(this.ctx, body, t);
			}
			section.append(body);
		}
		parent.append(section);
	}

	private renderCompleted(parent: HTMLElement, tasks: Task[]): void {
		const sorted = [...tasks].sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
		const collapsed = this.settings.collapseState[COMPLETED_KEY] ?? true;
		const section = el("div", { cls: "section section-completed" });

		const head = el("div", { cls: "section-head" });
		const twisty = el("span", { cls: collapsed ? "twisty is-collapsed" : "twisty" });
		setIcon(twisty, "chevron");
		head.append(twisty, el("span", { cls: "section-name", text: "Completed" }));
		head.append(el("span", { cls: "section-count", text: String(sorted.length) }));
		head.addEventListener("click", () => {
			this.settings.collapseState[COMPLETED_KEY] = !collapsed;
			void saveSettings(this.settings);
			void this.render();
		});
		section.append(head);

		if (!collapsed) {
			const body = el("div", { cls: "section-body" });
			if (sorted.length === 0) body.append(el("div", { cls: "empty-note", text: "Nothing completed yet" }));
			else for (const t of sorted) renderTask(this.ctx, body, t);
			section.append(body);
		}
		parent.append(section);
	}

	private mergedTags(tasks: Task[]): string[] {
		const fileTags = collectTags(tasks);
		const fileSet = new Set(fileTags);
		const recent = this.settings.recentTags.filter((t) => fileSet.has(t));
		const recentSet = new Set(recent);
		return [...recent, ...fileTags.filter((t) => !recentSet.has(t))];
	}
}

/** Flatten one top-level task into the widget's cache shape. */
function toWidgetTask(t: Task, cat: string, catName: string, catOrder: number): WidgetTask {
	return {
		text: t.description,
		raw: t.raw,
		dueDays: t.due ? daysUntil(t.due) : null,
		dueLabel: t.due ? dueLabel(t.due) : null,
		dueClass: t.due ? dueClass(t.due) : null,
		priority: t.priority,
		cat,
		catName,
		catOrder,
	};
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
