/**
 * datePicker.ts — a custom calendar panel for every `type="date"` field in
 * the app, replacing the OS calendar.
 *
 * The native popup can't be restyled to make "today" or past dates any
 * clearer, so this reveals an inline panel instead — a bottom sheet is
 * already open at every call site (add/edit form, reschedule), and stacking
 * another sheet on top of one is the kind of thing that gets confusing on a
 * phone. `attachDatePicker` takes over opening the field; the input's
 * `value` and its `input`/`change` events are unchanged, so the surrounding
 * form logic keeps working untouched. The grid comes from `@toolbox/task-
 * core`'s `datePickerGrid.ts`, shared with the plugin's own popover so the
 * two can't drift on what "today" or "this month" means.
 */

import { buildMonthGrid, shiftMonth, monthOf, todayISO } from "@toolbox/task-core";
import { el } from "./dom";
import { setIcon } from "./icons";

/**
 * Wire `input` to reveal this panel — inserted right after `insertAfter` —
 * instead of the OS picker. `allowClear` shows a "Clear" action (only where
 * an empty date is valid, e.g. a task's optional due date).
 */
export function attachDatePicker(
	input: HTMLInputElement,
	insertAfter: HTMLElement,
	opts: { allowClear?: boolean } = {}
): void {
	const allowClear = opts.allowClear ?? false;
	// Blocks the native picker/keyboard while leaving the field focusable and
	// its value settable from JS — this panel owns opening it now.
	input.readOnly = true;

	let panel: HTMLElement | null = null;
	let year = 0;
	let month = 0;

	const close = (): void => {
		panel?.remove();
		panel = null;
	};

	const select = (iso: string | null): void => {
		input.value = iso ?? "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		close();
	};

	const build = (): void => {
		if (!panel) return;
		panel.replaceChildren();
		const grid = buildMonthGrid(year, month, todayISO());

		const header = el("div", { cls: "datepicker-header" });
		const prev = el("button", { cls: "datepicker-nav", attrs: { "aria-label": "Previous month" } });
		setIcon(prev, "back");
		prev.addEventListener("click", (e) => {
			e.preventDefault();
			({ year, month } = shiftMonth(year, month, -1));
			build();
		});
		const next = el("button", { cls: "datepicker-nav is-next", attrs: { "aria-label": "Next month" } });
		setIcon(next, "back");
		next.addEventListener("click", (e) => {
			e.preventDefault();
			({ year, month } = shiftMonth(year, month, 1));
			build();
		});
		header.append(prev, el("span", { cls: "datepicker-label", text: grid.label }), next);
		panel.append(header);

		const weekdays = el("div", { cls: "datepicker-weekdays" });
		for (const w of grid.weekdayLabels) weekdays.append(el("span", { cls: "datepicker-weekday", text: w }));
		panel.append(weekdays);

		const gridEl = el("div", { cls: "datepicker-grid" });
		for (const week of grid.weeks) {
			for (const day of week) {
				const cls = ["datepicker-day"];
				if (!day.inMonth) cls.push("is-other-month");
				if (day.isToday) cls.push("is-today");
				if (day.isPast) cls.push("is-past");
				if (day.iso === input.value) cls.push("is-selected");
				const btn = el("button", { cls: cls.join(" "), text: String(day.day), attrs: { "aria-label": day.iso } });
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					select(day.iso);
				});
				gridEl.append(btn);
			}
		}
		panel.append(gridEl);

		const footer = el("div", { cls: "datepicker-footer" });
		const todayBtn = el("button", { cls: "datepicker-today-btn", text: "Today" });
		todayBtn.addEventListener("click", (e) => {
			e.preventDefault();
			select(todayISO());
		});
		footer.append(todayBtn);
		if (allowClear) {
			const clearBtn = el("button", { cls: "datepicker-clear-btn", text: "Clear" });
			clearBtn.addEventListener("click", (e) => {
				e.preventDefault();
				select(null);
			});
			footer.append(clearBtn);
		}
		panel.append(footer);
	};

	insertAfter.addEventListener("click", (e) => {
		e.preventDefault();
		if (panel) {
			close();
			return;
		}
		({ year, month } = monthOf(input.value || null));
		panel = el("div", { cls: "datepicker-panel" });
		insertAfter.insertAdjacentElement("afterend", panel);
		build();
	});
}
