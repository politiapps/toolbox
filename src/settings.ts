/**
 * settings.ts — All user-configurable values plus the native settings tab.
 *
 * STRICT RULE: Anything user-facing (file path, section names, tags, sort
 * orders) is defined here and read from settings. Never hardcode these
 * elsewhere in the plugin.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type TasksPlugin from "./main";
import { SORT_ORDER_LABELS } from "@toolbox/task-core";
import type { SortOrder } from "@toolbox/task-core";

// The sort-order vocabulary is owned by task-core (shared with the app). Re-export
// so existing plugin imports of `SortOrder` / `SORT_ORDER_LABELS` from settings
// keep working without every call site learning about the new package.
export type { SortOrder } from "@toolbox/task-core";
export { SORT_ORDER_LABELS };

/** One subscribed calendar feed. */
export interface CalendarSource {
	/** Stable id (unused for now, but keeps React-free list edits unambiguous). */
	id: string;
	/** User-facing label for the calendar. */
	title: string;
	/** iCalendar subscription URL (https or webcal). */
	url: string;
}

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

/** One user-defined organisation for timesheet tracking. */
export interface TimesheetOrg {
	id: string;
	name: string;
	colour: string;
	/** Hourly rate in dollars (0 = unpaid). */
	rate: number;
	/** Client name for invoicing (defaults to org name). */
	clientName: string;
	/** Client address for invoicing. */
	clientAddress: string;
	/** Invoice number prefix, e.g. "INV". */
	invoicePrefix: string;
	/** Starting invoice number (1 = first invoice). */
	invoiceStartNumber: number;
	/** Date of the last invoice generated (ISO YYYY-MM-DD), for default date range. */
	lastInvoiceDate: string | null;
	/** Last invoice number used (for auto-increment). */
	lastInvoiceNumber: number | null;
}

/** Global invoice settings. */
export interface InvoiceSettings {
	/** Your business name. */
	businessName: string;
	/** Australian Business Number. */
	abn: string;
	/** Your business address. */
	businessAddress: string;
	/** Bank name. */
	bankName: string;
	/** BSB (e.g. 123-456). */
	bsb: string;
	/** Account number. */
	accountNumber: string;
	/** Folder where invoice markdown files are saved, relative to vault root. */
	invoiceFolder: string;
}

/**
 * Persisted running-timer state so it survives Obsidian restarts.
 * `null` means no timer is active.
 */
export interface ActiveTimer {
	org: string;
	/** Epoch ms when work started. */
	startTime: number;
	/** Epoch ms when the current break started, or null if not on break. */
	breakStart: number | null;
	/** Completed breaks in this session (each fully resolved with end times). */
	breaks: { start: number; end: number }[];
}

/**
 * Persisted Pomodoro state so the focus timer survives re-renders and restarts.
 * `null` means the timer has never been started (treated as an idle focus phase).
 */
export interface PomodoroState {
	phase: "work" | "short" | "long";
	running: boolean;
	/** Epoch ms when the current phase ends (only meaningful while running). */
	endsAt: number | null;
	/** Ms left when paused (only meaningful while not running). */
	remaining: number;
	/** Completed focus sessions in the current cycle (drives long-break cadence). */
	completed: number;
	/** Description of the task being focused on, or null. */
	taskKey: string | null;
	/** Epoch ms when the current focus accrual began (work + running), else null. */
	focusStart: number | null;
}

/** Default colours assigned to new orgs, cycling through the list. */
export const TIMESHEET_ORG_COLORS = [
	"#6366f1", // indigo
	"#0ea5e9", // sky
	"#14b8a6", // teal
	"#f59e0b", // amber
	"#ec4899", // pink
	"#8b5cf6", // violet
	"#84cc16", // lime
	"#06b6d4", // cyan
];

export interface TasksPluginSettings {
	/** Path to the markdown file used as the task store. */
	tasksFilePath: string;
	sections: SectionConfig[];
	/** Tracked automatically — most recently used tag first. */
	recentTags: string[];
	/** Persisted collapse state keyed by section id (and the completed key). */
	collapseState: Record<string, boolean>;
	/**
	 * Deprecated: legacy single/newline-separated .ics URL field. Migrated into
	 * `calendars` on load and no longer read directly. Kept so old data parses.
	 */
	icsUrl: string;
	/** Subscribed calendar feeds shown in the "Today" panel. */
	calendars: CalendarSource[];
	/** Editable Columns feature: render `%% columns %%` blocks in Live Preview. */
	editableColumnsEnabled: boolean;

	/** Path to the markdown file used as the timesheet store. */
	timesheetFilePath: string;
	/** User-defined organisations for timesheet tracking. */
	timesheetOrgs: TimesheetOrg[];
	/** Persisted running-timer state (null = no active timer). */
	activeTimer: ActiveTimer | null;

	/** Invoice generation settings. */
	invoice: InvoiceSettings;

	/** Pomodoro focus timer (shown at the top of the tasks panel). */
	pomodoroEnabled: boolean;
	pomodoroWorkMin: number;
	pomodoroShortMin: number;
	pomodoroLongMin: number;
	/** Take a long break after this many focus sessions. */
	pomodoroLongEvery: number;
	/** Persisted Pomodoro state (null = never started). */
	pomodoro: PomodoroState | null;
	/** Accumulated focus seconds per task, keyed by task description. */
	taskFocusSeconds: Record<string, number>;
}

/** Persistence key for the always-present Completed section. */
export const COMPLETED_KEY = "__completed__";

export const DEFAULT_SETTINGS: TasksPluginSettings = {
	tasksFilePath: "tasks.md",
	sections: [],
	recentTags: [],
	collapseState: {},
	icsUrl: "",
	calendars: [],
	editableColumnsEnabled: true,
	timesheetFilePath: "timesheet.md",
	timesheetOrgs: [],
	activeTimer: null,
	invoice: {
		businessName: "",
		abn: "",
		businessAddress: "",
		bankName: "",
		bsb: "",
		accountNumber: "",
		invoiceFolder: "toolbox/Invoices",
	},
	pomodoroEnabled: true,
	pomodoroWorkMin: 25,
	pomodoroShortMin: 5,
	pomodoroLongMin: 15,
	pomodoroLongEvery: 4,
	pomodoro: null,
	taskFocusSeconds: {},
};

/** Generate a reasonably unique id for a new section. */
export function newSectionId(): string {
	return "sec-" + Math.random().toString(36).slice(2, 9);
}

/** Generate a reasonably unique id for a new calendar source. */
export function newCalendarId(): string {
	return "cal-" + Math.random().toString(36).slice(2, 9);
}

/** Generate a reasonably unique id for a new timesheet org. */
export function newOrgId(): string {
	return "org-" + Math.random().toString(36).slice(2, 9);
}

/**
 * One-time migration of the legacy newline-separated `icsUrl` into `calendars`.
 * Mutates and returns whether anything changed (so the caller can persist).
 */
export function migrateCalendars(settings: TasksPluginSettings): boolean {
	if (settings.calendars.length > 0 || !settings.icsUrl.trim()) return false;
	settings.calendars = settings.icsUrl
		.split("\n")
		.map((u) => u.trim())
		.filter((u) => u.length > 0)
		.map((url, i) => ({ id: newCalendarId(), title: `Calendar ${i + 1}`, url }));
	settings.icsUrl = "";
	return settings.calendars.length > 0;
}

export class TasksSettingTab extends PluginSettingTab {
	plugin: TasksPlugin;
	/** Debounce timers for per-calendar sync checks, keyed by calendar id. */
	private syncTimers: Record<string, number> = {};

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

		containerEl.createEl("h3", { text: "Calendars" });
		containerEl.createEl("p", {
			text: "Subscribe to one or more iCalendar feeds. Today's events from all of them are merged above your tasks. For a Google calendar use its 'Secret address in iCal format'.",
			cls: "setting-item-description",
		});

		this.plugin.settings.calendars.forEach((cal, index) => {
			this.renderCalendarSetting(containerEl, cal, index);
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add calendar")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.calendars.push({
						id: newCalendarId(),
						title: "New calendar",
						url: "",
					});
					await this.plugin.saveSettings();
					this.display();
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

		containerEl.createEl("h2", { text: "Editable Columns" });
		new Setting(containerEl)
			.setName("Enable Editable Columns")
			.setDesc(
				"Render %% columns %% blocks as a multi-column layout in Live Preview, with click-to-edit embeds. See documentation/editable-columns.md for the syntax."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.editableColumnsEnabled).onChange(async (value) => {
					this.plugin.settings.editableColumnsEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.applyEditableColumns();
				})
			);

		containerEl.createEl("h2", { text: "Pomodoro" });

		new Setting(containerEl)
			.setName("Enable Pomodoro timer")
			.setDesc("Show a focus timer at the top of the tasks panel.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.pomodoroEnabled).onChange(async (value) => {
					this.plugin.settings.pomodoroEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
			);

		const pomoNumber = (
			name: string,
			desc: string,
			get: () => number,
			set: (n: number) => void,
		): void => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.min = "1";
					text.setValue(String(get())).onChange(async (value) => {
						set(Math.max(1, parseInt(value, 10) || get()));
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					});
				});
		};

		pomoNumber(
			"Focus length (min)",
			"How long each focus session runs.",
			() => this.plugin.settings.pomodoroWorkMin,
			(n) => (this.plugin.settings.pomodoroWorkMin = n),
		);
		pomoNumber(
			"Short break (min)",
			"Break after a focus session.",
			() => this.plugin.settings.pomodoroShortMin,
			(n) => (this.plugin.settings.pomodoroShortMin = n),
		);
		pomoNumber(
			"Long break (min)",
			"Break after a full set of focus sessions.",
			() => this.plugin.settings.pomodoroLongMin,
			(n) => (this.plugin.settings.pomodoroLongMin = n),
		);
		pomoNumber(
			"Long break after",
			"Number of focus sessions before a long break.",
			() => this.plugin.settings.pomodoroLongEvery,
			(n) => (this.plugin.settings.pomodoroLongEvery = n),
		);

		containerEl.createEl("h2", { text: "Timesheet" });

		new Setting(containerEl)
			.setName("Timesheet file path")
			.setDesc("Path to the markdown file used as the timesheet store (relative to the vault root).")
			.addText((text) =>
				text
					.setPlaceholder("timesheet.md")
					.setValue(this.plugin.settings.timesheetFilePath)
					.onChange(async (value) => {
						this.plugin.settings.timesheetFilePath = value.trim() || "timesheet.md";
						await this.plugin.saveSettings();
						this.plugin.refreshTimesheetViews();
					})
			);

		containerEl.createEl("h3", { text: "Organisations" });
		containerEl.createEl("p", {
			text: "Add the organisations you work for. Each one gets a colour and an optional hourly rate for earnings tracking.",
			cls: "setting-item-description",
		});

		this.plugin.settings.timesheetOrgs.forEach((org, index) => {
			this.renderOrgSetting(containerEl, org, index);
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add organisation")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.timesheetOrgs.push({
						id: newOrgId(),
						name: "New organisation",
						colour: TIMESHEET_ORG_COLORS[
							this.plugin.settings.timesheetOrgs.length % TIMESHEET_ORG_COLORS.length
						],
						rate: 0,
						clientName: "",
						clientAddress: "",
						invoicePrefix: "INV",
						invoiceStartNumber: 1,
						lastInvoiceDate: null,
						lastInvoiceNumber: null,
					});
					await this.plugin.saveSettings();
					this.plugin.refreshTimesheetViews();
					this.display();
				})
		);

		// ── Invoice settings ──────────────────────────────────────────
		containerEl.createEl("h2", { text: "Invoice" });

		new Setting(containerEl)
			.setName("Your business name")
			.addText((text) =>
				text.setValue(this.plugin.settings.invoice.businessName).onChange(async (value) => {
					this.plugin.settings.invoice.businessName = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("ABN")
			.addText((text) =>
				text.setValue(this.plugin.settings.invoice.abn).onChange(async (value) => {
					this.plugin.settings.invoice.abn = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Business address")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.invoice.businessAddress).onChange(async (value) => {
					this.plugin.settings.invoice.businessAddress = value;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h3", { text: "Bank details" });

		new Setting(containerEl)
			.setName("Bank name")
			.addText((text) =>
				text.setValue(this.plugin.settings.invoice.bankName).onChange(async (value) => {
					this.plugin.settings.invoice.bankName = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("BSB")
			.addText((text) =>
				text.setValue(this.plugin.settings.invoice.bsb).onChange(async (value) => {
					this.plugin.settings.invoice.bsb = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Account number")
			.addText((text) =>
				text.setValue(this.plugin.settings.invoice.accountNumber).onChange(async (value) => {
					this.plugin.settings.invoice.accountNumber = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Invoice output folder")
			.setDesc("Folder where generated invoice markdown files are saved, relative to vault root.")
			.addText((text) =>
				text
					.setPlaceholder("toolbox/Invoices")
					.setValue(this.plugin.settings.invoice.invoiceFolder)
					.onChange(async (value) => {
						this.plugin.settings.invoice.invoiceFolder = value.trim() || "toolbox/Invoices";
						await this.plugin.saveSettings();
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

	private renderCalendarSetting(containerEl: HTMLElement, cal: CalendarSource, index: number): void {
		const wrapper = containerEl.createDiv({ cls: "tasks-section-setting" });

		new Setting(wrapper).setName(`Calendar ${index + 1}`).addExtraButton((btn) =>
			btn
				.setIcon("trash-2")
				.setTooltip("Delete calendar")
				.onClick(async () => {
					this.plugin.settings.calendars.splice(index, 1);
					await this.plugin.saveSettings();
					this.plugin.fetchCalendar();
					this.display();
				})
		);

		new Setting(wrapper).setName("Title").addText((text) =>
			text
				.setPlaceholder("My calendar")
				.setValue(cal.title)
				.onChange(async (value) => {
					cal.title = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
		);

		// Declared before the URL field so its onChange closure can update it.
		let statusEl: HTMLElement;

		new Setting(wrapper)
			.setName("iCal URL")
			.setDesc("https or webcal — e.g. a Google 'Secret address in iCal format'.")
			.addText((text) =>
				text
					.setPlaceholder("https://…/basic.ics")
					.setValue(cal.url)
					.onChange(async (value) => {
						cal.url = value.trim();
						await this.plugin.saveSettings();
						this.plugin.fetchCalendar();
						this.scheduleSync(cal, statusEl);
					})
			);

		statusEl = wrapper.createDiv({ cls: "tasks-cal-status" });
		this.syncCalendar(cal, statusEl);
	}

	/** Debounce a per-calendar sync check while the user is typing a URL. */
	private scheduleSync(cal: CalendarSource, el: HTMLElement): void {
		window.clearTimeout(this.syncTimers[cal.id]);
		el.setText("Syncing…");
		el.className = "tasks-cal-status is-syncing";
		this.syncTimers[cal.id] = window.setTimeout(() => this.syncCalendar(cal, el), 500);
	}

	/** Fetch one calendar and report success / failure inline. */
	private async syncCalendar(cal: CalendarSource, el: HTMLElement): Promise<void> {
		if (!cal.url.trim()) {
			el.setText("No URL set");
			el.className = "tasks-cal-status is-idle";
			return;
		}
		el.setText("Syncing…");
		el.className = "tasks-cal-status is-syncing";
		const res = await this.plugin.fetchOneCalendar(cal.url);
		if (res.ok) {
			el.setText(`✓ Synced — ${res.count} event${res.count === 1 ? "" : "s"} today`);
			el.className = "tasks-cal-status is-ok";
		} else {
			el.setText("✗ Couldn't load — check the URL");
			el.className = "tasks-cal-status is-error";
		}
	}

	private renderOrgSetting(containerEl: HTMLElement, org: TimesheetOrg, index: number): void {
		const wrapper = containerEl.createDiv({ cls: "tasks-section-setting" });

		new Setting(wrapper)
			.setName(`Organisation ${index + 1}`)
			.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Delete organisation")
					.onClick(async () => {
						this.plugin.settings.timesheetOrgs.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.refreshTimesheetViews();
						this.display();
					})
			);

		new Setting(wrapper).setName("Name").addText((text) =>
			text.setValue(org.name).onChange(async (value) => {
				org.name = value;
				await this.plugin.saveSettings();
				this.plugin.refreshTimesheetViews();
			})
		);

		new Setting(wrapper).setName("Colour").addText((text) => {
			text.setValue(org.colour).onChange(async (value) => {
				org.colour = value;
				await this.plugin.saveSettings();
				this.plugin.refreshTimesheetViews();
			});
			text.inputEl.type = "color";
		});

		new Setting(wrapper)
			.setName("Hourly rate ($)")
			.setDesc("Hourly rate in dollars. Used to calculate estimated earnings.")
			.addText((text) =>
				text.setValue(String(org.rate || 0)).onChange(async (value) => {
					org.rate = parseFloat(value) || 0;
					await this.plugin.saveSettings();
					this.plugin.refreshTimesheetViews();
				})
			);

		wrapper.createEl("h4", { text: "Invoicing" });

		new Setting(wrapper).setName("Client name").addText((text) =>
			text.setValue(org.clientName || org.name).onChange(async (value) => {
				org.clientName = value;
				await this.plugin.saveSettings();
			})
		);

		new Setting(wrapper).setName("Client address").addTextArea((text) =>
			text.setValue(org.clientAddress).onChange(async (value) => {
				org.clientAddress = value;
				await this.plugin.saveSettings();
			})
		);

		new Setting(wrapper)
			.setName("Invoice prefix")
			.setDesc("e.g. INV → INV-001, INV-002")
			.addText((text) =>
				text.setValue(org.invoicePrefix || "INV").onChange(async (value) => {
					org.invoicePrefix = value.trim() || "INV";
					await this.plugin.saveSettings();
				})
			);

		new Setting(wrapper)
			.setName("Starting invoice number")
			.setDesc("The first invoice number for this org (1 = start from INV-001).")
			.addText((text) =>
				text.setValue(String(org.invoiceStartNumber || 1)).onChange(async (value) => {
					org.invoiceStartNumber = Math.max(1, parseInt(value) || 1);
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
