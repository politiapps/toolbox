/**
 * viewSwitcher.ts — the chip strip standing in for showing every category at
 * once: "All", the two cross-cutting due-window views, then one chip per
 * configured section (each carrying its own accent dot, the same hue as its
 * card). Mirrors the plugin's `renderViewSwitcher` in `taskView.ts` so both
 * surfaces offer the same views.
 */

import { VIEW_ALL, VIEW_TODAY, VIEW_WEEK } from "@toolbox/task-core";
import type { ViewId } from "@toolbox/task-core";
import { el } from "./dom";
import { sectionAccent } from "../dates";
import type { AppContext } from "./context";

export function renderViewSwitcher(ctx: AppContext, parent: HTMLElement, activeView: ViewId): void {
	const strip = el("div", { cls: "view-switcher" });

	const chip = (id: ViewId, label: string, accent?: string): void => {
		const btn = el("button", { cls: id === activeView ? "view-chip is-active" : "view-chip" });
		if (accent) {
			const dot = el("span", { cls: "view-chip-dot" });
			dot.style.setProperty("--section-accent", accent);
			btn.append(dot);
		}
		btn.append(el("span", { text: label }));
		btn.addEventListener("click", async () => {
			if (ctx.settings.activeView === id) return;
			ctx.settings.activeView = id;
			await ctx.persist();
			await ctx.refresh();
		});
		strip.append(btn);
	};

	chip(VIEW_ALL, "All");
	chip(VIEW_TODAY, "Today");
	chip(VIEW_WEEK, "This week");
	for (const section of ctx.settings.sections) {
		chip(section.id, section.name, sectionAccent(section.id));
	}

	parent.append(strip);
}
