import { Task, sortTasks, taskHasTag, collectTags } from "@toolbox/task-core";
import { el } from "./dom";
import { setIcon, iconButton } from "./icons";
import { todayISO, formatDueDisplay, daysUntil, dueLabel, dueClass } from "../dates";
import { writeWidgetCache, type WidgetGroup } from "../widgetCache";
import { renderTask } from "./taskRow";
import { renderPomodoro } from "./pomodoro";
import { renderSettings } from "./settingsScreen";
import { openAddTask } from "./addModal";
import { COMPLETED_KEY, saveSettings, newId } from "../appState";
import type { AppSettings, SectionConfig } from "../appState";
import type { SortOrder } from "@toolbox/task-core";
import type { TaskService } from "../taskService";
import type { StorageAdapter } from "../storage";
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
			pickFile: () => this.pickFile(),
			importObsidianSettings: () => this.importObsidianSettings(),
		};
	}

	/**
	 * Read the Obsidian plugin's data.json (chosen via the file picker) and adopt
	 * its sections + Pomodoro config, so the app's categories mirror the plugin.
	 * The plugin's SectionConfig shape is identical to the app's.
	 */
	private async importObsidianSettings(): Promise<number | null> {
		const ref = await this.storage.pickFile();
		if (!ref) return null;
		let text: string;
		try {
			text = await this.storage.read(ref);
		} catch {
			return null;
		}
		const applied = this.applyObsidianConfig(text);
		if (applied === null) return null;
		// Remember the file so launches re-sync categories automatically.
		this.settings.obsidianConfig = ref;
		await saveSettings(this.settings);
		return applied;
	}

	async start(): Promise<void> {
		// If the user has linked their Obsidian data.json, re-read it on launch so
		// categories keep mirroring the plugin without any manual step.
		await this.syncObsidianConfig();
		await this.render();
	}

	/** Silently re-apply sections from the linked Obsidian data.json, if reachable. */
	private async syncObsidianConfig(): Promise<void> {
		const ref = this.settings.obsidianConfig;
		if (!ref) return;
		try {
			if (!(await this.storage.hasAccess(ref))) return;
			const applied = this.applyObsidianConfig(await this.storage.read(ref));
			if (applied !== null) await saveSettings(this.settings);
		} catch {
			/* config moved or unreadable — keep whatever sections we have */
		}
	}

	/**
	 * Parse an Obsidian plugin data.json string and adopt its sections + Pomodoro
	 * config. Returns the number of sections applied, or null if it wasn't valid.
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

		const pc = this.settings.pomodoroConfig;
		if (typeof data.pomodoroEnabled === "boolean") pc.enabled = data.pomodoroEnabled;
		const num = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);
		pc.workMin = num(data.pomodoroWorkMin, pc.workMin);
		pc.shortMin = num(data.pomodoroShortMin, pc.shortMin);
		pc.longMin = num(data.pomodoroLongMin, pc.longMin);
		pc.longEvery = num(data.pomodoroLongEvery, pc.longEvery);
		return this.settings.sections.length;
	}

	private async pickFile(): Promise<void> {
		const ref = await this.storage.pickFile();
		if (!ref) return;
		this.settings.file = ref;
		await saveSettings(this.settings);
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

		if (!this.settings.file) {
			const empty = el("div", { cls: "empty-state" });
			empty.append(
				el("p", { text: "No tasks file selected." }),
				(() => {
					const b = el("button", { cls: "btn btn-cta", text: "Choose your tasks.md" });
					b.addEventListener("click", () => this.pickFile());
					return b;
				})()
			);
			screen.append(empty);
			this.root.append(screen);
			return;
		}

		const incomplete = tasks.filter((t) => !t.completed);
		const shown = new Set<Task>();
		const widgetGroups: WidgetGroup[] = [];
		for (const section of this.settings.sections) {
			const matching = incomplete.filter((t) => !shown.has(t) && taskHasTag(t, section.tag));
			matching.forEach((t) => shown.add(t));
			const sorted = sortTasks(matching, section.sort);
			this.renderSection(screen, section.id, section.name, sorted, section.collapsedByDefault);
			widgetGroups.push(toWidgetGroup(section.id, section.name, sorted));
		}

		// Anything not captured by a configured section still needs a home.
		const orphans = incomplete.filter((t) => !shown.has(t));
		if (orphans.length) {
			const sorted = sortTasks(orphans, "due");
			this.renderSection(screen, "__other__", "Other", sorted, false);
			widgetGroups.push(toWidgetGroup("__other__", "Other", sorted));
		}

		const completed = tasks.filter((t) => t.completed);
		this.renderCompleted(screen, completed);

		this.root.append(screen);

		// Refresh the home-screen widget snapshot (fire-and-forget).
		void writeWidgetCache(widgetGroups);
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

/** Flatten a section's top-level tasks into the widget's cache shape. */
function toWidgetGroup(id: string, name: string, tasks: Task[]): WidgetGroup {
	return {
		id,
		name,
		tasks: tasks.map((t) => ({
			text: t.description,
			dueLabel: t.due ? dueLabel(t.due) : null,
			dueClass: t.due ? dueClass(t.due) : null,
			priority: t.priority,
		})),
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
