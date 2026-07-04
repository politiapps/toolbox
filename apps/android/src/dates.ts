/**
 * Presentation date helpers, ported verbatim from the plugin's taskView so the
 * app formats and colours dates identically. No task syntax is parsed here.
 */

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

/** Whole days from today to the given date (negative = past). */
export function daysUntil(iso: string): number {
	const today = parseLocalDate(todayISO()).getTime();
	const due = parseLocalDate(iso).getTime();
	return Math.round((due - today) / 86_400_000);
}

/** Human label for a due date: "Today"/"Tomorrow" for the near term, else date. */
export function dueLabel(iso: string): string {
	const d = daysUntil(iso);
	if (d === 0) return "Today";
	if (d === 1) return "Tomorrow";
	return formatDueDisplay(iso);
}

/** Proximity class driving the due-date colour ramp (sooner = warmer). */
export function dueClass(iso: string): string {
	const d = daysUntil(iso);
	if (d < 0) return "is-overdue";
	if (d === 0) return "is-today";
	if (d === 1) return "is-tomorrow";
	if (d === 2) return "is-soon";
	return "is-upcoming";
}

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
