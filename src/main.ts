/**
 * main.ts — Plugin entry point.
 *
 * Responsibilities:
 *  - Load / save settings and persisted UI state (loadData / saveData).
 *  - Register the sidebar ItemView, a ribbon icon, and a command to open it.
 *  - Own no parsing logic — that lives exclusively in taskParser.ts.
 */

import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	TasksPluginSettings,
	TasksSettingTab,
} from "./settings";
import { TasksView, VIEW_TYPE_TASKS } from "./taskView";

export default class TasksPlugin extends Plugin {
	settings!: TasksPluginSettings;

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

		// Auto-refresh when the tasks file is changed externally. Registered via
		// this.registerEvent() so Obsidian removes it on plugin unload.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.path === this.settings.tasksFilePath) {
					this.refreshViews();
				}
			})
		);
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
