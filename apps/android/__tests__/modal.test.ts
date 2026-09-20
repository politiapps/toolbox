// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openModal } from "../src/ui/dom";
describe("shared task and shopping modal behavior", () => {
	it("labels dialogs, traps focus, closes on Escape and restores focus", () => {
		const trigger = document.createElement("button");
		document.body.append(trigger);
		trigger.focus();
		const handle = openModal((content) => {
			const title = document.createElement("h3");
			title.textContent = "Add task";
			const input = document.createElement("input");
			const last = document.createElement("button");
			last.textContent = "Save";
			content.append(title, input, last);
		});
		const dialog = document.querySelector("[role=dialog]")!;
		expect(
			document.getElementById(dialog.getAttribute("aria-labelledby")!)
				?.textContent,
		).toBe("Add task");
		const input = handle.contentEl.querySelector("input")!;
		const last = handle.contentEl.querySelector("button")!;
		expect(document.activeElement).toBe(input);
		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Tab",
				shiftKey: true,
				cancelable: true,
			}),
		);
		expect(document.activeElement).toBe(last);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
		);
		expect(document.activeElement).toBe(input);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		);
		expect(document.activeElement).toBe(trigger);
		expect(document.body.classList.contains("modal-open")).toBe(false);
		handle.close();
		trigger.remove();
	});
	it("only dismisses the top sheet and keeps the underlying modal open", () => {
		const first = openModal((content) => {
			const b = document.createElement("button");
			b.textContent = "Open subtask";
			content.append(b);
		});
		const second = openModal((content) => {
			const b = document.createElement("button");
			b.textContent = "Save subtask";
			content.append(b);
		});
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
		);
		expect(document.body.classList.contains("modal-open")).toBe(true);
		expect(document.activeElement).toBe(
			first.contentEl.querySelector("button"),
		);
		first.close();
		second.close();
		expect(document.body.classList.contains("modal-open")).toBe(false);
	});
});
