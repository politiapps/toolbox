/**
 * recurrence.ts — Recurrence rule grammar + next-occurrence date math.
 *
 * STRICT RULE: This is the ONLY place the recurrence *rule text* (the words
 * after 🔁) is interpreted or built. `taskParser.ts` owns the 🔁 token's place
 * in the task line and stores the rule as raw text; this module turns that text
 * into a structured rule and computes the next due date. Pure — no vault, no
 * DOM, no network (mirrors calendar.ts).
 *
 * The canonical strings produced here match the official Obsidian Tasks plugin
 * so the same file round-trips through both:
 *   every day | every N days
 *   every week | every N weeks | every <Weekday> | every N weeks on <Weekday>
 *   every month | every N months  (+ optional "on the …")
 *     on the <Nth>            → day-of-month (clamped to the month's length)
 *     on the <ordinal> <Weekday> → the Nth (or last) weekday of the month
 *     on the last             → the last day of the month
 *   every year | every N years
 *
 * Next occurrence is always computed from the task's DUE date, never the
 * completion date (e.g. due the 5th + "every 2 weeks" → the 19th).
 */

/** Weekday index follows JS `Date.getDay()`: 0 = Sunday … 6 = Saturday. */
export const WEEKDAY_LABELS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const WEEKDAYS_LOWER = WEEKDAY_LABELS.map((w) => w.toLowerCase());

/** Structured recurrence rule. */
export interface RecurrenceRule {
	unit: "day" | "week" | "month" | "year";
	/** Repeat every `interval` units (≥ 1). */
	interval: number;
	/** Weekly: the weekday it lands on (0–6), or null for "any". */
	weekday?: number | null;
	/** Monthly by date: 1–31 (clamped to the month's length on recurrence). */
	dayOfMonth?: number | null;
	/** Monthly by position: 1–4, or -1 for "last". Pairs with `weekday`. */
	ordinal?: number | null;
}

/* ------------------------------------------------------------------ */
/* Local date helpers (avoid UTC off-by-one; mirror taskView's)        */
/* ------------------------------------------------------------------ */

function toISO(y: number, mZeroBased: number, d: number): string {
	// Normalise through Date so overflowing days/months roll over correctly.
	const dt = new Date(y, mZeroBased, d);
	const yy = dt.getFullYear();
	const mm = String(dt.getMonth() + 1).padStart(2, "0");
	const dd = String(dt.getDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}

/** Days in a 1-based month (day 0 of the next month). */
function daysInMonth(y: number, month1Based: number): number {
	return new Date(y, month1Based, 0).getDate();
}

/** Date (1-based day) of the Nth (or last, ordinal -1) `weekday` in a month. */
function nthWeekdayOfMonth(y: number, month1Based: number, ordinal: number, weekday: number): number {
	if (ordinal === -1) {
		const last = daysInMonth(y, month1Based);
		const lastDow = new Date(y, month1Based - 1, last).getDay();
		return last - ((lastDow - weekday + 7) % 7);
	}
	const firstDow = new Date(y, month1Based - 1, 1).getDay();
	const offset = (weekday - firstDow + 7) % 7;
	let day = 1 + offset + (ordinal - 1) * 7;
	// Defensive: a 5th weekday that doesn't exist falls back to the last one.
	if (day > daysInMonth(y, month1Based)) day -= 7;
	return day;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** "1st"/"first" → 1, …, "last" → -1; null if unrecognised. */
function parseOrdinal(token: string): number | null {
	switch (token) {
		case "first":
			return 1;
		case "second":
			return 2;
		case "third":
			return 3;
		case "fourth":
			return 4;
		case "last":
			return -1;
	}
	const n = parseInt(token, 10);
	return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Parse recurrence rule text into a structured rule, or null if unrecognised.
 * Tolerant of casing, extra whitespace, and "every 1 day" vs "every day".
 */
export function parseRecurrence(text: string): RecurrenceRule | null {
	const s = text.trim().toLowerCase().replace(/\s+/g, " ");
	if (!s.startsWith("every")) return null;

	let rest = s.slice("every".length).trim();
	if (!rest) return null;

	let interval = 1;
	const numMatch = rest.match(/^(\d+)\s+/);
	if (numMatch) {
		interval = Math.max(1, parseInt(numMatch[1], 10));
		rest = rest.slice(numMatch[0].length);
	}

	const tokens = rest.split(" ").filter((t) => t.length > 0);
	if (tokens.length === 0) return null;
	const head = tokens[0];

	// "every Monday" shorthand → weekly on that weekday.
	const shorthandDow = WEEKDAYS_LOWER.indexOf(head);
	if (shorthandDow >= 0) {
		return { unit: "week", interval, weekday: shorthandDow };
	}

	if (head === "day" || head === "days") {
		return { unit: "day", interval };
	}

	if (head === "week" || head === "weeks") {
		const rule: RecurrenceRule = { unit: "week", interval, weekday: null };
		const onIdx = tokens.indexOf("on");
		if (onIdx >= 0) {
			const w = WEEKDAYS_LOWER.indexOf(tokens[onIdx + 1] ?? "");
			if (w >= 0) rule.weekday = w;
		}
		return rule;
	}

	if (head === "year" || head === "years") {
		return { unit: "year", interval };
	}

	if (head === "month" || head === "months") {
		const rule: RecurrenceRule = { unit: "month", interval };
		const onIdx = tokens.indexOf("on");
		if (onIdx >= 0 && tokens[onIdx + 1] === "the") {
			const a = tokens[onIdx + 2] ?? "";
			const b = tokens[onIdx + 3] ?? "";
			const w = WEEKDAYS_LOWER.indexOf(b);
			if (w >= 0) {
				// "on the 2nd Monday" → positional.
				const ord = parseOrdinal(a);
				if (ord !== null) {
					rule.ordinal = ord;
					rule.weekday = w;
				}
			} else if (a === "last") {
				// "on the last" → last day of the month.
				rule.ordinal = -1;
			} else {
				const dom = parseInt(a, 10);
				if (Number.isFinite(dom) && dom >= 1 && dom <= 31) rule.dayOfMonth = dom;
			}
		}
		return rule;
	}

	return null;
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

function ordinalSuffix(n: number): string {
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

function ordinalNum(n: number): string {
	return `${n}${ordinalSuffix(n)}`;
}

/** Ordinal for positional weekdays: 1–4 as "1st"…"4th", -1 as "last". */
function ordinalWord(ord: number): string {
	return ord === -1 ? "last" : ordinalNum(ord);
}

/** Build the canonical Tasks-compatible rule string from a structured rule. */
export function recurrenceToText(rule: RecurrenceRule): string {
	const many = rule.interval > 1;
	switch (rule.unit) {
		case "day":
			return many ? `every ${rule.interval} days` : "every day";
		case "week":
			if (rule.weekday != null) {
				return many
					? `every ${rule.interval} weeks on ${WEEKDAY_LABELS[rule.weekday]}`
					: `every ${WEEKDAY_LABELS[rule.weekday]}`;
			}
			return many ? `every ${rule.interval} weeks` : "every week";
		case "month": {
			const base = many ? `every ${rule.interval} months` : "every month";
			if (rule.ordinal != null && rule.weekday != null) {
				return `${base} on the ${ordinalWord(rule.ordinal)} ${WEEKDAY_LABELS[rule.weekday]}`;
			}
			if (rule.ordinal === -1 && rule.weekday == null) {
				return `${base} on the last`;
			}
			if (rule.dayOfMonth != null) {
				return `${base} on the ${ordinalNum(rule.dayOfMonth)}`;
			}
			return base;
		}
		case "year":
			return many ? `every ${rule.interval} years` : "every year";
	}
}

/** Short human label for the UI pill (e.g. "Every 2 weeks", "Monthly on the 1st"). */
export function describeRecurrence(rule: RecurrenceRule): string {
	const many = rule.interval > 1;
	switch (rule.unit) {
		case "day":
			return many ? `Every ${rule.interval} days` : "Daily";
		case "week":
			if (rule.weekday != null) {
				return many
					? `Every ${rule.interval} weeks on ${WEEKDAY_LABELS[rule.weekday]}`
					: `Every ${WEEKDAY_LABELS[rule.weekday]}`;
			}
			return many ? `Every ${rule.interval} weeks` : "Weekly";
		case "month": {
			const base = many ? `Every ${rule.interval} months` : "Monthly";
			if (rule.ordinal != null && rule.weekday != null) {
				return `${base} on the ${ordinalWord(rule.ordinal)} ${WEEKDAY_LABELS[rule.weekday]}`;
			}
			if (rule.ordinal === -1 && rule.weekday == null) {
				return `${base} on the last day`;
			}
			if (rule.dayOfMonth != null) {
				return `${base} on the ${ordinalNum(rule.dayOfMonth)}`;
			}
			return base;
		}
		case "year":
			return many ? `Every ${rule.interval} years` : "Yearly";
	}
}

/** Convenience: describe raw rule text, falling back to the text itself. */
export function describeRecurrenceText(text: string): string {
	const rule = parseRecurrence(text);
	return rule ? describeRecurrence(rule) : text;
}

/* ------------------------------------------------------------------ */
/* Next occurrence                                                     */
/* ------------------------------------------------------------------ */

/**
 * The next due date (YYYY-MM-DD) for `rule`, advancing from `currentDueISO`.
 * Always relative to the due date, not the completion date. Day-of-month and
 * Feb-29 overflows clamp to the target month's last valid day.
 */
export function nextDueDate(rule: RecurrenceRule, currentDueISO: string): string {
	const [y, m, d] = currentDueISO.split("-").map((n) => parseInt(n, 10));
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return currentDueISO;

	switch (rule.unit) {
		case "day":
			return toISO(y, m - 1, d + rule.interval);
		case "week":
			return toISO(y, m - 1, d + rule.interval * 7);
		case "month": {
			// Advance whole months first (Date normalises the year roll-over).
			const target = new Date(y, m - 1 + rule.interval, 1);
			const ty = target.getFullYear();
			const tm = target.getMonth() + 1; // 1-based
			let day: number;
			if (rule.ordinal != null && rule.weekday != null) {
				day = nthWeekdayOfMonth(ty, tm, rule.ordinal, rule.weekday);
			} else if (rule.ordinal === -1 && rule.weekday == null) {
				day = daysInMonth(ty, tm);
			} else if (rule.dayOfMonth != null) {
				day = Math.min(rule.dayOfMonth, daysInMonth(ty, tm));
			} else {
				day = Math.min(d, daysInMonth(ty, tm));
			}
			return toISO(ty, tm - 1, day);
		}
		case "year": {
			const ty = y + rule.interval;
			const day = Math.min(d, daysInMonth(ty, m));
			return toISO(ty, m - 1, day);
		}
	}
}
