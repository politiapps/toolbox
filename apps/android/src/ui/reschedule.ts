/**
 * reschedule.ts — the "Reschedule overdue" bottom sheet: Today / Tomorrow
 * quick picks, or a custom date, applied to every overdue task in scope via
 * `TaskService.rescheduleOverdue`. A bottom sheet rather than an anchored
 * popup (unlike the plugin's `.tasks-reschedule-popup`) because that's this
 * app's own pattern for anything needing more than a tap — see `addModal.ts`
 * — and a floating popover risks running off a phone-width header.
 */

import { el, openModal, toast } from "./dom";
import { todayISO, addDaysISO } from "../dates";
import type { AppContext } from "./context";

export function openReschedule(ctx: AppContext, count: number, scopeTag: string | null): void {
	openModal((content, close) => {
		content.append(
			el("h3", {
				cls: "modal-title",
				text: `Reschedule ${count} overdue task${count === 1 ? "" : "s"}`,
			})
		);

		const today = todayISO();
		let selected = today;

		const quick = el("div", { cls: "reschedule-quick" });
		const todayBtn = el("button", { cls: "btn reschedule-quick-btn is-selected", text: "Today" });
		const tomorrowBtn = el("button", { cls: "btn reschedule-quick-btn", text: "Tomorrow" });
		quick.append(todayBtn, tomorrowBtn);
		content.append(quick);

		const dateInput = el("input", {
			cls: "form-input",
			attrs: { type: "date" },
		}) as HTMLInputElement;
		dateInput.value = today;
		const dateField = el("label", { cls: "form-field" });
		dateField.append(el("span", { cls: "form-label", text: "Or pick a date" }), dateInput);
		content.append(dateField);

		const selectQuick = (btn: HTMLButtonElement, iso: string): void => {
			selected = iso;
			dateInput.value = iso;
			todayBtn.classList.remove("is-selected");
			tomorrowBtn.classList.remove("is-selected");
			btn.classList.add("is-selected");
		};
		todayBtn.addEventListener("click", () => selectQuick(todayBtn, today));
		tomorrowBtn.addEventListener("click", () => selectQuick(tomorrowBtn, addDaysISO(today, 1)));
		dateInput.addEventListener("change", () => {
			if (!dateInput.value) return;
			selected = dateInput.value;
			todayBtn.classList.remove("is-selected");
			tomorrowBtn.classList.remove("is-selected");
		});

		const buttons = el("div", { cls: "modal-buttons" });
		const confirmBtn = el("button", { cls: "btn btn-cta", text: "Confirm" });
		const cancelBtn = el("button", { cls: "btn", text: "Cancel" });
		confirmBtn.addEventListener("click", async () => {
			try {
				await ctx.service.rescheduleOverdue(selected, scopeTag);
				close();
				await ctx.refresh();
			} catch (e) {
				toast(String((e as Error).message ?? e));
			}
		});
		cancelBtn.addEventListener("click", close);
		buttons.append(confirmBtn, cancelBtn);
		content.append(buttons);
	});
}
