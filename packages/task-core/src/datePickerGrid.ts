/**
 * datePickerGrid.ts — pure month-grid math for the custom calendar picker.
 *
 * The OS/browser's native `<input type="date">` popup (used everywhere a date
 * is entered, per `taskParser`'s zero-padded-ISO rule) has no CSS hooks for
 * its calendar grid in Chromium, so "today" and past dates can't be made any
 * clearer inside it. Both surfaces build their own calendar popover off this
 * grid instead, so they can't drift on what "this month", "today" or "past"
 * mean. No DOM here — this is date arithmetic only; the plugin and the app
 * each render it with their own DOM helpers.
 *
 * Not named `calendar.ts` — that file already owns .ics feed parsing, an
 * unrelated concern.
 */

import { todayISO } from "./presentation";

/** One day cell in the grid. */
export interface GridDay {
	/** YYYY-MM-DD. */
	iso: string;
	/** Day-of-month number to display (1-31). */
	day: number;
	/** False for the leading/trailing days borrowed from adjacent months. */
	inMonth: boolean;
	isToday: boolean;
	/** Strictly before today — the grid never blocks picking a past date
	 * (due dates and timesheet entries can be legitimately backdated), it
	 * only marks it so the picker can render it quieter. */
	isPast: boolean;
}

/** A Sunday-first month grid, padded to whole weeks. */
export interface MonthGrid {
	year: number;
	month: number; // 1-12
	/** "August 2026", in the runtime's locale. */
	label: string;
	/** Sunday-first weekday initials, in the runtime's locale. */
	weekdayLabels: string[];
	/** 5 or 6 rows of 7 days each. */
	weeks: GridDay[][];
}

/** Jan 1 2023 was a Sunday — used only as a stable reference week for locale weekday labels. */
function weekdayLabels(): string[] {
	const labels: string[] = [];
	for (let i = 0; i < 7; i++) {
		labels.push(new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));
	}
	return labels;
}

/** YYYY-MM-DD for a local `Date`, avoiding UTC off-by-one (mirrors `addDaysISO`). */
function isoOf(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function toGridDay(d: Date, inMonth: boolean, todayIso: string): GridDay {
	const iso = isoOf(d);
	return { iso, day: d.getDate(), inMonth, isToday: iso === todayIso, isPast: iso < todayIso };
}

/** Build a Sunday-first grid for `year`/`month` (1-12), padded with adjacent-month days. */
export function buildMonthGrid(year: number, month: number, todayIso: string = todayISO()): MonthGrid {
	const first = new Date(year, month - 1, 1);
	const startWeekday = first.getDay(); // 0 = Sunday
	const daysInMonth = new Date(year, month, 0).getDate();

	const cells: GridDay[] = [];
	for (let i = startWeekday; i > 0; i--) {
		cells.push(toGridDay(new Date(year, month - 1, 1 - i), false, todayIso));
	}
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push(toGridDay(new Date(year, month - 1, day), true, todayIso));
	}
	let trailing = 1;
	while (cells.length % 7 !== 0) {
		cells.push(toGridDay(new Date(year, month, trailing), false, todayIso));
		trailing++;
	}

	const weeks: GridDay[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

	return {
		year,
		month,
		label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
		weekdayLabels: weekdayLabels(),
		weeks,
	};
}

/** `year`/`month` shifted by `delta` months, handling year rollover either way. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const d = new Date(year, month - 1 + delta, 1);
	return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** The year/month containing `iso`, or the current month when `iso` is null/invalid. */
export function monthOf(iso: string | null): { year: number; month: number } {
	const valid = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayISO();
	const [year, month] = valid.split("-").map((n) => parseInt(n, 10));
	return { year, month };
}
