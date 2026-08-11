import {
	Task,
	sortTasks,
	collectTags,
	sectionCandidates,
	tagListHasTag,
	groupTasksByDue,
	DUE_BUCKET_LABELS,
	VIEW_ALL,
	VIEW_TODAY,
	VIEW_WEEK,
} from "@toolbox/task-core";
import { el } from "./dom";
import { setIcon, iconButton } from "./icons";
import { todayISO, formatDueDisplay, sectionAccent, dueWithin } from "../dates";
import {
	writeWidgetCache,
	consumePendingWidgetAction,
	type WidgetCategory,
	type WidgetTask,
} from "../widgetCache";
import { renderTask } from "./taskRow";
import { renderPomodoro } from "./pomodoro";
import { renderViewSwitcher } from "./viewSwitcher";
import { openReschedule } from "./reschedule";
import { renderSettings } from "./settingsScreen";
import { openAddTask } from "./addModal";
import { COMPLETED_KEY, saveSettings, newId } from "../appState";
import type { AppSettings, SectionConfig } from "../appState";
import type { SortOrder, ViewId, SectionCandidate } from "@toolbox/task-core";
import type { TaskService } from "../taskService";
import type { StorageAdapter } from "../storage";
import { DATA_JSON_PATH } from "../storage";
import type { AppContext } from "./context";

type Screen = "list" | "settings";

export class App {
	private ctx: AppContext;
	private screen: Screen = "list";
	/** True once a vault data.json was read this session (it wins over auto/manual). */
	private vaultConfigFound = false;

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
		await this.ensureTasksPath();
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
				this.vaultConfigFound = true;
				await saveSettings(this.settings);
			}
		} catch {
			/* data.json missing/unreadable — keep whatever sections we have */
		}
	}

	/**
	 * Build one category per distinct tag in the file, in first-seen order. Used
	 * when the plugin's data.json isn't on the phone, so categories still reflect
	 * the user's real tags with no configuration.
	 */
	private deriveCategoriesFromTags(flat: Task[]): void {
		const seen = new Set<string>();
		const cats: SectionConfig[] = [];
		for (const t of flat) {
			for (const tag of t.tags) {
				if (seen.has(tag)) continue;
				seen.add(tag);
				cats.push({
					id: "auto-" + tag,
					name: tag.replace(/^#/, ""),
					tag,
					sort: "due",
					collapsedByDefault: false,
				});
			}
		}
		this.settings.sections = cats;
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
		await this.ensureTasksPath();
		this.screen = "list";
		await this.render();
	}

	/**
	 * If the configured tasks path doesn't resolve (common when the plugin's
	 * data.json isn't synced to mobile), probe a few usual locations so the app
	 * still finds the tasks file with no manual setup.
	 */
	private async ensureTasksPath(): Promise<void> {
		const vault = this.settings.vault;
		if (!vault) return;
		try {
			if ((await this.storage.readFile(vault, this.settings.tasksPath)) !== null) return;
			const candidates = [
				"tasks.md",
				"Tasks/tasks.md",
				"Tasks/Tasks.md",
				"tasks/tasks.md",
				"Tasks/All Tasks.md",
			];
			for (const path of candidates) {
				if (path === this.settings.tasksPath) continue;
				if ((await this.storage.readFile(vault, path)) !== null) {
					this.settings.tasksPath = path;
					await saveSettings(this.settings);
					return;
				}
			}
		} catch {
			/* leave the path as-is; the user can set it in Settings */
		}
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

		// No data.json on the phone and not manually configured → categories follow
		// the file's tags automatically.
		if (!this.vaultConfigFound && this.settings.categoriesMode === "auto") {
			this.deriveCategoriesFromTags(flat);
		}

		// Incomplete top-level tasks plus every dated subtask lifted to stand on
		// its own, each carrying its inherited tags. Shared with the Obsidian
		// plugin so the two can't drift on what's listed or how tags match.
		// Computed once up front so the header's scoped overdue count, the view
		// switcher and whichever view is active all agree on the same set.
		const candidates = sectionCandidates(tasks);
		const activeView = this.resolveActiveView();
		const scopeTag = this.scopeTagFor(activeView);

		this.root.replaceChildren();
		const screen = el("div", { cls: "screen list-screen" });

		this.renderHeader(screen, candidates, scopeTag);
		renderViewSwitcher(this.ctx, screen, activeView);

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

		const promotedBy = new Map<Task, Task>();
		for (const c of candidates) if (c.parent) promotedBy.set(c.task, c.parent);

		// The home-screen widget always mirrors every category, regardless of
		// which view the app itself is currently showing.
		this.buildWidgetSnapshot(candidates);

		if (activeView === VIEW_TODAY || activeView === VIEW_WEEK) {
			this.renderCrossCutting(screen, candidates, promotedBy, activeView === VIEW_TODAY ? 0 : 6);
		} else {
			// A task renders in the first section it matches only — never twice
			// within the section list.
			const shown = new Set<Task>();
			const sectionsToShow =
				activeView === VIEW_ALL
					? this.settings.sections
					: this.settings.sections.filter((s) => s.id === activeView);
			for (const section of sectionsToShow) {
				const matching = candidates.filter(
					(c) => !shown.has(c.task) && tagListHasTag(c.tags, section.tag)
				);
				matching.forEach((c) => shown.add(c.task));
				const sorted = sortTasks(
					matching.map((c) => c.task),
					section.sort
				);
				this.renderSection(
					screen,
					section.id,
					section.name,
					sorted,
					section.collapsedByDefault,
					promotedBy,
					section.sort,
					section.tag
				);
			}

			// Anything not captured by a configured section still needs a home —
			// only meaningful in "All", since a single category has nothing
			// uncategorised to show.
			if (activeView === VIEW_ALL) {
				const orphans = candidates.filter((c) => !shown.has(c.task));
				if (orphans.length) {
					const sorted = sortTasks(
						orphans.map((c) => c.task),
						"due"
					);
					this.renderSection(screen, "__other__", "Other", sorted, false, promotedBy, "due");
				}
			}
		}

		const completed = tasks.filter((t) => t.completed);
		this.renderCompleted(screen, completed);

		this.root.append(screen);
	}

	/** The active view, falling back to "All" if it names a since-deleted section. */
	private resolveActiveView(): ViewId {
		const v = this.settings.activeView;
		if (v === VIEW_ALL || v === VIEW_TODAY || v === VIEW_WEEK) return v;
		return this.settings.sections.some((s) => s.id === v) ? v : VIEW_ALL;
	}

	/** The section tag a view is scoped to, or null when it spans every task. */
	private scopeTagFor(view: ViewId): string | null {
		if (view === VIEW_ALL || view === VIEW_TODAY || view === VIEW_WEEK) return null;
		return this.settings.sections.find((s) => s.id === view)?.tag ?? null;
	}

	/**
	 * Refresh the home-screen widget snapshot from every configured category,
	 * regardless of which view is on screen — the widget stays a fixed
	 * read-only surface (RemoteViews can't host a view switcher or a popover),
	 * unaffected by the phone app's current tab.
	 */
	private buildWidgetSnapshot(candidates: SectionCandidate[]): void {
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
			const matching = candidates.filter(
				(c) => !shown.has(c.task) && tagListHasTag(c.tags, section.tag)
			);
			matching.forEach((c) => shown.add(c.task));
			collect(
				section.id,
				section.name,
				sortTasks(
					matching.map((c) => c.task),
					section.sort
				)
			);
		}

		const orphans = candidates.filter((c) => !shown.has(c.task));
		if (orphans.length) {
			collect(
				"__other__",
				"Other",
				sortTasks(
					orphans.map((c) => c.task),
					"due"
				)
			);
		}

		void writeWidgetCache(widgetCategories, widgetTasks);
	}

	/**
	 * Every incomplete task in the file (any section, any depth) whose due date
	 * falls inside the window, run through the same due-group dividers a
	 * due-sorted section uses. `days` is 0 for "Today" (overdue + due today
	 * only) and 6 for "This week" (a rolling 7-day span, not a calendar week) —
	 * undated tasks never appear in either.
	 */
	private renderCrossCutting(
		parent: HTMLElement,
		candidates: SectionCandidate[],
		promotedBy: Map<Task, Task>,
		days: number
	): void {
		const filtered = candidates.filter((c) => c.task.due && dueWithin(c.task.due, days));
		const sorted = sortTasks(
			filtered.map((c) => c.task),
			"due"
		);

		const wrap = el("div", { cls: "section section-crosscut" });
		if (sorted.length === 0) {
			wrap.append(
				el("div", {
					cls: "empty-note",
					text: days === 0 ? "Nothing due today" : "Nothing due this week",
				})
			);
			parent.append(wrap);
			return;
		}
		const body = el("div", { cls: "section-body" });
		this.renderDueGroups(body, sorted, promotedBy);
		wrap.append(body);
		parent.append(wrap);
	}

	private renderHeader(
		parent: HTMLElement,
		candidates: SectionCandidate[],
		scopeTag: string | null
	): void {
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

		// Read from the same candidate set + scopeTag filter `overdueCandidates`
		// below uses, so this count and the reschedule button's reach can never
		// disagree on any view — not just the unscoped ones (matches the fix in
		// the Obsidian plugin's taskView.ts; see DEV_RULES.md §11 there).
		const todayIso = todayISO();
		let overdue = 0;
		let dueToday = 0;
		for (const c of candidates) {
			if (c.task.completed || !c.task.due) continue;
			if (scopeTag && !tagListHasTag(c.tags, scopeTag)) continue;
			if (c.task.due < todayIso) overdue++;
			else if (c.task.due === todayIso) dueToday++;
		}

		// Triage status line: today's load as a typeset console readout — the
		// number and its noun are separate spans so the count can carry the weight
		// while the label stays quiet. Colour-bonded to the due ramp below, and
		// overdue is the one thing allowed to shout.
		const pressure = el("div", { cls: "app-pressure" });
		// `overdue`/`dueToday` above and `overdueCandidates` below read the same
		// candidate set + scopeTag filter, so they can never disagree on any view.
		const overdueTargets = overdueCandidates(candidates, scopeTag, todayIso);
		if (overdue === 0 && dueToday === 0) {
			pressure.append(el("span", { cls: "pressure-clear", text: "Nothing due today" }));
		} else {
			if (overdue > 0) {
				const s = el("span", { cls: "stat is-overdue" });
				s.append(
					el("span", { cls: "stat-num", text: String(overdue) }),
					el("span", { cls: "stat-label", text: "overdue" })
				);

				// Mass reschedule rides directly on the "overdue" stat it acts on,
				// not the tail of the whole status line — it only ever touches
				// overdue tasks, so it belongs next to that number, not floating
				// past "due today" as if it applied to both.
				if (overdueTargets.length > 0) {
					const btn = el("button", {
						cls: "icon-button reschedule-btn",
						attrs: { "aria-label": "Reschedule overdue tasks" },
					});
					setIcon(btn, "calendar");
					btn.addEventListener("click", () => openReschedule(this.ctx, overdueTargets.length, scopeTag));
					s.append(btn);
				}

				pressure.append(s);
			}
			if (overdue > 0 && dueToday > 0) {
				pressure.append(el("span", { cls: "stat-sep", text: "·" }));
			}
			if (dueToday > 0) {
				const s = el("span", { cls: "stat is-today" });
				s.append(
					el("span", { cls: "stat-num", text: String(dueToday) }),
					el("span", { cls: "stat-label", text: "due today" })
				);
				pressure.append(s);
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
		collapsedByDefault: boolean,
		promotedBy: Map<Task, Task>,
		sort: SortOrder,
		tag?: string
	): void {
		const collapsed = this.settings.collapseState[id] ?? collapsedByDefault;
		const section = el("div", { cls: "section" });
		// Each lane carries a stable accent hue hashed from its id — the one place
		// colour is spent on identity rather than urgency. The id comes from the
		// plugin's data.json, so a section is the same colour in both surfaces.
		section.style.setProperty("--section-accent", sectionAccent(id));

		const head = el("div", { cls: "section-head" });
		const twisty = el("span", { cls: collapsed ? "twisty is-collapsed" : "twisty" });
		setIcon(twisty, "chevron");
		head.append(twisty, el("span", { cls: "section-name", text: name }));
		head.append(el("span", { cls: "section-count", text: String(tasks.length) }));

		if (tag) {
			const addBtn = el("button", { cls: "section-add-btn", attrs: { "aria-label": `Add task to ${name}` } });
			setIcon(addBtn, "plus");
			addBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				openAddTask(this.ctx, tag);
			});
			head.append(addBtn);
		}

		head.addEventListener("click", () => {
			this.settings.collapseState[id] = !collapsed;
			void saveSettings(this.settings);
			void this.render();
		});
		section.append(head);

		if (!collapsed) {
			const body = el("div", { cls: "section-body" });
			if (tasks.length === 0) {
				body.append(el("div", { cls: "empty-note", text: "Nothing due here" }));
			} else if (sort === "due") {
				this.renderDueGroups(body, tasks, promotedBy);
			} else {
				for (const t of tasks) renderTask(this.ctx, body, t, [], promotedBy.get(t));
			}
			section.append(body);
		}
		parent.append(section);
	}

	/**
	 * Render a due-sorted list broken at its proximity boundaries. What's late
	 * and what's due today are different jobs, so they get a visible edge between
	 * them rather than running together as one column of rows. A single bucket
	 * needs no label — the whole list is that bucket.
	 */
	private renderDueGroups(body: HTMLElement, sorted: Task[], promotedBy: Map<Task, Task>): void {
		const groups = groupTasksByDue(sorted, todayISO());
		for (const group of groups) {
			if (groups.length > 1) {
				const divider = el("div", { cls: `due-group is-${group.bucket}` });
				divider.append(
					el("span", { cls: "due-group-label", text: DUE_BUCKET_LABELS[group.bucket] }),
					el("span", { cls: "due-group-count", text: String(group.tasks.length) })
				);
				body.append(divider);
			}
			for (const t of group.tasks) renderTask(this.ctx, body, t, [], promotedBy.get(t));
		}
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
			if (sorted.length === 0)
				body.append(el("div", { cls: "empty-note", text: "Completed tasks land here" }));
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
		due: t.due,
		priority: t.priority,
		cat,
		catName,
		catOrder,
	};
}

/**
 * Overdue, incomplete candidates — every dated task at any depth (matching
 * the header's "N overdue" rule) when `scopeTag` is null, or just the ones
 * matching that tag (own + inherited, like section membership) when scoped
 * to one view. Shared by the header's reschedule button and
 * `TaskService.rescheduleOverdue` so the count shown and the set acted on
 * are always the same tasks.
 */
function overdueCandidates(
	candidates: SectionCandidate[],
	scopeTag: string | null,
	today: string
): SectionCandidate[] {
	return candidates
		.filter((c) => !c.task.completed && c.task.due && c.task.due < today)
		.filter((c) => !scopeTag || tagListHasTag(c.tags, scopeTag));
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
