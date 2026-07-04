import {
	RecurrenceRule,
	WEEKDAY_LABELS,
	parseRecurrence,
	recurrenceToText,
} from "@toolbox/task-core";
import { el } from "./dom";

/**
 * A "Repeat" control emitting canonical Tasks recurrence text (via task-core).
 * Mirrors the plugin's builder: a toggle, then interval + unit, plus weekly
 * weekday / monthly mode. `onChange` fires only on user interaction.
 */
export function recurrenceControl(
	parent: HTMLElement,
	initial: string | null,
	onChange: (text: string | null) => void
): void {
	const initialRule = initial ? parseRecurrence(initial) : null;

	const wrap = el("div", { cls: "recurrence" });
	const toggleRow = el("label", { cls: "recurrence-toggle" });
	const toggle = el("input", { attrs: { type: "checkbox" } }) as HTMLInputElement;
	toggle.checked = initialRule !== null;
	toggleRow.append(toggle, el("span", { text: "Repeat" }));
	const fields = el("div", { cls: "recurrence-fields" });
	wrap.append(toggleRow, fields);
	parent.append(wrap);

	// Local editable state, seeded from the initial rule.
	let unit: RecurrenceRule["unit"] = initialRule?.unit ?? "week";
	let interval = initialRule?.interval ?? 1;
	let weekday: number | null = initialRule?.weekday ?? null;
	let monthMode: "dom" | "nth" | "last" =
		initialRule?.ordinal === -1 && initialRule?.weekday == null
			? "last"
			: initialRule?.ordinal != null
				? "nth"
				: "dom";
	let dayOfMonth = initialRule?.dayOfMonth ?? 1;
	let ordinal = initialRule?.ordinal && initialRule.ordinal > 0 ? initialRule.ordinal : 1;

	function buildRule(): RecurrenceRule {
		const rule: RecurrenceRule = { unit, interval: Math.max(1, interval) };
		if (unit === "week") rule.weekday = weekday;
		if (unit === "month") {
			if (monthMode === "last") rule.ordinal = -1;
			else if (monthMode === "nth") {
				rule.ordinal = ordinal;
				rule.weekday = weekday ?? 1;
			} else rule.dayOfMonth = dayOfMonth;
		}
		return rule;
	}

	function emit(): void {
		onChange(toggle.checked ? recurrenceToText(buildRule()) : null);
	}

	function render(): void {
		fields.replaceChildren();
		fields.style.display = toggle.checked ? "" : "none";
		if (!toggle.checked) return;

		const line = el("div", { cls: "recurrence-line" });
		line.append(el("span", { text: "Every" }));

		const intervalInput = el("input", {
			cls: "recurrence-interval",
			attrs: { type: "number", min: 1, value: interval },
		}) as HTMLInputElement;
		intervalInput.addEventListener("input", () => {
			interval = parseInt(intervalInput.value, 10) || 1;
			emit();
		});
		line.append(intervalInput);

		const unitSel = el("select") as HTMLSelectElement;
		for (const u of ["day", "week", "month", "year"] as const) {
			unitSel.append(el("option", { text: u + (interval > 1 ? "s" : ""), attrs: { value: u } }));
		}
		unitSel.value = unit;
		unitSel.addEventListener("change", () => {
			unit = unitSel.value as RecurrenceRule["unit"];
			render();
			emit();
		});
		line.append(unitSel);
		fields.append(line);

		if (unit === "week") {
			const daySel = el("select", { cls: "recurrence-sub" }) as HTMLSelectElement;
			daySel.append(el("option", { text: "Any day", attrs: { value: "-1" } }));
			WEEKDAY_LABELS.forEach((label, i) =>
				daySel.append(el("option", { text: "on " + label, attrs: { value: String(i) } }))
			);
			daySel.value = String(weekday ?? -1);
			daySel.addEventListener("change", () => {
				const v = parseInt(daySel.value, 10);
				weekday = v < 0 ? null : v;
				emit();
			});
			fields.append(daySel);
		}

		if (unit === "month") {
			const modeSel = el("select", { cls: "recurrence-sub" }) as HTMLSelectElement;
			modeSel.append(el("option", { text: "On a day of the month", attrs: { value: "dom" } }));
			modeSel.append(el("option", { text: "On the Nth weekday", attrs: { value: "nth" } }));
			modeSel.append(el("option", { text: "On the last day", attrs: { value: "last" } }));
			modeSel.value = monthMode;
			modeSel.addEventListener("change", () => {
				monthMode = modeSel.value as typeof monthMode;
				render();
				emit();
			});
			fields.append(modeSel);

			if (monthMode === "dom") {
				const domInput = el("input", {
					cls: "recurrence-sub",
					attrs: { type: "number", min: 1, max: 31, value: dayOfMonth },
				}) as HTMLInputElement;
				domInput.addEventListener("input", () => {
					dayOfMonth = Math.min(31, Math.max(1, parseInt(domInput.value, 10) || 1));
					emit();
				});
				fields.append(domInput);
			} else if (monthMode === "nth") {
				const ordSel = el("select", { cls: "recurrence-sub" }) as HTMLSelectElement;
				["1st", "2nd", "3rd", "4th"].forEach((label, i) =>
					ordSel.append(el("option", { text: label, attrs: { value: String(i + 1) } }))
				);
				ordSel.value = String(ordinal);
				ordSel.addEventListener("change", () => {
					ordinal = parseInt(ordSel.value, 10);
					emit();
				});
				const dowSel = el("select", { cls: "recurrence-sub" }) as HTMLSelectElement;
				WEEKDAY_LABELS.forEach((label, i) =>
					dowSel.append(el("option", { text: label, attrs: { value: String(i) } }))
				);
				dowSel.value = String(weekday ?? 1);
				dowSel.addEventListener("change", () => {
					weekday = parseInt(dowSel.value, 10);
					emit();
				});
				fields.append(ordSel, dowSel);
			}
		}
	}

	toggle.addEventListener("change", () => {
		render();
		emit();
	});
	render();
}
