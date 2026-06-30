/**
 * calendarView.ts — Shared DOM rendering for the "Today's events" list.
 *
 * Used by both the sidebar panel (taskView.ts) and the `toolbox-calendar`
 * code-block (main.ts) so the two stay visually identical and read from the same
 * cached, merged occurrences. Pure presentation — no vault or network access.
 */

import { setIcon } from "obsidian";
import type { CalendarOccurrence } from "./calendar";

/** Local clock time for a calendar event, e.g. "9:30 AM". */
export function formatEventTime(d: Date): string {
	return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Render today's calendar card into `container`: a header, then either an error,
 * an empty state, or the merged event rows.
 */
export function renderTodayCalendar(
	container: HTMLElement,
	events: CalendarOccurrence[],
	error: string | null
): void {
	const cal = container.createDiv({ cls: "tasks-calendar" });
	const header = cal.createDiv({ cls: "tasks-calendar-header" });
	setIcon(header.createSpan({ cls: "tasks-calendar-icon" }), "calendar");
	header.createSpan({ cls: "tasks-calendar-title", text: "Today's events" });

	if (error) {
		cal.createDiv({ cls: "tasks-calendar-error", text: error });
		return;
	}

	if (events.length === 0) {
		cal.createDiv({ cls: "tasks-empty", text: "Nothing scheduled today" });
		return;
	}

	for (const ev of events) {
		const row = cal.createDiv({ cls: "tasks-event" });
		row.createSpan({
			cls: "tasks-event-time",
			text: ev.allDay || !ev.start ? "All day" : formatEventTime(ev.start),
		});
		row.createSpan({ cls: "tasks-event-title", text: ev.summary });
	}
}
