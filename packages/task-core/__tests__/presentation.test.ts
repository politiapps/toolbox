import { describe, it, expect } from "vitest";
import {
	dueState,
	dueClass,
	dueLabel,
	dueWithin,
	daysUntil,
	addDaysISO,
	formatDueShort,
	formatDueDisplay,
	ordinalSuffix,
	priorityFilled,
	sectionAccent,
	SECTION_ACCENTS,
	formatFocus,
	formatClock,
	PRIORITY_SEGMENTS,
} from "../src/presentation";

// A fixed "today" so the ramp boundaries can be asserted exactly. 2026-08-02 is
// a Sunday, which also exercises the weekday formatting.
const TODAY = "2026-08-02";

/** N days from TODAY as an ISO date. */
function offset(days: number): string {
	const d = new Date(2026, 7, 2 + days);
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

describe("daysUntil", () => {
	it("counts whole days, negative into the past", () => {
		expect(daysUntil(TODAY, TODAY)).toBe(0);
		expect(daysUntil(offset(1), TODAY)).toBe(1);
		expect(daysUntil(offset(-3), TODAY)).toBe(-3);
	});

	it("is unaffected by month and year boundaries", () => {
		expect(daysUntil("2026-09-01", "2026-08-31")).toBe(1);
		expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
	});
});

describe("dueState — the proximity ramp", () => {
	it("buckets each step of the ramp", () => {
		expect(dueState(offset(-1), TODAY)).toBe("overdue");
		expect(dueState(offset(0), TODAY)).toBe("today");
		expect(dueState(offset(1), TODAY)).toBe("tomorrow");
		expect(dueState(offset(2), TODAY)).toBe("soon");
		expect(dueState(offset(3), TODAY)).toBe("upcoming");
	});

	it("holds at the far edges", () => {
		expect(dueState(offset(-400), TODAY)).toBe("overdue");
		expect(dueState(offset(400), TODAY)).toBe("upcoming");
	});

	it("prefixes the badge class with is-", () => {
		expect(dueClass(offset(0), TODAY)).toBe("is-today");
		expect(dueClass(offset(-1), TODAY)).toBe("is-overdue");
	});
});

describe("dueLabel", () => {
	it("reads relatively inside the near term", () => {
		expect(dueLabel(offset(0), TODAY)).toBe("Today");
		expect(dueLabel(offset(1), TODAY)).toBe("Tomorrow");
		expect(dueLabel(offset(-1), TODAY)).toBe("Yesterday");
	});

	it("counts lateness up to a week overdue", () => {
		expect(dueLabel(offset(-2), TODAY)).toBe("2d late");
		expect(dueLabel(offset(-7), TODAY)).toBe("7d late");
	});

	it("falls back to the calendar date beyond a week late", () => {
		// More than a week out in either direction, the date carries more meaning
		// than the gap does.
		expect(dueLabel(offset(-8), TODAY)).toBe(formatDueShort(offset(-8)));
		expect(dueLabel(offset(2), TODAY)).toBe(formatDueShort(offset(2)));
	});
});

describe("addDaysISO", () => {
	it("shifts forward and back, crossing month/year boundaries", () => {
		expect(addDaysISO(TODAY, 1)).toBe(offset(1));
		expect(addDaysISO(TODAY, -1)).toBe(offset(-1));
		expect(addDaysISO("2026-08-31", 1)).toBe("2026-09-01");
		expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
	});
});

describe("dueWithin — the cross-cutting view window", () => {
	it("includes today and the given number of days ahead", () => {
		expect(dueWithin(offset(0), 0, TODAY)).toBe(true);
		expect(dueWithin(offset(6), 6, TODAY)).toBe(true);
	});

	it("excludes anything past the window", () => {
		expect(dueWithin(offset(1), 0, TODAY)).toBe(false);
		expect(dueWithin(offset(7), 6, TODAY)).toBe(false);
	});

	it("always includes overdue dates regardless of the window size", () => {
		expect(dueWithin(offset(-30), 0, TODAY)).toBe(true);
		expect(dueWithin(offset(-1), 6, TODAY)).toBe(true);
	});
});

describe("date formatting", () => {
	it("uses short weekday + ordinal day, no year", () => {
		expect(formatDueShort("2026-08-02")).toBe("Sun 2nd");
		expect(formatDueShort("2026-08-25")).toBe("Tue 25th");
	});

	it("keeps the long weekday for labels and the detail modal", () => {
		expect(formatDueDisplay("2026-08-02")).toBe("Sunday 2nd");
	});

	it("handles the teens, which break the naive rule", () => {
		expect(ordinalSuffix(1)).toBe("st");
		expect(ordinalSuffix(2)).toBe("nd");
		expect(ordinalSuffix(3)).toBe("rd");
		expect(ordinalSuffix(4)).toBe("th");
		expect(ordinalSuffix(11)).toBe("th");
		expect(ordinalSuffix(12)).toBe("th");
		expect(ordinalSuffix(13)).toBe("th");
		expect(ordinalSuffix(21)).toBe("st");
		expect(ordinalSuffix(22)).toBe("nd");
		expect(ordinalSuffix(23)).toBe("rd");
	});
});

describe("priorityFilled", () => {
	it("maps the five visible levels onto the five segments", () => {
		// `normal` never renders a chip, so its rank slot must not leave a gap.
		expect(priorityFilled("highest")).toBe(5);
		expect(priorityFilled("high")).toBe(4);
		expect(priorityFilled("medium")).toBe(3);
		expect(priorityFilled("low")).toBe(2);
		expect(priorityFilled("lowest")).toBe(1);
	});

	it("never lights more segments than the meter has", () => {
		const levels = ["highest", "high", "medium", "normal", "low", "lowest"] as const;
		for (const p of levels) {
			expect(priorityFilled(p)).toBeLessThanOrEqual(PRIORITY_SEGMENTS);
		}
	});
});

describe("sectionAccent", () => {
	it("is stable for an id, so colour follows the lane not its position", () => {
		expect(sectionAccent("work")).toBe(sectionAccent("work"));
	});

	it("always resolves to a colour from the set", () => {
		for (const id of ["work", "home", "s-1", "", "🙂", "auto-#personal"]) {
			expect(SECTION_ACCENTS).toContain(sectionAccent(id));
		}
	});
});

describe("duration formatting", () => {
	it("formats focus time compactly", () => {
		expect(formatFocus(45)).toBe("45s");
		expect(formatFocus(60)).toBe("1m");
		expect(formatFocus(1500)).toBe("25m");
		expect(formatFocus(3600)).toBe("1h");
		expect(formatFocus(4800)).toBe("1h 20m");
	});

	it("rounds the clock up so a timer starts at NN:00", () => {
		expect(formatClock(25 * 60_000)).toBe("25:00");
		expect(formatClock(59_001)).toBe("01:00");
		expect(formatClock(0)).toBe("00:00");
		expect(formatClock(-500)).toBe("00:00");
	});
});
