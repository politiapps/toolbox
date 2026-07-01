/**
 * timesheetView.ts — The sidebar ItemView for time tracking.
 *
 * Features:
 *  - Running timer with start/break/resume/stop
 *  - Today's entries list with inline edit/delete
 *  - Weekly summary per org (hours, days, earnings)
 *  - Manual add entry via modal
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
	parseTimesheet,
	serializeEntry,
	addEntryToContent,
	updateEntryLines,
	entryWorkMinutes,
	timeToMinutes,
	formatMinutes,
	minutesToDays,
	TimesheetEntry,
} from "./timesheetParser";
import { TimesheetOrg, ActiveTimer } from "./settings";
import { InvoiceModal } from "./invoiceModal";

export const VIEW_TYPE_TIMESHEET = "timesheet-view";

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

function todayISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function formatDateISO(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function ordinalSuffix(n: number): string {
	const v = n % 100;
	if (v >= 11 && v <= 13) return "th";
	switch (n % 10) {
		case 1: return "st";
		case 2: return "nd";
		case 3: return "rd";
		default: return "th";
	}
}

function formatDayDisplay(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
	return `${weekday} ${d}${ordinalSuffix(d)}`;
}

/** Relative day label: Today / Yesterday / Tomorrow, else the weekday name. */
function dayTitle(iso: string): string {
	const [ty, tm, td] = todayISO().split("-").map(Number);
	const [y, m, d] = iso.split("-").map(Number);
	const diff = Math.round(
		(new Date(y, m - 1, d).getTime() - new Date(ty, tm - 1, td).getTime()) / 86_400_000,
	);
	if (diff === 0) return "Today";
	if (diff === -1) return "Yesterday";
	if (diff === 1) return "Tomorrow";
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long" });
}

/** Compact full day label that stays unambiguous across months, e.g. "Wed 1 Jul". */
function formatDayFull(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
	const month = date.toLocaleDateString(undefined, { month: "short" });
	return `${weekday} ${d} ${month}`;
}

function getWeekBounds(): { start: Date; end: Date } {
	const now = new Date();
	const day = now.getDay();
	const diffToMon = day === 0 ? 6 : day - 1;
	const monday = new Date(now);
	monday.setDate(now.getDate() - diffToMon);
	monday.setHours(0, 0, 0, 0);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	sunday.setHours(23, 59, 59, 999);
	return { start: monday, end: sunday };
}

function isInWeek(iso: string, weekStart: Date, weekEnd: Date): boolean {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	return date >= weekStart && date <= weekEnd;
}

/** Format elapsed ms as HH:MM:SS. */
function formatElapsed(ms: number): string {
	if (ms < 0) ms = 0;
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const min = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getTimerWorkMs(timer: ActiveTimer): number {
	const now = Date.now();
	const totalElapsed = now - timer.startTime;
	let breakMs = 0;
	for (const b of timer.breaks) {
		breakMs += b.end - b.start;
	}
	if (timer.breakStart !== null) {
		breakMs += now - timer.breakStart;
	}
	return Math.max(0, totalElapsed - breakMs);
}

function getTimerBreakMs(timer: ActiveTimer): number {
	if (timer.breakStart === null) return 0;
	return Date.now() - timer.breakStart;
}

/* ------------------------------------------------------------------ */
/* The sidebar view                                                    */
/* ------------------------------------------------------------------ */

export class TimesheetView extends ItemView {
	plugin: TasksPlugin;
	private timerInterval: number | null = null;
	private timerSectionEl: HTMLElement | null = null;
	/** The day whose entries the panel is showing (ISO); defaults to today. */
	private viewedDate: string = todayISO();

	constructor(leaf: WorkspaceLeaf, plugin: TasksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TIMESHEET;
	}

	getDisplayText(): string {
		return "Timesheet";
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("timesheet-panel");
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.stopTimerTick();
	}

	/* ----------------------------- file IO ----------------------------- */

	private getTimesheetFile(): TFile | null {
		const path = this.plugin.settings.timesheetFilePath;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private async ensureTimesheetFile(): Promise<TFile> {
		const existing = this.getTimesheetFile();
		if (existing) return existing;
		return this.app.vault.create(this.plugin.settings.timesheetFilePath, "");
	}

	/* ---------------------------- rendering ---------------------------- */

	async refresh(): Promise<void> {
		const file = this.getTimesheetFile();
		const content = file ? await this.app.vault.read(file) : "";
		const parsed = parseTimesheet(content);

		const root = this.contentEl;
		root.empty();
		root.addClass("timesheet-panel-content");

		this.renderHeader(root);
		this.renderTimer(root);
		this.renderDayEntries(root, parsed);
		this.renderWeekSummary(root, parsed);

		// Start timer tick if timer is active
		if (this.plugin.settings.activeTimer) {
			this.startTimerTick();
		}
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "timesheet-header" });
		header.createDiv({ cls: "timesheet-header-title", text: "Timesheet" });

		const addBtn = header.createEl("button", { cls: "timesheet-add-btn" });
		setIcon(addBtn, "plus");
		addBtn.setAttr("aria-label", "Add entry");
		addBtn.addEventListener("click", () => this.openAddForm());

		const invoiceBtn = header.createEl("button", { cls: "timesheet-add-btn" });
		setIcon(invoiceBtn, "file-text");
		invoiceBtn.setAttr("aria-label", "Generate invoice");
		invoiceBtn.addEventListener("click", () => {
			new InvoiceModal(this.app, this.plugin).open();
		});
	}

	private renderTimer(root: HTMLElement): void {
		const timer = root.createDiv({ cls: "timesheet-timer" });
		this.timerSectionEl = timer;
		this.buildTimer(timer);
	}

	/** Re-render the timer card in place after a state change. */
	private rebuildTimer(): void {
		if (this.timerSectionEl) this.buildTimer(this.timerSectionEl);
	}

	/** Build a labelled, icon-led timer action button. */
	private makeTimerBtn(
		parent: HTMLElement,
		icon: string,
		label: string,
		cls: string,
	): HTMLButtonElement {
		const btn = parent.createEl("button", { cls: `timesheet-timer-btn ${cls}` });
		setIcon(btn.createSpan({ cls: "timesheet-btn-icon" }), icon);
		btn.createSpan({ cls: "timesheet-btn-label", text: label });
		return btn;
	}

	/**
	 * Render the whole timer card into `parent` (clearing it first). This card is
	 * the panel's hero: a live chronograph that tints to the running org's colour
	 * while working and shifts amber on break.
	 */
	private buildTimer(parent: HTMLElement): void {
		parent.empty();
		parent.removeClass("is-active");
		parent.removeClass("is-break");
		parent.style.removeProperty("--org-colour");

		const activeTimer = this.plugin.settings.activeTimer;

		if (this.plugin.settings.timesheetOrgs.length === 0) {
			parent.createDiv({
				cls: "timesheet-timer-empty",
				text: "Add an organisation in settings to start tracking time.",
			});
			return;
		}

		// Org selector — seeds a new timer, or re-tags the running one.
		const orgRow = parent.createDiv({ cls: "timesheet-timer-org" });
		orgRow.createSpan({ cls: "timesheet-eyebrow", text: "Org" });
		const orgSelect = orgRow.createEl("select", { cls: "timesheet-timer-select" });
		for (const org of this.plugin.settings.timesheetOrgs) {
			const opt = orgSelect.createEl("option", { text: org.name, value: org.id });
			if (activeTimer && activeTimer.org === org.name) opt.selected = true;
		}
		if (!activeTimer) orgSelect.selectedIndex = 0;

		if (!activeTimer) {
			const btnRow = parent.createDiv({ cls: "timesheet-timer-buttons" });
			const startBtn = this.makeTimerBtn(btnRow, "play", "Start", "timesheet-btn-start");
			startBtn.addEventListener("click", () => {
				const selectedOrg = orgSelect.options[orgSelect.selectedIndex]?.text ?? "";
				this.startTimer(selectedOrg);
			});
			return;
		}

		// Active — tint the card to the org's colour (amber when on break).
		orgSelect.addEventListener("change", () => this.updateTimerOrg(orgSelect));
		const colour = this.orgColour(activeTimer.org);
		if (colour) parent.style.setProperty("--org-colour", colour);
		parent.addClass("is-active");
		const isOnBreak = activeTimer.breakStart !== null;
		if (isOnBreak) parent.addClass("is-break");

		const live = parent.createDiv({ cls: "timesheet-timer-live" });

		const status = live.createDiv({ cls: "timesheet-timer-status" });
		status.createSpan({ cls: "timesheet-live-dot" });
		status.createSpan({
			cls: "timesheet-status-text",
			text: isOnBreak ? "On break" : "Working",
		});

		const clock = live.createDiv({ cls: "timesheet-timer-clock" });
		clock.textContent = formatElapsed(
			isOnBreak ? getTimerBreakMs(activeTimer) : getTimerWorkMs(activeTimer),
		);

		const meta = live.createDiv({ cls: "timesheet-timer-meta" });

		const startedItem = meta.createDiv({ cls: "timesheet-meta-item" });
		startedItem.createSpan({ cls: "timesheet-eyebrow", text: "Started" });
		const startInput = startedItem.createEl("input", {
			cls: "timesheet-timer-time-input",
			type: "time",
			value: this.msToTime(activeTimer.startTime),
		});
		startInput.addEventListener("change", () => this.updateTimerStartTime(startInput.value));

		if (isOnBreak) {
			const workedItem = meta.createDiv({ cls: "timesheet-meta-item" });
			workedItem.createSpan({ cls: "timesheet-eyebrow", text: "Worked" });
			workedItem.createSpan({
				cls: "timesheet-timer-subvalue",
				text: formatElapsed(getTimerWorkMs(activeTimer)),
			});
		}

		const btnRow = parent.createDiv({ cls: "timesheet-timer-buttons" });
		if (isOnBreak) {
			this.makeTimerBtn(btnRow, "play", "Resume", "timesheet-btn-resume").addEventListener(
				"click",
				() => this.resumeTimer(),
			);
		} else {
			this.makeTimerBtn(btnRow, "coffee", "Break", "timesheet-btn-break").addEventListener(
				"click",
				() => this.breakTimer(),
			);
		}
		this.makeTimerBtn(btnRow, "square", "Stop", "timesheet-btn-stop").addEventListener(
			"click",
			() => this.stopTimer(),
		);
	}

	/** Persist a change to the timer's start time from an HH:MM input. */
	private async updateTimerStartTime(timeStr: string): Promise<void> {
		const timer = this.plugin.settings.activeTimer;
		if (!timer) return;
		const [h, m] = timeStr.split(":").map(Number);
		const d = new Date(timer.startTime);
		d.setHours(h, m, 0, 0);
		timer.startTime = d.getTime();
		await this.plugin.saveSettings();
		this.updateTimerDisplay();
	}

	/** Persist a change to the timer's org from the select element. */
	private async updateTimerOrg(select: HTMLSelectElement): Promise<void> {
		const timer = this.plugin.settings.activeTimer;
		if (!timer) return;
		const name = select.options[select.selectedIndex]?.text ?? "";
		if (name) {
			timer.org = name;
			await this.plugin.saveSettings();
		}
	}

	/** Update the timer display in-place without a full re-render. */
	private updateTimerDisplay(): void {
		const timer = this.timerSectionEl;
		if (!timer) return;

		const activeTimer = this.plugin.settings.activeTimer;
		if (!activeTimer) return;

		const isOnBreak = activeTimer.breakStart !== null;
		const clock = timer.querySelector<HTMLElement>(".timesheet-timer-clock");
		const sub = timer.querySelector<HTMLElement>(".timesheet-timer-subvalue");

		if (clock) {
			clock.textContent = formatElapsed(
				isOnBreak ? getTimerBreakMs(activeTimer) : getTimerWorkMs(activeTimer),
			);
		}
		if (isOnBreak && sub) {
			sub.textContent = formatElapsed(getTimerWorkMs(activeTimer));
		}
	}

	private startTimerTick(): void {
		this.stopTimerTick();
		if (!this.plugin.settings.activeTimer) return;
		this.timerInterval = window.setInterval(() => {
			this.updateTimerDisplay();
		}, 1000);
	}

	private stopTimerTick(): void {
		if (this.timerInterval !== null) {
			window.clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}

	private renderDayEntries(root: HTMLElement, parsed: ReturnType<typeof parseTimesheet>): void {
		const day = this.viewedDate;
		const isToday = day === todayISO();
		const dayEntries = parsed.days.filter((d) => d.date === day).flatMap((d) => d.entries);

		const section = root.createDiv({ cls: "timesheet-section" });
		const header = section.createDiv({ cls: "timesheet-section-header timesheet-day-header" });

		// Day navigation — step back/forward through days so any day is reachable.
		const prevBtn = header.createEl("button", { cls: "timesheet-day-nav" });
		setIcon(prevBtn, "chevron-left");
		prevBtn.setAttr("aria-label", "Previous day");
		prevBtn.addEventListener("click", () => this.shiftDay(-1));

		const titleWrap = header.createDiv({ cls: "timesheet-day-titlewrap" });
		titleWrap.createSpan({ cls: "timesheet-section-title", text: dayTitle(day) });
		titleWrap.createSpan({ cls: "timesheet-section-date", text: formatDayFull(day) });

		const nextBtn = header.createEl("button", { cls: "timesheet-day-nav" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.setAttr("aria-label", "Next day");
		nextBtn.addEventListener("click", () => this.shiftDay(1));

		if (!isToday) {
			const todayBtn = header.createEl("button", { cls: "timesheet-day-today", text: "Today" });
			todayBtn.setAttr("aria-label", "Jump to today");
			todayBtn.addEventListener("click", () => {
				this.viewedDate = todayISO();
				this.refresh();
			});
		}

		if (dayEntries.length === 0) {
			section.createDiv({
				cls: "timesheet-empty",
				text: isToday ? "No entries yet today." : "No entries on this day.",
			});
			return;
		}

		const list = section.createDiv({ cls: "timesheet-entry-list" });
		let dayTotal = 0;
		for (const entry of dayEntries) {
			const mins = entryWorkMinutes(entry);
			dayTotal += mins;
			this.renderEntryRow(list, entry, parsed.lines, mins);
		}

		const totalRow = section.createDiv({ cls: "timesheet-total-row" });
		totalRow.createSpan({ text: "Total" });
		totalRow.createSpan({
			cls: "timesheet-total-value",
			text: `${formatMinutes(dayTotal)} (${minutesToDays(dayTotal)})`,
		});
	}

	/** Move the viewed day by `delta` days and re-render. */
	private shiftDay(delta: number): void {
		const [y, m, d] = this.viewedDate.split("-").map(Number);
		const dt = new Date(y, m - 1, d);
		dt.setDate(dt.getDate() + delta);
		this.viewedDate = formatDateISO(dt);
		this.refresh();
	}

	private renderEntryRow(
		list: HTMLElement,
		entry: TimesheetEntry,
		lines: string[],
		mins: number,
	): void {
		const row = list.createDiv({ cls: "timesheet-entry" });

		const colour = this.orgColour(entry.org);
		if (colour) row.style.setProperty("--org-colour", colour);

		const body = row.createDiv({ cls: "timesheet-entry-body" });

		const main = body.createDiv({ cls: "timesheet-entry-main" });
		main.createSpan({ cls: "timesheet-entry-org", text: entry.org });
		main.createSpan({
			cls: "timesheet-entry-time",
			text: `${entry.start}–${entry.end}`,
		});
		main.createSpan({ cls: "timesheet-entry-hours", text: formatMinutes(mins) });

		if (entry.breaks.length > 0) {
			const breaksEl = body.createDiv({ cls: "timesheet-entry-breaks" });
			for (const b of entry.breaks) {
				const breakDur = timeToMinutes(b.end) - timeToMinutes(b.start);
				breaksEl.createSpan({
					cls: "timesheet-break-line",
					text: `☕ ${b.start}–${b.end} (${formatMinutes(breakDur)})`,
				});
			}
		}

		// Actions
		const actions = row.createDiv({ cls: "timesheet-entry-actions" });

		const editBtn = actions.createEl("button", { cls: "timesheet-icon-btn" });
		setIcon(editBtn, "pencil");
		editBtn.setAttr("aria-label", "Edit entry");
		editBtn.addEventListener("click", () => this.openEditForm(entry, lines));

		const delBtn = actions.createEl("button", { cls: "timesheet-icon-btn timesheet-delete-btn" });
		setIcon(delBtn, "trash-2");
		delBtn.setAttr("aria-label", "Delete entry");
		delBtn.addEventListener("click", () => this.confirmDelete(entry));
	}

	private renderWeekSummary(
		root: HTMLElement,
		parsed: ReturnType<typeof parseTimesheet>,
	): void {
		const { start, end } = getWeekBounds();
		const weekDays = parsed.days.filter((d) => isInWeek(d.date, start, end));
		const weekEntries = weekDays.flatMap((d) => d.entries);

		const section = root.createDiv({ cls: "timesheet-section" });
		const header = section.createDiv({ cls: "timesheet-section-header" });
		header.createSpan({ cls: "timesheet-section-title", text: "This Week" });
		header.createSpan({
			cls: "timesheet-section-date",
			text: `${formatDayDisplay(formatDateISO(start))} – ${formatDayDisplay(formatDateISO(end))}`,
		});

		if (weekEntries.length === 0) {
			section.createDiv({ cls: "timesheet-empty", text: "No entries this week." });
			return;
		}

		// Group by org
		const orgTotals = new Map<string, number>();
		for (const entry of weekEntries) {
			const mins = entryWorkMinutes(entry);
			orgTotals.set(entry.org, (orgTotals.get(entry.org) || 0) + mins);
		}

		const summary = section.createDiv({ cls: "timesheet-week-summary" });

		const weekTotal = [...orgTotals.values()].reduce((a, b) => a + b, 0);

		// Proportion bar — how the week splits across orgs, at a glance. The dots
		// in the rows below are its legend.
		const bar = summary.createDiv({ cls: "timesheet-week-bar" });
		for (const [org, mins] of orgTotals) {
			const seg = bar.createDiv({ cls: "timesheet-week-bar-seg" });
			seg.style.width = weekTotal > 0 ? `${(mins / weekTotal) * 100}%` : "0";
			const segColour = this.orgColour(org);
			if (segColour) seg.style.backgroundColor = segColour;
			seg.setAttr("aria-label", `${org}: ${formatMinutes(mins)}`);
		}

		// Per-org rows
		for (const [org, mins] of orgTotals) {
			const row = summary.createDiv({ cls: "timesheet-week-row" });
			const colour = this.orgColour(org);
			if (colour) row.style.setProperty("--org-colour", colour);

			row.createSpan({ cls: "timesheet-week-dot" });
			row.createSpan({ cls: "timesheet-week-org", text: org });
			row.createSpan({
				cls: "timesheet-week-hours",
				text: `${formatMinutes(mins)}`,
			});
			row.createSpan({
				cls: "timesheet-week-days",
				text: minutesToDays(mins),
			});

			// Earnings
			const orgObj = this.plugin.settings.timesheetOrgs.find((o) => o.name === org);
			if (orgObj && orgObj.rate > 0) {
				const hours = mins / 60;
				const earnings = hours * orgObj.rate;
				row.createSpan({
					cls: "timesheet-week-earnings",
					text: `$${earnings.toFixed(2)}`,
				});
			}
		}

		// Total row
		const totalRow = summary.createDiv({ cls: "timesheet-week-row is-total" });
		totalRow.createSpan({ cls: "timesheet-week-org", text: "Total" });
		totalRow.createSpan({
			cls: "timesheet-week-hours",
			text: formatMinutes(weekTotal),
		});
		totalRow.createSpan({
			cls: "timesheet-week-days",
			text: minutesToDays(weekTotal),
		});

		// Total earnings
		let totalEarnings = 0;
		for (const [org, mins] of orgTotals) {
			const orgObj = this.plugin.settings.timesheetOrgs.find((o) => o.name === org);
			if (orgObj && orgObj.rate > 0) {
				totalEarnings += (mins / 60) * orgObj.rate;
			}
		}
		if (totalEarnings > 0) {
			const earnRow = summary.createDiv({ cls: "timesheet-week-row is-earnings" });
			earnRow.createSpan({ cls: "timesheet-week-org", text: "Earnings" });
			earnRow.createSpan({ cls: "timesheet-week-earnings", text: `$${totalEarnings.toFixed(2)}` });
		}
	}

	/** Look up an org's colour by name, return a hex or null. */
	private orgColour(orgName: string): string | null {
		const org = this.plugin.settings.timesheetOrgs.find((o) => o.name === orgName);
		return org?.colour ?? null;
	}

	/* ------------------------- Timer actions --------------------------- */

	private async startTimer(org: string): Promise<void> {
		if (!org) return;
		this.plugin.settings.activeTimer = {
			org,
			startTime: Date.now(),
			breakStart: null,
			breaks: [],
		};
		await this.plugin.saveSettings();
		// Re-render just the timer section
		this.rebuildTimer();
		this.startTimerTick();
	}

	private async breakTimer(): Promise<void> {
		const timer = this.plugin.settings.activeTimer;
		if (!timer || timer.breakStart !== null) return;
		timer.breakStart = Date.now();
		await this.plugin.saveSettings();
		this.rebuildTimer();
	}

	private async resumeTimer(): Promise<void> {
		const timer = this.plugin.settings.activeTimer;
		if (!timer || timer.breakStart === null) return;
		timer.breaks.push({ start: timer.breakStart, end: Date.now() });
		timer.breakStart = null;
		await this.plugin.saveSettings();
		this.rebuildTimer();
	}

	private async stopTimer(): Promise<void> {
		const timer = this.plugin.settings.activeTimer;
		if (!timer) return;

		// If on break, end the break now
		const breaks: { start: string; end: string }[] = [];
		for (const b of timer.breaks) {
			breaks.push({
				start: this.msToTime(b.start),
				end: this.msToTime(b.end),
			});
		}
		if (timer.breakStart !== null) {
			breaks.push({
				start: this.msToTime(timer.breakStart),
				end: this.msToTime(Date.now()),
			});
		}

		const startTime = this.msToTime(timer.startTime);
		const endTime = this.msToTime(Date.now());

		// Save entry to file
		const today = todayISO();
		const entryLines = serializeEntry({
			start: startTime,
			end: endTime,
			org: timer.org,
			breaks,
		});

		try {
			const file = await this.ensureTimesheetFile();
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const updated = addEntryToContent(lines, today, entryLines);
			await this.app.vault.modify(file, updated.join("\n"));
		} catch (e) {
			new Notice("Couldn't save timesheet entry.");
		}

		// Clear timer
		this.plugin.settings.activeTimer = null;
		await this.plugin.saveSettings();
		this.stopTimerTick();
		await this.refresh();
	}

	/** Convert epoch ms to HH:MM string. */
	private msToTime(ms: number): string {
		const d = new Date(ms);
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}

	/* --------------------------- Add / Edit forms ---------------------- */

	private openAddForm(): void {
		if (this.plugin.settings.timesheetOrgs.length === 0) {
			new Notice("Add an organisation in settings first.");
			return;
		}
		new TimesheetEntryModal(
			this,
			null,
			async (entry) => {
				const entryLines = serializeEntry(entry);
				try {
					const file = await this.ensureTimesheetFile();
					const content = await this.app.vault.read(file);
					const lines = content.split("\n");
					const updated = addEntryToContent(lines, entry.date, entryLines);
					await this.app.vault.modify(file, updated.join("\n"));
					// Follow the entry to the day it landed on.
					this.viewedDate = entry.date;
					await this.refresh();
				} catch (e) {
					new Notice("Couldn't save timesheet entry.");
				}
			},
			this.viewedDate,
		).open();
	}

	private openEditForm(entry: TimesheetEntry, lines: string[]): void {
		new TimesheetEntryModal(
			this,
			{
				date: entry.date,
				start: entry.start,
				end: entry.end,
				org: entry.org,
				breaks: entry.breaks.map((b) => ({ ...b })),
			},
			async (updated) => {
				const newLines = serializeEntry(updated);
				try {
					const file = await this.ensureTimesheetFile();
					const content = await this.app.vault.read(file);
					const parsed = parseTimesheet(content);
					// Find the fresh version of this entry by matching date + lineStart
					const freshEntry = parsed.days
						.filter((d) => d.date === entry.date)
						.flatMap((d) => d.entries)
						.find((e) => e.lineStart === entry.lineStart);
					if (!freshEntry) {
						new Notice("Couldn't locate the entry in the file.");
						return;
					}
					let result: string[];
					if (updated.date === entry.date) {
						result = updateEntryLines(parsed.lines, freshEntry, newLines);
					} else {
						// Date changed — move it: drop from the old day, add to the new.
						const removed = updateEntryLines(parsed.lines, freshEntry, null);
						result = addEntryToContent(removed, updated.date, newLines);
						this.viewedDate = updated.date;
					}
					await this.app.vault.modify(file, result.join("\n"));
					await this.refresh();
				} catch (e) {
					new Notice("Couldn't update timesheet entry.");
				}
			},
		).open();
	}

	private async confirmDelete(entry: TimesheetEntry): Promise<void> {
		try {
			const file = await this.ensureTimesheetFile();
			const content = await this.app.vault.read(file);
			const parsed = parseTimesheet(content);
			const freshEntry = parsed.days
				.filter((d) => d.date === entry.date)
				.flatMap((d) => d.entries)
				.find((e) => e.lineStart === entry.lineStart);
			if (!freshEntry) {
				new Notice("Couldn't locate the entry in the file.");
				return;
			}
			const result = updateEntryLines(parsed.lines, freshEntry, null);
			await this.app.vault.modify(file, result.join("\n"));
			await this.refresh();
		} catch (e) {
			new Notice("Couldn't delete timesheet entry.");
		}
	}
}

/* ------------------------------------------------------------------ */
/* Timesheet entry modal — add or edit a session                       */
/* ------------------------------------------------------------------ */

interface EntryFormData {
	date: string;
	start: string;
	end: string;
	org: string;
	breaks: { start: string; end: string }[];
}

class TimesheetEntryModal extends Modal {
	private view: TimesheetView;
	private initial: EntryFormData | null;
	private onSubmit: (data: EntryFormData) => Promise<void>;

	private date: string;
	private start: string;
	private end: string;
	private org: string;
	private breaks: { start: string; end: string }[];

	constructor(
		view: TimesheetView,
		initial: EntryFormData | null,
		onSubmit: (data: EntryFormData) => Promise<void>,
		defaultDate?: string,
	) {
		super(view.app);
		this.view = view;
		this.initial = initial;
		this.onSubmit = onSubmit;

		if (initial) {
			this.date = initial.date;
			this.start = initial.start;
			this.end = initial.end;
			this.org = initial.org;
			this.breaks = initial.breaks.map((b) => ({ ...b }));
		} else {
			const now = new Date();
			const h = String(now.getHours()).padStart(2, "0");
			const m = String(now.getMinutes()).padStart(2, "0");
			this.date = defaultDate ?? todayISO();
			this.start = `${h}:${m}`;
			// Default end = now + 1h
			const endH = String((now.getHours() + 1) % 24).padStart(2, "0");
			this.end = `${endH}:${m}`;
			this.org = this.view.plugin.settings.timesheetOrgs[0]?.name ?? "";
			this.breaks = [];
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("timesheet-form-modal");
		contentEl.createEl("h3", { text: this.initial ? "Edit entry" : "Add entry" });

		// Org
		new Setting(contentEl).setName("Organisation").addDropdown((dd) => {
			for (const org of this.view.plugin.settings.timesheetOrgs) {
				dd.addOption(org.name, org.name);
			}
			dd.setValue(this.org);
			dd.onChange((v) => (this.org = v));
		});

		// Date
		new Setting(contentEl).setName("Date").addText((text) => {
			text.setValue(this.date);
			text.inputEl.type = "date";
			text.onChange((v) => {
				if (v) this.date = v;
			});
		});

		// Start time
		new Setting(contentEl).setName("Start time").addText((text) => {
			text.setValue(this.start);
			text.inputEl.type = "time";
			text.onChange((v) => (this.start = v));
		});

		// End time
		new Setting(contentEl).setName("End time").addText((text) => {
			text.setValue(this.end);
			text.inputEl.type = "time";
			text.onChange((v) => (this.end = v));
		});

		// Breaks
		contentEl.createEl("div", { cls: "timesheet-form-label", text: "Breaks" });

		const breaksWrap = contentEl.createDiv({ cls: "timesheet-form-breaks" });
		this.renderBreaks(breaksWrap);

		const addBreakBtn = contentEl.createEl("button", {
			cls: "timesheet-form-add-break",
			text: "+ Add break",
		});
		addBreakBtn.addEventListener("click", () => {
			this.breaks.push({ start: "12:00", end: "12:30" });
			this.renderBreaks(breaksWrap);
		});

		const footer = contentEl.createDiv({ cls: "timesheet-form-footer" });
		footer.createEl("button", { cls: "mod-cta", text: this.initial ? "Save" : "Add" })
			.addEventListener("click", () => this.submit());
		footer.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.close());
	}

	private renderBreaks(wrap: HTMLElement): void {
		wrap.empty();
		for (let i = 0; i < this.breaks.length; i++) {
			const b = this.breaks[i];
			const row = wrap.createDiv({ cls: "timesheet-break-row" });

			row.createEl("label", { text: "Start" });
			const startInput = row.createEl("input", { cls: "timesheet-break-input", type: "time", value: b.start });
			startInput.addEventListener("change", () => { this.breaks[i].start = startInput.value; });

			row.createEl("label", { text: "End" });
			const endInput = row.createEl("input", { cls: "timesheet-break-input", type: "time", value: b.end });
			endInput.addEventListener("change", () => { this.breaks[i].end = endInput.value; });

			const delBtn = row.createEl("button", { cls: "timesheet-break-del" });
			setIcon(delBtn, "x");
			delBtn.addEventListener("click", () => {
				this.breaks.splice(i, 1);
				this.renderBreaks(wrap);
			});
		}
	}

	private async submit(): Promise<void> {
		if (!this.start || !this.end) {
			new Notice("Start and end times are required.");
			return;
		}
		if (!this.org) {
			new Notice("Select an organisation.");
			return;
		}
		this.close();
		await this.onSubmit({
			date: this.date,
			start: this.start,
			end: this.end,
			org: this.org,
			breaks: this.breaks.filter((b) => b.start && b.end),
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
