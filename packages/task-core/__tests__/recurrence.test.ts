import { describe, it, expect } from "vitest";
import { parseRecurrence, recurrenceToText, nextDueDate } from "../src/recurrence";

describe("parseRecurrence + recurrenceToText round-trip", () => {
	const canonical = [
		"every day",
		"every 3 days",
		"every week",
		"every 2 weeks",
		"every Monday",
		"every 2 weeks on Thursday",
		"every month",
		"every month on the 1st",
		"every 2 months on the 2nd Monday",
		"every month on the last",
		"every year",
	];

	for (const text of canonical) {
		it(`stabilises: ${text}`, () => {
			const rule = parseRecurrence(text)!;
			expect(rule).not.toBeNull();
			expect(recurrenceToText(rule)).toBe(text);
		});
	}

	it("returns null for unrecognised text", () => {
		expect(parseRecurrence("sometimes")).toBeNull();
		expect(parseRecurrence("")).toBeNull();
	});
});

describe("nextDueDate — advances from the due date", () => {
	it("adds days and weeks", () => {
		expect(nextDueDate(parseRecurrence("every day")!, "2026-01-31")).toBe("2026-02-01");
		expect(nextDueDate(parseRecurrence("every 2 weeks")!, "2026-01-05")).toBe("2026-01-19");
	});

	it("clamps day-of-month overflow (31st → Feb)", () => {
		const rule = parseRecurrence("every month on the 31st")!;
		expect(nextDueDate(rule, "2026-01-31")).toBe("2026-02-28");
	});

	it("computes the nth weekday of the month", () => {
		// 2nd Monday of Feb 2026 is the 9th.
		const rule = parseRecurrence("every month on the 2nd Monday")!;
		expect(nextDueDate(rule, "2026-01-12")).toBe("2026-02-09");
	});

	it("computes the last day of the month", () => {
		const rule = parseRecurrence("every month on the last")!;
		expect(nextDueDate(rule, "2026-01-31")).toBe("2026-02-28");
	});
});
