import { describe, it, expect } from "vitest";
import { buildMonthGrid, shiftMonth, monthOf } from "../src/datePickerGrid";

describe("buildMonthGrid", () => {
	it("pads to whole weeks and flags in-month days", () => {
		// August 2026: 1st is a Saturday, 31 days — 6 rows.
		const grid = buildMonthGrid(2026, 8, "2026-08-11");
		expect(grid.weeks.length).toBe(6);
		expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
		expect(grid.label).toContain("2026");

		const inMonthDays = grid.weeks.flat().filter((d) => d.inMonth);
		expect(inMonthDays.length).toBe(31);
		expect(inMonthDays[0].iso).toBe("2026-08-01");
		expect(inMonthDays[inMonthDays.length - 1].iso).toBe("2026-08-31");
	});

	it("flags today, and only today", () => {
		const grid = buildMonthGrid(2026, 8, "2026-08-11");
		const flagged = grid.weeks.flat().filter((d) => d.isToday);
		expect(flagged.map((d) => d.iso)).toEqual(["2026-08-11"]);
	});

	it("flags every date strictly before today as past, in-month or not", () => {
		const grid = buildMonthGrid(2026, 8, "2026-08-11");
		for (const day of grid.weeks.flat()) {
			expect(day.isPast).toBe(day.iso < "2026-08-11");
		}
	});

	it("borrows adjacent-month days to fill leading/trailing weeks", () => {
		const grid = buildMonthGrid(2026, 8, "2026-08-11");
		const first = grid.weeks[0];
		const last = grid.weeks[grid.weeks.length - 1];
		// Aug 1 2026 is a Saturday, so the first week's first 6 cells borrow July.
		expect(first.slice(0, 6).every((d) => !d.inMonth)).toBe(true);
		expect(first[6].iso).toBe("2026-08-01");
		expect(last.some((d) => !d.inMonth)).toBe(true);
	});

	it("has 7 locale weekday labels", () => {
		const grid = buildMonthGrid(2026, 8, "2026-08-11");
		expect(grid.weekdayLabels.length).toBe(7);
	});
});

describe("shiftMonth", () => {
	it("moves within a year", () => {
		expect(shiftMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 });
		expect(shiftMonth(2026, 8, -1)).toEqual({ year: 2026, month: 7 });
	});

	it("rolls over year boundaries either direction", () => {
		expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
		expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
	});
});

describe("monthOf", () => {
	it("reads the year/month out of a valid ISO date", () => {
		expect(monthOf("2026-08-11")).toEqual({ year: 2026, month: 8 });
	});

	it("falls back to the current month for null or malformed input", () => {
		const now = new Date();
		const expected = { year: now.getFullYear(), month: now.getMonth() + 1 };
		expect(monthOf(null)).toEqual(expected);
		expect(monthOf("not-a-date")).toEqual(expected);
	});
});
