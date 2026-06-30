/**
 * timesheetParser.ts — Canonical timesheet parsing and serialisation.
 *
 * STRICT RULE: This is the ONLY place in the plugin where timesheet lines are
 * parsed from or serialised to markdown. No ad hoc parsing anywhere else.
 *
 * Timesheet file format:
 *   ## YYYY-MM-DD
 *
 *   - 🕐 HH:MM–HH:MM (Org Name)
 *     - ☕ HH:MM–HH:MM
 *     - ☕ HH:MM–HH:MM
 *   - 🕐 HH:MM–HH:MM (Org Name)
 */

export interface BreakPeriod {
	start: string; // HH:MM
	end: string; // HH:MM
}

export interface TimesheetEntry {
	lineStart: number;
	lineEnd: number;
	date: string; // YYYY-MM-DD
	start: string; // HH:MM
	end: string; // HH:MM
	org: string;
	breaks: BreakPeriod[];
}

export interface TimesheetDay {
	date: string;
	entries: TimesheetEntry[];
}

export interface ParsedTimesheet {
	days: TimesheetDay[];
	lines: string[];
}

/** Parse HH:MM into total minutes. */
export function timeToMinutes(t: string): number {
	const [h, m] = t.split(":").map(Number);
	return h * 60 + m;
}

/** Format total minutes as "5h 30m". */
export function formatMinutes(mins: number): string {
	if (mins < 0) mins = 0;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/** Format total minutes as fractional days (7h = 1 day), e.g. "1.5d". */
export function minutesToDays(mins: number): string {
	const days = mins / (7 * 60);
	return days.toFixed(1) + "d";
}

/**
 * Parse the full content of a timesheet file into structured data.
 * Lines that don't match known patterns are preserved but not parsed.
 */
export function parseTimesheet(content: string): ParsedTimesheet {
	const lines = content.split("\n");
	const days: TimesheetDay[] = [];
	let currentDay: TimesheetDay | null = null;
	let currentEntry: TimesheetEntry | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const dayMatch = line.match(/^## (\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) {
			currentDay = { date: dayMatch[1], entries: [] };
			days.push(currentDay);
			currentEntry = null;
			continue;
		}

		if (!currentDay) continue;

		const entryMatch = line.match(/^- 🕐 (\d{2}:\d{2})–(\d{2}:\d{2}) \((.+)\)$/);
		if (entryMatch) {
			currentEntry = {
				lineStart: i,
				lineEnd: i + 1,
				date: currentDay.date,
				start: entryMatch[1],
				end: entryMatch[2],
				org: entryMatch[3],
				breaks: [],
			};
			currentDay.entries.push(currentEntry);
			continue;
		}

		const breakMatch = line.match(/^\s+- ☕ (\d{2}:\d{2})–(\d{2}:\d{2})$/);
		if (breakMatch && currentEntry) {
			currentEntry.breaks.push({
				start: breakMatch[1],
				end: breakMatch[2],
			});
			currentEntry.lineEnd = i + 1;
		}
	}

	return { days, lines };
}

/** Compute total work minutes for an entry (session minus breaks). */
export function entryWorkMinutes(entry: TimesheetEntry): number {
	const total = timeToMinutes(entry.end) - timeToMinutes(entry.start);
	const breaks = entry.breaks.reduce(
		(sum, b) => sum + (timeToMinutes(b.end) - timeToMinutes(b.start)),
		0,
	);
	return Math.max(0, total - breaks);
}

/** Build the markdown lines for a single entry (session + breaks). */
export function serializeEntry(
	entry: { start: string; end: string; org: string; breaks: { start: string; end: string }[] },
): string[] {
	const lines: string[] = [];
	lines.push(`- 🕐 ${entry.start}–${entry.end} (${entry.org})`);
	for (const b of entry.breaks) {
		lines.push(`  - ☕ ${b.start}–${b.end}`);
	}
	return lines;
}

/**
 * Insert an entry into the parsed content for a given date.
 * If the day section exists, appends after the last entry in that day.
 * If not, appends a new day section at the end.
 * Returns the modified lines array.
 */
export function addEntryToContent(
	lines: string[],
	date: string,
	entryLines: string[],
): string[] {
	// Find the day header index (search backwards so we find the last match)
	let dayIdx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i] === `## ${date}`) {
			dayIdx = i;
			break;
		}
	}

	if (dayIdx === -1) {
		// No existing day — append at the end
		const result = [...lines];
		// Strip trailing empty lines
		while (result.length > 0 && result[result.length - 1] === "") {
			result.pop();
		}
		if (result.length > 0) result.push("");
		result.push(`## ${date}`);
		result.push("");
		result.push(...entryLines);
		result.push("");
		return result;
	}

	// Find the end of this day section (next ## or end of file)
	let sectionEnd = dayIdx + 1;
	while (sectionEnd < lines.length && !lines[sectionEnd].startsWith("## ")) {
		sectionEnd++;
	}

	// Insert entry lines before the blank line(s) at section end, or at section end
	const result = [...lines];
	const insertAt = sectionEnd;
	result.splice(insertAt, 0, ...entryLines);
	return result;
}

/**
 * Update or remove an entry. Pass `null` for newLines to delete it.
 * Returns the modified lines array.
 */
export function updateEntryLines(
	lines: string[],
	entry: TimesheetEntry,
	newLines: string[] | null,
): string[] {
	const result = [...lines];
	if (newLines === null) {
		result.splice(entry.lineStart, entry.lineEnd - entry.lineStart);
	} else {
		result.splice(entry.lineStart, entry.lineEnd - entry.lineStart, ...newLines);
	}
	return result;
}
