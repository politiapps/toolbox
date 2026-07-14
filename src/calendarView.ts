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

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/** Known meeting platforms. */
const MEETING_HOSTS = [
	"zoom.us", "meet.google.com", "teams.microsoft.com", "teams.live.com",
	"webex.com", "gotomeeting.com", "whereby.com", "meet.jit.si",
	"chime.aws", "bluejeans.com", "discord.gg", "slack.com/archives",
];

/**
 * Pick the single best meeting URL from a bag of candidates. Prefers known
 * conference platforms over generic links.
 */
function pickMeetingUrl(urls: string[]): string | null {
	for (const host of MEETING_HOSTS) {
		const m = urls.find((u) => u.includes(host));
		if (m) return m;
	}
	return urls[0] ?? null;
}

function extractUrls(text: string): string[] {
	const seen = new Set<string>();
	let m;
	while ((m = URL_RE.exec(text)) !== null) {
		seen.add(m[0].replace(/[.,;!?)]+$/, ""));
	}
	return [...seen];
}

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
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function renderTextWithLinks(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const urls = extractUrls(text);
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

		// --- Top row: time · title · [Join] ---
		const top = main.createDiv({ cls: "tasks-event-top" });
		top.createSpan({
			cls: "tasks-event-time",
			text: ev.allDay || !ev.start ? "All day" : formatEventTime(ev.start),
		});
		top.createSpan({ cls: "tasks-event-title", text: ev.summary });

		// Single meeting link (prefer known platforms, then the ICS URL, then any).
		const allUrls: string[] = [];
		for (const u of extractUrls(ev.description)) allUrls.push(u);
		for (const u of extractUrls(ev.location)) allUrls.push(u);
		if (ev.url) allUrls.push(ev.url);

		const meetingUrl = pickMeetingUrl(allUrls);
		if (meetingUrl) {
			const join = top.createEl("a", {
				cls: "tasks-event-join-btn",
				href: meetingUrl,
				text: "Join",
			});
			join.setAttr("target", "_blank");
			join.setAttr("rel", "noopener");
		}

		// --- Sub row: location + expander toggle ---
		const cleanDesc = ev.description ? stripHtml(ev.description) : "";
		const hasDetails = ev.location || cleanDesc;
		if (hasDetails) {
			const sub = main.createDiv({ cls: "tasks-event-sub" });

			if (ev.location) {
				const loc = sub.createSpan({ cls: "tasks-event-loc" });
				setIcon(loc.createSpan({ cls: "tasks-event-loc-icon" }), "map-pin");
				loc.createSpan({ cls: "tasks-event-loc-text", text: ev.location });
			}

			if (cleanDesc) {
				const short = cleanDesc.length > 120 ? cleanDesc.slice(0, 120).trim() + "…" : cleanDesc;

				const toggle = sub.createSpan({ cls: "tasks-event-expand" });
				toggle.setText(short);
				toggle.setAttr("tabindex", "0");

				const detail = sub.createDiv({ cls: "tasks-event-detail" });
				detail.appendChild(renderTextWithLinks(cleanDesc));
				detail.hidden = true;

				const toggleFn = () => {
					const was = detail.hidden;
					detail.hidden = !was;
				};
				toggle.addEventListener("click", toggleFn);
				toggle.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFn(); }
				});
			}
		}
	}
}
