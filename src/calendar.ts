/**
 * calendar.ts — Minimal iCalendar (.ics) parsing for "what's on today".
 *
 * Scope is deliberately narrow: enough to surface today's events from a typical
 * Google/Outlook/Apple subscription feed. It handles line unfolding, timed and
 * all-day events, UTC and floating/TZID times (TZID is treated as wall-clock —
 * see limitations), EXDATE, and common recurrence (DAILY / WEEKLY+BYDAY /
 * MONTHLY / YEARLY with INTERVAL, UNTIL, COUNT). It does not implement the full
 * RFC 5545 recurrence grammar.
 *
 * This module never touches the vault or task files — it is pure parsing.
 */

export interface CalendarOccurrence {
	summary: string;
	/** Local start time, or null for all-day events. */
	start: Date | null;
	allDay: boolean;
}

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface RRule {
	freq: Freq;
	interval: number;
	/** BYDAY entries: weekday 0=Sun…6=Sat, with an optional monthly ordinal
	 *  (1 = first, -1 = last). Ordinal is null for plain weekdays (e.g. WEEKLY). */
	byDay?: { day: number; ordinal: number | null }[];
	until?: Date;
	count?: number;
}

interface RawEvent {
	summary: string;
	start: Date;
	end: Date | null;
	allDay: boolean;
	rrule?: RRule;
	exDates: Set<string>; // local YYYY-M-D keys
}

const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY_MS = 86_400_000;

/** Convenience: parse a feed and return today's occurrences, sorted. */
export function getEventsForToday(ics: string): CalendarOccurrence[] {
	return eventsOnDay(parseICS(ics), new Date());
}

/** Stable ordering for today's occurrences: all-day first, then by start time. */
function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	if (a.start && b.start) return a.start.getTime() - b.start.getTime();
	return 0;
}

/** Identity used to de-duplicate the same event appearing across feeds. */
function occurrenceKey(o: CalendarOccurrence): string {
	return `${o.allDay ? "A" : "T"}|${o.start ? o.start.getTime() : 0}|${o.summary}`;
}

/**
 * Merge today's occurrences from several feeds into one sorted list, dropping
 * duplicates (the same event often appears in more than one shared calendar).
 */
export function mergeOccurrences(lists: CalendarOccurrence[][]): CalendarOccurrence[] {
	const seen = new Set<string>();
	const out: CalendarOccurrence[] = [];
	for (const list of lists) {
		for (const occ of list) {
			const key = occurrenceKey(occ);
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(occ);
		}
	}
	out.sort(compareOccurrences);
	return out;
}

/** Unfold RFC 5545 continuation lines (leading space/tab continues prior line). */
function unfold(ics: string): string[] {
	const out: string[] = [];
	for (const line of ics.split(/\r?\n/)) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
	const idx = line.indexOf(":");
	if (idx === -1) return null;
	const segs = line.slice(0, idx).split(";");
	const params: Record<string, string> = {};
	for (let i = 1; i < segs.length; i++) {
		const eq = segs[i].indexOf("=");
		if (eq !== -1) params[segs[i].slice(0, eq).toUpperCase()] = segs[i].slice(eq + 1).toUpperCase();
	}
	return { name: segs[0].toUpperCase(), params, value: line.slice(idx + 1) };
}

function unescapeText(v: string): string {
	return v
		.replace(/\\n/gi, " ")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\")
		.trim();
}

function parseDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } {
	if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
		const y = +value.slice(0, 4),
			mo = +value.slice(4, 6),
			d = +value.slice(6, 8);
		return { date: new Date(y, mo - 1, d), allDay: true };
	}
	const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
	if (!m) return { date: new Date(value), allDay: false };
	const [, y, mo, d, h, mi, s, z] = m;
	if (z === "Z") return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
	return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
}

function parseRRule(value: string): RRule | undefined {
	const parts: Record<string, string> = {};
	for (const kv of value.split(";")) {
		const eq = kv.indexOf("=");
		if (eq !== -1) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
	}
	const freq = parts.FREQ as Freq;
	if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return undefined;
	const rule: RRule = { freq, interval: parts.INTERVAL ? +parts.INTERVAL : 1 };
	if (parts.BYDAY) {
		rule.byDay = parts.BYDAY.split(",")
			.map((tok) => {
				const m = tok.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
				if (!m) return null;
				return { day: WEEKDAY[m[2]], ordinal: m[1] ? parseInt(m[1], 10) : null };
			})
			.filter((x): x is { day: number; ordinal: number | null } => x !== null);
	}
	if (parts.COUNT) rule.count = +parts.COUNT;
	if (parts.UNTIL) rule.until = parseDate(parts.UNTIL, {}).date;
	return rule;
}

export function parseICS(ics: string): RawEvent[] {
	const events: RawEvent[] = [];
	let cur: Partial<RawEvent> | null = null;

	for (const line of unfold(ics)) {
		if (line === "BEGIN:VEVENT") {
			cur = { exDates: new Set() };
			continue;
		}
		if (line === "END:VEVENT") {
			if (cur && cur.start) {
				events.push({
					summary: cur.summary || "(no title)",
					start: cur.start,
					end: cur.end ?? null,
					allDay: cur.allDay ?? false,
					rrule: cur.rrule,
					exDates: cur.exDates ?? new Set(),
				});
			}
			cur = null;
			continue;
		}
		if (!cur) continue;

		const p = splitLine(line);
		if (!p) continue;
		switch (p.name) {
			case "DTSTART": {
				const { date, allDay } = parseDate(p.value, p.params);
				cur.start = date;
				cur.allDay = allDay;
				break;
			}
			case "DTEND":
				cur.end = parseDate(p.value, p.params).date;
				break;
			case "SUMMARY":
				cur.summary = unescapeText(p.value);
				break;
			case "RRULE":
				cur.rrule = parseRRule(p.value);
				break;
			case "EXDATE":
				cur.exDates!.add(dayKey(parseDate(p.value, p.params).date));
				break;
		}
	}
	return events;
}

function dayKey(d: Date): string {
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(from: Date, to: Date): number {
	return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function occursOn(ev: RawEvent, day: Date): boolean {
	if (ev.exDates.has(dayKey(day))) return false;

	if (!ev.rrule) {
		if (ev.allDay && ev.end) {
			// DTEND is exclusive for all-day spans.
			return dayDiff(ev.start, day) >= 0 && dayDiff(day, ev.end) > 0;
		}
		return dayDiff(ev.start, day) === 0;
	}

	const r = ev.rrule;
	const diff = dayDiff(ev.start, day);
	if (diff < 0) return false;
	if (r.until && dayDiff(day, r.until) < 0) return false;

	switch (r.freq) {
		case "DAILY": {
			if (diff % r.interval !== 0) return false;
			if (r.count !== undefined && diff / r.interval >= r.count) return false;
			return true;
		}
		case "WEEKLY": {
			const days = r.byDay && r.byDay.length ? r.byDay.map((b) => b.day) : [ev.start.getDay()];
			if (!days.includes(day.getDay())) return false;
			const weeks = Math.floor(dayDiff(startOfWeek(ev.start), startOfWeek(day)) / 7);
			return weeks % r.interval === 0;
		}
		case "MONTHLY": {
			const months =
				(day.getFullYear() - ev.start.getFullYear()) * 12 + (day.getMonth() - ev.start.getMonth());
			if (months % r.interval !== 0) return false;
			if (r.count !== undefined && months / r.interval >= r.count) return false;
			// BYDAY (e.g. 1TU = first Tuesday) takes precedence over day-of-month.
			if (r.byDay && r.byDay.length) {
				return r.byDay.some((b) => matchesMonthlyByDay(day, b.day, b.ordinal));
			}
			return day.getDate() === ev.start.getDate();
		}
		case "YEARLY": {
			if (day.getMonth() !== ev.start.getMonth() || day.getDate() !== ev.start.getDate()) return false;
			const years = day.getFullYear() - ev.start.getFullYear();
			if (years % r.interval !== 0) return false;
			if (r.count !== undefined && years / r.interval >= r.count) return false;
			return true;
		}
	}
}

function startOfWeek(d: Date): Date {
	const s = startOfDay(d);
	s.setDate(s.getDate() - s.getDay()); // week starts Sunday
	return s;
}

/**
 * Does `day` fall on the given weekday at the given monthly ordinal?
 * ordinal 1 = first such weekday, 2 = second, -1 = last, etc. A null ordinal
 * matches every occurrence of that weekday in the month.
 */
function matchesMonthlyByDay(day: Date, weekday: number, ordinal: number | null): boolean {
	if (day.getDay() !== weekday) return false;
	if (ordinal === null) return true;
	const year = day.getFullYear();
	const month = day.getMonth();
	const dates: number[] = [];
	const cursor = new Date(year, month, 1);
	while (cursor.getMonth() === month) {
		if (cursor.getDay() === weekday) dates.push(cursor.getDate());
		cursor.setDate(cursor.getDate() + 1);
	}
	const idx = ordinal > 0 ? ordinal - 1 : dates.length + ordinal;
	return dates[idx] === day.getDate();
}

export function eventsOnDay(events: RawEvent[], day: Date): CalendarOccurrence[] {
	const out: CalendarOccurrence[] = [];
	for (const ev of events) {
		if (!occursOn(ev, day)) continue;
		out.push({
			summary: ev.summary,
			allDay: ev.allDay,
			start: ev.allDay
				? null
				: new Date(day.getFullYear(), day.getMonth(), day.getDate(), ev.start.getHours(), ev.start.getMinutes()),
		});
	}
	out.sort(compareOccurrences);
	return out;
}
