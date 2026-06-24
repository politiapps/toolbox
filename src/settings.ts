/**
 * settings.ts — All user-configurable values plus the native settings tab.
 *
 * STRICT RULE: Anything user-facing (file path, section names, tags, sort
 * orders) is defined here and read from settings. Never hardcode these
 * elsewhere in the plugin.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type TasksPlugin from "./main";

export type SortOrder = "due" | "priority-due" | "priority" | "file";

export const SORT_ORDER_LABELS: Record<SortOrder, string> = {
	due: "Due date",
	"priority-due": "Priority, then due date",
	priority: "Priority only",
	file: "File order",
};

/** One user-defined section in the sidebar. */
export interface SectionConfig {
	/** Stable id used as the persistence key for collapse state. */
	id: string;
	name: string;
	/** Tag to filter by, including the leading '#'. */
	tag: string;
	sort: SortOrder;
	collapsedByDefault: boolean;
}

export interface TasksPluginSettings {
	/** Path to the markdown file used as the task store. */
	tasksFilePath: string;
	sections: SectionConfig[];
	/** Tracked automatically — most recently used tag first. */
	recentTags: string[];
	/** Persisted collapse state keyed by section id (and the completed key). */
	collapseState: Record<string, boolean>;
}

/** Persistence key for the always-present Completed section. */
export const COMPLETED_KEY = "__completed__";

export const DEFAULT_SETTINGS: TasksPluginSettings = {
	tasksFilePath: "tasks.md",
	sections: [],
	recentTags: [],
	collapseState: {},
};

/** Generate a reasonably unique id for a new section. */
export function newSectionId(): string {
	return "sec-" + Math.random().toString(36).slice(2, 9);
}

export class TasksSettingTab extends PluginSettingTab {
	plugin: TasksPlugin;

	constructor(app: App, plugin: TasksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Tasks panel settings" });

		new Setting(containerEl)
			.setName("Tasks file path")
			.setDesc("Path to the markdown file used as the task store (relative to the vault root).")
			.addText((text) =>
				text
					.setPlaceholder("tasks.md")
					.setValue(this.plugin.settings.tasksFilePath)
					.onChange(async (value) => {
						this.plugin.settings.tasksFilePath = value.trim() || "tasks.md";
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		containerEl.createEl("h3", { text: "Sections" });
		containerEl.createEl("p", {
			text: "Sections are rendered top-to-bottom in the order listed here. The Completed section is always shown at the bottom.",
			cls: "setting-item-description",
		});

		this.plugin.settings.sections.forEach((section, index) => {
			this.renderSectionSetting(containerEl, section, index);
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add section")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.sections.push({
						id: newSectionId(),
						name: "New section",
						tag: "#tag",
						sort: "due",
						collapsedByDefault: false,
					});
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
					this.display();
				})
		);
	}

	private renderSectionSetting(containerEl: HTMLElement, section: SectionConfig, index: number): void {
		const wrapper = containerEl.createDiv({ cls: "tasks-section-setting" });

		new Setting(wrapper)
			.setName(`Section ${index + 1}`)
			.addExtraButton((btn) =>
				btn
					.setIcon("chevron-up")
					.setTooltip("Move up")
					.setDisabled(index === 0)
					.onClick(async () => {
						this.moveSection(index, index - 1);
					})
			)
			.addExtraButton((btn) =>
				btn
					.setIcon("chevron-down")
					.setTooltip("Move down")
					.setDisabled(index === this.plugin.settings.sections.length - 1)
					.onClick(async () => {
						this.moveSection(index, index + 1);
					})
			)
			.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Delete section")
					.onClick(async () => {
						this.plugin.settings.sections.splice(index, 1);
						delete this.plugin.settings.collapseState[section.id];
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
						this.display();
					})
			);

		new Setting(wrapper).setName("Display name").addText((text) =>
			text.setValue(section.name).onChange(async (value) => {
				section.name = value;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			})
		);

		new Setting(wrapper)
			.setName("Tag")
			.setDesc("Tasks containing this tag appear in the section. Include the leading '#'.")
			.addText((text) =>
				text.setValue(section.tag).onChange(async (value) => {
					let v = value.trim();
					if (v && !v.startsWith("#")) v = "#" + v;
					section.tag = v;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
			);

		new Setting(wrapper).setName("Sort order").addDropdown((dd) => {
			(Object.keys(SORT_ORDER_LABELS) as SortOrder[]).forEach((key) =>
				dd.addOption(key, SORT_ORDER_LABELS[key])
			);
			dd.setValue(section.sort).onChange(async (value) => {
				section.sort = value as SortOrder;
				await this.plugin.saveSettings();
				this.plugin.refreshViews();
			});
		});

		new Setting(wrapper).setName("Collapsed by default").addToggle((toggle) =>
			toggle.setValue(section.collapsedByDefault).onChange(async (value) => {
				section.collapsedByDefault = value;
				await this.plugin.saveSettings();
			})
		);
	}

	private async moveSection(from: number, to: number): Promise<void> {
		const sections = this.plugin.settings.sections;
		if (to < 0 || to >= sections.length) return;
		const [moved] = sections.splice(from, 1);
		sections.splice(to, 0, moved);
		await this.plugin.saveSettings();
		this.plugin.refreshViews();
		this.display();
	}
}

/** Promote a tag to the front of the recently-used list (most recent first). */
export function touchRecentTag(settings: TasksPluginSettings, tag: string): void {
	if (!tag) return;
	const normalised = tag.startsWith("#") ? tag : "#" + tag;
	settings.recentTags = [
		normalised,
		...settings.recentTags.filter((t) => t !== normalised),
	];
}
