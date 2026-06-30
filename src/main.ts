/**
 * main.ts — Plugin entry point.
 *
 * Responsibilities:
 *  - Load / save settings and persisted UI state (loadData / saveData).
 *  - Register the sidebar ItemView, a ribbon icon, and a command to open it.
 *  - Own no parsing logic — that lives exclusively in taskParser.ts.
 */

import {
	Plugin,
	WorkspaceLeaf,
	TFile,
	TAbstractFile,
	requestUrl,
	Editor,
	MarkdownView,
	MarkdownRenderChild,
	Notice,
} from "obsidian";
import type { Extension } from "@codemirror/state";
import {
	DEFAULT_SETTINGS,
	TasksPluginSettings,
	TasksSettingTab,
	migrateCalendars,
} from "./settings";
import { TasksView, VIEW_TYPE_TASKS } from "./taskView";
import { TimesheetView, VIEW_TYPE_TIMESHEET } from "./timesheetView";
import { CalendarOccurrence, getEventsForToday, mergeOccurrences } from "./calendar";
import { renderTodayCalendar } from "./calendarView";
import { COLUMNS_CLASS, editableColumnsExtension } from "./editableColumns";
import { openEmbedEditor, resolveEmbed } from "./embedEditor";

/** How often to re-fetch the calendar feed while the plugin is running. */
const CALENDAR_REFRESH_MS = 30 * 60 * 1000;

export default class TasksPlugin extends Plugin {
	settings!: TasksPluginSettings;

	/** Today's calendar events (cached; refreshed on a timer). */
	calendarEvents: CalendarOccurrence[] = [];
	/** Non-null when the last fetch failed — surfaced in the panel. */
	calendarError: string | null = null;

	/**
	 * Live mutable array handed to registerEditorExtension. Toggling the feature
	 * mutates this in place and calls workspace.updateOptions() so the CM6
	 * extension is added/removed without re-registering. Obsidian disposes the
	 * registration itself on unload.
	 */
	private columnsExtension: Extension[] = [];

	/** Mounted `toolbox-calendar` block containers, re-rendered when feeds refresh. */
	private calendarBlocks = new Set<HTMLElement>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_TASKS, (leaf: WorkspaceLeaf) => new TasksView(leaf, this));

		this.addRibbonIcon("list-checks", "Open tasks panel", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-tasks-panel",
			name: "Open tasks panel",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new TasksSettingTab(this.app, this));

		// Auto-refresh when the tasks file changes externally — including being
		// created, deleted, or renamed into/out of the configured path. All
		// registered via this.registerEvent() so Obsidian removes them on unload.
		const isTasksFile = (file: TAbstractFile): boolean =>
			file instanceof TFile && file.path === this.settings.tasksFilePath;

		this.registerEvent(this.app.vault.on("modify", (f) => isTasksFile(f) && this.refreshViews()));
		this.registerEvent(this.app.vault.on("create", (f) => isTasksFile(f) && this.refreshViews()));
		this.registerEvent(this.app.vault.on("delete", (f) => isTasksFile(f) && this.refreshViews()));
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (isTasksFile(f) || oldPath === this.settings.tasksFilePath) this.refreshViews();
			})
		);

		// Calendar: fetch now and on a timer. registerInterval ensures cleanup.
		this.fetchCalendar();
		this.registerInterval(window.setInterval(() => this.fetchCalendar(), CALENDAR_REFRESH_MS));

		// Editable Columns: register the (initially empty) editor-extension slot,
		// then fill it if the feature is enabled. registerEditorExtension is
		// auto-disposed on unload.
		this.registerEditorExtension(this.columnsExtension);
		this.applyEditableColumns();

		// One document-level click listener (auto-removed on unload) makes embeds
		// INSIDE our column cells editable. Scoped to .toolbox-columns so we never
		// hijack ordinary embeds elsewhere in the vault.
		this.registerDomEvent(document, "click", (evt) => this.handleColumnEmbedClick(evt));

		// Insert-columns affordances: a ribbon icon and a command, both of which
		// drop a starter block at the cursor in the active editor.
		this.addRibbonIcon("columns-3", "Insert columns", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice("Open a note in editing mode to insert columns.");
				return;
			}
			this.insertColumnsBlock(view.editor);
		});

		this.addCommand({
			id: "insert-columns-block",
			name: "Insert columns block",
			editorCallback: (editor: Editor) => this.insertColumnsBlock(editor),
		});

		// ── Timesheet ──────────────────────────────────────────────────────
		this.registerView(VIEW_TYPE_TIMESHEET, (leaf: WorkspaceLeaf) => new TimesheetView(leaf, this));

		this.addRibbonIcon("clock", "Open timesheet", () => {
			this.activateTimesheetView();
		});

		this.addCommand({
			id: "open-timesheet",
			name: "Open timesheet",
			callback: () => this.activateTimesheetView(),
		});

		const isTimesheetFile = (file: TAbstractFile): boolean =>
			file instanceof TFile && file.path === this.settings.timesheetFilePath;

		this.registerEvent(this.app.vault.on("modify", (f) => isTimesheetFile(f) && this.refreshTimesheetViews()));
		this.registerEvent(this.app.vault.on("create", (f) => isTimesheetFile(f) && this.refreshTimesheetViews()));
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (isTimesheetFile(f) || oldPath === this.settings.timesheetFilePath) this.refreshTimesheetViews();
			})
		);

		// `toolbox-calendar` code block: renders the same merged "today" list as the
		// sidebar, anywhere in a note (including inside a columns cell). Tracked so
		// it re-renders when the feeds refresh; untracked on unload.
		this.registerMarkdownCodeBlockProcessor("toolbox-calendar", (_source, el, ctx) => {
			const host = el.createDiv();
			this.calendarBlocks.add(host);
			this.renderCalendarBlock(host);
			const child = new MarkdownRenderChild(host);
			child.register(() => this.calendarBlocks.delete(host));
			ctx.addChild(child);
		});
	}

	/** Render today's merged events into a single `toolbox-calendar` host element. */
	private renderCalendarBlock(host: HTMLElement): void {
		host.empty();
		renderTodayCalendar(host, this.calendarEvents, this.calendarError);
	}

	/** Re-render every mounted `toolbox-calendar` block (after a feed refresh). */
	private refreshCalendarBlocks(): void {
		for (const host of this.calendarBlocks) this.renderCalendarBlock(host);
	}

	/**
	 * Insert a two-column starter block at the cursor, on its own line(s), and
	 * place the cursor inside the first cell ready to type. The markup is the same
	 * `%% columns %%` grammar editableColumns.ts renders.
	 */
	private insertColumnsBlock(editor: Editor): void {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const needNL = lineText.trim().length > 0;

		const block =
			(needNL ? "\n" : "") +
			"%% columns:start %%\n%% col %%\n\n%% col %%\n\n%% columns:end %%\n";
		editor.replaceRange(block, { line: cursor.line, ch: lineText.length });

		// First empty cell line: after the start + first `%% col %%` markers.
		const firstCellLine = cursor.line + (needNL ? 3 : 2);
		editor.setCursor({ line: firstCellLine, ch: 0 });
		editor.focus();
	}

	/**
	 * Add or remove the columns CM6 extension to match the current setting, then
	 * refresh all editors so the change takes effect immediately.
	 */
	applyEditableColumns(): void {
		this.columnsExtension.length = 0;
		if (this.settings.editableColumnsEnabled) {
			this.columnsExtension.push(editableColumnsExtension);
		}
		this.app.workspace.updateOptions();
	}

	/** Open the floating editor when an embed inside a column cell is clicked. */
	private handleColumnEmbedClick(evt: MouseEvent): void {
		if (!this.settings.editableColumnsEnabled) return;
		const target = evt.target as HTMLElement | null;
		if (!target || !target.closest("." + COLUMNS_CLASS)) return;

		const embedEl = target.closest<HTMLElement>(".internal-embed");
		if (!embedEl) return;
		// Don't fight the embed's own interactive bits (links, the open button).
		if (target.closest("a, button")) return;

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		const resolved = resolveEmbed(this.app, embedEl, sourcePath);
		if (!resolved) return;

		evt.preventDefault();
		evt.stopPropagation();
		void openEmbedEditor(this.app, resolved);
	}

	/**
	 * Fetch every configured .ics feed (one URL per line) and cache today's
	 * merged, de-duplicated events, then refresh the panel. Uses requestUrl (no
	 * CORS restriction) and fetches feeds in parallel. Safe to call repeatedly.
	 *
	 * Error policy: an error is surfaced only when *every* feed fails. If some
	 * feeds load, we show what we have rather than nag about a partial failure.
	 */
	async fetchCalendar(): Promise<void> {
		const urls = this.settings.calendars
			.map((c) => c.url.trim())
			.filter((u) => u.length > 0)
			// webcal:// is just https with another scheme.
			.map((u) => u.replace(/^webcal:\/\//i, "https://"));

		if (urls.length === 0) {
			this.calendarEvents = [];
			this.calendarError = null;
			this.refreshViews();
			return;
		}

		const results = await Promise.allSettled(urls.map((url) => requestUrl({ url })));

		const lists: CalendarOccurrence[][] = [];
		let anySuccess = false;
		for (const res of results) {
			if (res.status === "fulfilled") {
				lists.push(getEventsForToday(res.value.text));
				anySuccess = true;
			}
		}

		this.calendarEvents = mergeOccurrences(lists);
		this.calendarError = anySuccess
			? null
			: "Couldn't load the calendar. Check the URL(s) in settings.";
		this.refreshViews();
	}

	/**
	 * Fetch a single feed and report whether it loaded and how many events it has
	 * today. Used by the settings UI to show per-calendar sync status.
	 */
	async fetchOneCalendar(url: string): Promise<{ ok: boolean; count: number }> {
		const u = url.trim().replace(/^webcal:\/\//i, "https://");
		if (!u) return { ok: false, count: 0 };
		try {
			const res = await requestUrl({ url: u });
			return { ok: true, count: getEventsForToday(res.text).length };
		} catch {
			return { ok: false, count: 0 };
		}
	}

	onunload(): void {
		// Leaves are detached by Obsidian; nothing else to clean up because all
		// event listeners were registered via this.registerEvent().
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// One-time: fold the legacy newline-separated icsUrl into the calendar list.
		if (migrateCalendars(this.settings)) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Open the tasks view in the right sidebar and reveal it. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TASKS);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_TASKS, active: true });
		}

		if (leaf) workspace.revealLeaf(leaf);
	}

	/** Open the timesheet view in the right sidebar and reveal it. */
	async activateTimesheetView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TIMESHEET);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_TIMESHEET, active: true });
		}

		if (leaf) workspace.revealLeaf(leaf);
	}

	/** Re-render every open timesheet view (used after settings changes). */
	refreshTimesheetViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMESHEET)) {
			const view = leaf.view;
			if (view instanceof TimesheetView) view.refresh();
		}
	}

	/** Re-render every open tasks view (used after settings changes). */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS)) {
			const view = leaf.view;
			if (view instanceof TasksView) view.refresh();
		}
		this.refreshCalendarBlocks();
	}
}
