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

/** Regex for URLs in plain text. Matches http/https links. */
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/** Extract all unique URLs from a string. */
function extractUrls(text: string): string[] {
	const urls = new Set<string>();
	let m;
	while ((m = URL_RE.exec(text)) !== null) {
		urls.add(m[0].replace(/[.,;!?)]+$/, ""));
	}
	return [...urls];
}

/** Strip HTML tags from a string, preserving line breaks. */
function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

/**
 * Render text content with embedded URLs converted to clickable links.
 * Returns a DocumentFragment suitable for appending to any element.
 */
function renderTextWithLinks(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const urls = new Set<string>();
	let m;
	URL_RE.lastIndex = 0;
	while ((m = URL_RE.exec(text)) !== null) {
		urls.add(m[0].replace(/[.,;!?)]+$/, ""));
	}

	let remaining: string | null = text;
	for (const url of urls) {
		const idx = remaining.indexOf(url);
		if (idx === -1) continue;
		if (idx > 0) frag.append(remaining.slice(0, idx));
		const a = document.createElement("a");
		a.href = url;
		a.textContent = url;
		a.className = "tasks-event-link";
		a.setAttr("target", "_blank");
		a.setAttr("rel", "noopener");
		frag.append(a);
		remaining = remaining.slice(idx + url.length);
	}
	if (remaining) frag.append(remaining);
	return frag;
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
		const main = row.createDiv({ cls: "tasks-event-main" });

		const top = main.createDiv({ cls: "tasks-event-top" });
		top.createSpan({
			cls: "tasks-event-time",
			text: ev.allDay || !ev.start ? "All day" : formatEventTime(ev.start),
		});
		top.createSpan({ cls: "tasks-event-title", text: ev.summary });

		// Location
		if (ev.location) {
			const locRow = main.createDiv({ cls: "tasks-event-detail tasks-event-location" });
			setIcon(locRow.createSpan({ cls: "tasks-event-detail-icon" }), "map-pin");
			locRow.createSpan({ cls: "tasks-event-detail-text", text: ev.location });
		}

		// URL from the ICS URL property
		if (ev.url && !ev.location.includes(ev.url) && !ev.description.includes(ev.url)) {
			const urlRow = main.createDiv({ cls: "tasks-event-detail tasks-event-url" });
			setIcon(urlRow.createSpan({ cls: "tasks-event-detail-icon" }), "link");
			const a = urlRow.createEl("a", {
				cls: "tasks-event-link",
				href: ev.url,
				text: ev.url,
			});
			a.setAttr("target", "_blank");
			a.setAttr("rel", "noopener");
		}

		// Description — strip HTML, find links, render as text with clickable URLs
		if (ev.description) {
			const clean = stripHtml(ev.description);
			if (clean) {
				const descRow = main.createDiv({ cls: "tasks-event-detail tasks-event-description" });
				descRow.appendChild(renderTextWithLinks(clean));
			}
		}

		// Scan description and location for meeting links to surface as a "Join" button
		const meetingUrls = new Set<string>();
		for (const u of extractUrls(ev.description)) meetingUrls.add(u);
		for (const u of extractUrls(ev.location)) meetingUrls.add(u);
		if (ev.url) meetingUrls.add(ev.url);

		if (meetingUrls.size > 0) {
			const joinRow = main.createDiv({ cls: "tasks-event-join" });
			for (const mu of meetingUrls) {
				const btn = joinRow.createEl("a", { cls: "tasks-event-join-btn", href: mu, text: "Join" });
				btn.setAttr("target", "_blank");
				btn.setAttr("rel", "noopener");
			}
		}
	}
}
