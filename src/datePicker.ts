/**
 * datePicker.ts — a custom calendar popover for every `type="date"` field in
 * the plugin, replacing the OS/browser picker.
 *
 * The native popup has no CSS hooks for its calendar grid in Chromium, so
 * "today" and past dates couldn't be made any clearer — that's what this file
 * exists to fix. `attachDatePicker` takes over opening the field; the input's
 * `value` and its `input`/`change` events are unchanged, so every existing
 * `onChange` / `addEventListener("change", …)` at the call site keeps working
 * untouched. The grid itself comes from `@toolbox/task-core`'s
 * `datePickerGrid.ts` so the app can't drift on what "today" or "this month"
 * means.
 */

import { setIcon } from "obsidian";
import { buildMonthGrid, shiftMonth, monthOf, todayISO } from "@toolbox/task-core";

/**
 * Wire `input` to open this popover instead of the OS picker. `trigger`
 * defaults to `input` itself; pass the visible chip element for fields where
 * the real input is an invisible overlay (`.timesheet-date-field`).
 * `allowClear` shows a "Clear" action that empties the field (only
 * meaningful where an empty date is valid, e.g. a task's optional due date).
 */
export function attachDatePicker(
	input: HTMLInputElement,
	opts: { trigger?: HTMLElement; allowClear?: boolean } = {}
): void {
	const trigger = opts.trigger ?? input;
	const allowClear = opts.allowClear ?? false;

	// Take over opening entirely — readonly blocks the native picker and
	// keyboard entry while leaving the field focusable and its value settable
	// from JS, exactly what a fully custom picker needs.
	input.readOnly = true;
	if (trigger !== input) input.style.pointerEvents = "none";

	const open = (e: Event): void => {
		e.preventDefault();
		openPopover(trigger, input, allowClear);
	};
	trigger.addEventListener("click", open);
	trigger.addEventListener("focus", open);
}

function openPopover(trigger: HTMLElement, input: HTMLInputElement, allowClear: boolean): void {
	// Only one open at a time.
	document.querySelectorAll(".tasks-datepicker-popover").forEach((el) => el.remove());

	let { year, month } = monthOf(input.value || null);

	const popover = document.body.createDiv({ cls: "tasks-datepicker-popover" });

	const select = (iso: string | null): void => {
		input.value = iso ?? "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		close();
	};

	const build = (): void => {
		popover.empty();
		const grid = buildMonthGrid(year, month, todayISO());

		const header = popover.createDiv({ cls: "tasks-datepicker-header" });
		const prev = header.createEl("button", { cls: "tasks-datepicker-nav" });
		setIcon(prev, "chevron-left");
		prev.setAttr("aria-label", "Previous month");
		prev.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			({ year, month } = shiftMonth(year, month, -1));
			build();
		});
		header.createSpan({ cls: "tasks-datepicker-label", text: grid.label });
		const next = header.createEl("button", { cls: "tasks-datepicker-nav" });
		setIcon(next, "chevron-right");
		next.setAttr("aria-label", "Next month");
		next.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			({ year, month } = shiftMonth(year, month, 1));
			build();
		});

		const weekdays = popover.createDiv({ cls: "tasks-datepicker-weekdays" });
		for (const w of grid.weekdayLabels) weekdays.createSpan({ cls: "tasks-datepicker-weekday", text: w });

		const gridEl = popover.createDiv({ cls: "tasks-datepicker-grid" });
		for (const week of grid.weeks) {
			for (const day of week) {
				const btn = gridEl.createEl("button", { cls: "tasks-datepicker-day", text: String(day.day) });
				if (!day.inMonth) btn.addClass("is-other-month");
				if (day.isToday) btn.addClass("is-today");
				if (day.isPast) btn.addClass("is-past");
				if (day.iso === input.value) btn.addClass("is-selected");
				btn.setAttr("aria-label", day.iso);
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					select(day.iso);
				});
			}
		}

		const footer = popover.createDiv({ cls: "tasks-datepicker-footer" });
		const todayBtn = footer.createEl("button", { cls: "tasks-datepicker-today-btn", text: "Today" });
		todayBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			select(todayISO());
		});
		if (allowClear) {
			const clearBtn = footer.createEl("button", { cls: "tasks-datepicker-clear-btn", text: "Clear" });
			clearBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				select(null);
			});
		}

		positionPopover(popover, trigger);
	};

	const close = (): void => {
		popover.remove();
		document.removeEventListener("mousedown", onOutside, true);
		document.removeEventListener("keydown", onKeydown, true);
		window.removeEventListener("scroll", close, true);
		window.removeEventListener("resize", close);
	};
	const onOutside = (e: MouseEvent): void => {
		const target = e.target as Node;
		if (!popover.contains(target) && target !== trigger && !trigger.contains(target)) close();
	};
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key === "Escape") close();
	};

	build();
	// Deferred so the click that opened this popover doesn't also close it via
	// the same mousedown bubbling to the document listener below.
	window.setTimeout(() => {
		document.addEventListener("mousedown", onOutside, true);
		document.addEventListener("keydown", onKeydown, true);
	}, 0);
	window.addEventListener("scroll", close, true);
	window.addEventListener("resize", close);
}

/** Anchor the popover under `trigger`, flipping above / clamping sideways if it would overflow the viewport. */
function positionPopover(popover: HTMLElement, trigger: HTMLElement): void {
	const rect = trigger.getBoundingClientRect();
	const popRect = popover.getBoundingClientRect();
	const margin = 6;

	let top = rect.bottom + margin;
	if (top + popRect.height > window.innerHeight - margin) {
		top = Math.max(margin, rect.top - popRect.height - margin);
	}
	let left = rect.left;
	if (left + popRect.width > window.innerWidth - margin) {
		left = Math.max(margin, window.innerWidth - popRect.width - margin);
	}
	popover.style.top = `${top}px`;
	popover.style.left = `${left}px`;
}
