/**
 * main.ts — Plugin entry point.
 *
 * Responsibilities:
 *  - Load / save settings and persisted UI state (loadData / saveData).
 *  - Register the sidebar ItemView, a ribbon icon, and a command to open it.
 *  - Own no parsing logic — that lives exclusively in taskParser.ts.
 */

import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, requestUrl } from "obsidian";
import type { Extension } from "@codemirror/state";
import {
	DEFAULT_SETTINGS,
	TasksPluginSettings,
	TasksSettingTab,
} from "./settings";
import { TasksView, VIEW_TYPE_TASKS } from "./taskView";
import { CalendarOccurrence, getEventsForToday } from "./calendar";
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
	 * Fetch the configured .ics feed and cache today's events, then refresh the
	 * panel. Uses requestUrl (no CORS restriction). Safe to call repeatedly.
	 */
	async fetchCalendar(): Promise<void> {
		const raw = this.settings.icsUrl.trim();
		if (!raw) {
			this.calendarEvents = [];
			this.calendarError = null;
			this.refreshViews();
			return;
		}
		// webcal:// is just https with another scheme.
		const url = raw.replace(/^webcal:\/\//i, "https://");
		try {
			const res = await requestUrl({ url });
			this.calendarEvents = getEventsForToday(res.text);
			this.calendarError = null;
		} catch (e) {
			this.calendarEvents = [];
			this.calendarError = "Couldn't load the calendar. Check the URL in settings.";
		}
		this.refreshViews();
	}

	onunload(): void {
		// Leaves are detached by Obsidian; nothing else to clean up because all
		// event listeners were registered via this.registerEvent().
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

	/** Re-render every open tasks view (used after settings changes). */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS)) {
			const view = leaf.view;
			if (view instanceof TasksView) view.refresh();
		}
	}
}
