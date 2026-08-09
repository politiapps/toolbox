/**
 * presentation.ts — How a task's date and priority are *shown*, shared by the
 * Obsidian plugin and the Android app.
 *
 * These are formatting and classification helpers only: they take a date or a
 * priority and return a string or a bucket name. No task syntax is parsed here
 * (that is taskParser.ts's job alone), and nothing touches the DOM, the vault,
 * or the network — so both surfaces can import them.
 *
 * They live in task-core because the two surfaces must agree on the triage
 * language they present. The rules encoded here — relative labels inside a
 * week, the proximity ramp, the five-segment priority meter, the per-section
 * accent hue — are documented in `documentation/ui.md`. Duplicating them per
 * surface is how the plugin and the app drift on what "overdue" looks like.
 */

import { Priority } from "./taskParser";
import { PRIORITY_RANK } from "./sort";

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Today as YYYY-MM-DD in the *local* timezone. */
export function todayISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local date (avoids UTC off-by-one). */
export function parseLocalDate(iso: string): Date {
	const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
	return new Date(y, m - 1, d);
}

export function ordinalSuffix(n: number): string {
	const v = n % 100;
	if (v >= 11 && v <= 13) return "th";
	switch (n % 10) {
		case 1:
			return "st";
		case 2:
			return "nd";
		case 3:
			return "rd";
		default:
			return "th";
	}
}

/** Format a due date as "Thursday 25th" — weekday + day + ordinal, no year. */
export function formatDueDisplay(iso: string): string {
	const d = parseLocalDate(iso);
	const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
	return `${weekday} ${d.getDate()}${ordinalSuffix(d.getDate())}`;
}

/**
 * Abbreviated form ("Thu 25th") for the row's due column. The column is a fixed
 * width so dates line up vertically down the list; a full weekday name would
 * either wrap or eat the description, and the short form still disambiguates.
 * The long form survives in the badge's `aria-label`.
 */
export function formatDueShort(iso: string): string {
	const d = parseLocalDate(iso);
	const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
	return `${weekday} ${d.getDate()}${ordinalSuffix(d.getDate())}`;
}

/** Whole days from today to the given date (negative = past). */
export function daysUntil(iso: string, today: string = todayISO()): number {
	const from = parseLocalDate(today).getTime();
	const due = parseLocalDate(iso).getTime();
	return Math.round((due - from) / 86_400_000);
}

/** `iso` shifted by `days` (negative goes back), as zero-padded YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
	const d = parseLocalDate(iso);
	d.setDate(d.getDate() + days);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/**
 * Human label for a due date. The near term reads relatively ("Today",
 * "3d late") because *how far off* is the triage fact; only once a date is
 * more than a week out does the calendar date itself carry more meaning.
 */
export function dueLabel(iso: string, today: string = todayISO()): string {
	const d = daysUntil(iso, today);
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	if (d === -1) return "Yesterday";
	if (d < -1 && d >= -7) return `${-d}d late`;
	return formatDueShort(iso);
}

/** The proximity buckets driving the due-date colour ramp (sooner = warmer). */
export type DueState = "overdue" | "today" | "tomorrow" | "soon" | "upcoming";

/** Proximity bucket driving the due-date colour ramp (sooner = warmer). */
export function dueState(iso: string, today: string = todayISO()): DueState {
	const d = daysUntil(iso, today);
	if (d < 0) return "overdue";
	if (d === 0) return "today";
	if (d === 1) return "tomorrow";
	if (d === 2) return "soon";
	return "upcoming";
}

/** State class for the due badge itself. */
export function dueClass(iso: string, today: string = todayISO()): string {
	return `is-${dueState(iso, today)}`;
}

/**
 * Whether a due date falls at most `days` from today. Overdue dates always
 * qualify (a negative `daysUntil`), regardless of `days` — "due within a
 * window" never hides work that's already late. Used to build the "Today"
 * (`days = 0`) and "This week" (`days = 6`, a rolling 7-day span) cross-
 * cutting views, so both surfaces filter identically.
 */
export function dueWithin(iso: string, days: number, today: string = todayISO()): boolean {
	return daysUntil(iso, today) <= days;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * The sidebar/app can show every configured section at once, one section
 * alone, or a cross-cutting due-window slice across all of them. A `ViewId`
 * is one of the three special ids below or a `SectionConfig.id`. Shared so
 * the plugin and the app never hand-roll diverging string literals for the
 * special views.
 */
export type ViewId = string;
export const VIEW_ALL = "__all__";
export const VIEW_TODAY = "__today__";
export const VIEW_WEEK = "__week__";

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

/** Segments in the priority meter — the chip encodes level as shape, not only colour. */
export const PRIORITY_SEGMENTS = 5;

/** How many meter segments are lit for a priority (5 = highest … 1 = lowest). */
export function priorityFilled(p: Priority): number {
	// Ranks reserve a slot for `normal`, which never renders a chip — close that
	// gap so the five visible levels map onto the five segments exactly.
	const rank = PRIORITY_RANK[p];
	return PRIORITY_SEGMENTS - (rank > PRIORITY_RANK.normal ? rank - 1 : rank);
}

/* ------------------------------------------------------------------ */
/* Section identity                                                    */
/* ------------------------------------------------------------------ */

/**
 * A small, theme-agnostic accent set. Each section gets a stable hue from its
 * id (so colour follows the lane, not its position) — used only for thin spines
 * and dots, never fills, so it sits quietly over any theme.
 */
export const SECTION_ACCENTS = [
	"#6366f1", // indigo
	"#0ea5e9", // sky
	"#14b8a6", // teal
	"#f59e0b", // amber
	"#ec4899", // pink
	"#8b5cf6", // violet
];

/**
 * The lane's accent colour, hashed from its id. Shared so a section shows the
 * same hue in the sidebar and on the phone — the app mirrors the plugin's
 * section ids from data.json, so the same id must resolve to the same colour.
 */
export function sectionAccent(id: string): string {
	return SECTION_ACCENTS[hash32(id) % SECTION_ACCENTS.length];
}

/** Stable non-cryptographic hash, used for accent hues and collapse keys. */
export function hash32(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/* ------------------------------------------------------------------ */
/* Durations                                                           */
/* ------------------------------------------------------------------ */

/** Format focus seconds compactly: "45s", "25m", "1h 20m". */
export function formatFocus(secs: number): string {
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const rm = mins % 60;
	return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Format remaining milliseconds as MM:SS (rounding up so it starts at NN:00). */
export function formatClock(ms: number): string {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
