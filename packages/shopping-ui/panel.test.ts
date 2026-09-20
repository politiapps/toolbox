// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountShopping as mountPanel, ShoppingHandle } from "./panel";
import { openModal } from "../../apps/android/src/ui/dom";
const mountShopping = (root: HTMLElement, store: ShoppingStore) =>
	mountPanel(root, store, {
		platform: "android",
		openModal,
		collapseState: {},
		persist: async () => {},
	});
import { ShoppingStore, parseShopping } from "../task-core/src/shopping";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (label: string) =>
	Array.from(document.querySelectorAll("button"))
		.filter((b) => !b.closest('[aria-hidden="true"]'))
		.find(
			(b) => b.textContent === label || b.getAttribute("aria-label") === label,
		)!;
const field = (label: string) =>
	Array.from(document.querySelectorAll("label"))
		.filter((l) => !l.closest('[aria-hidden="true"]'))
		.find((l) => l.firstChild?.textContent === label)!
		.querySelector("input")!;
let cleanup: ShoppingHandle | undefined;
afterEach(() => {
	cleanup?.();
	document.body.replaceChildren();
});
describe("shared shopping UI", () => {
	it("adds, edits, purchases, finishes and reselects a staple across remounts", async () => {
		let file: string | null = null;
		const store = new ShoppingStore(
			async () => file,
			async (text) => {
				file = text;
			},
		);
		cleanup = mountShopping(document.body, store);
		await settle();
		expect(document.querySelector("form")).toBeNull();
		cleanup.openAdd();
		field("Item").value = "milk";
		field("Store").value = "Corner shop";
		field("Quantity / note").value = "2 litres";
		button("Add item").click();
		await settle();
		expect(document.body.textContent).toContain("Corner shop");
		button("Edit milk").click();
		field("Category").value = "Special aisle";
		button("Save item").click();
		await settle();
		expect(parseShopping(file).items[0].category).toBe("Special aisle");
		(document.querySelector("[type=checkbox]") as HTMLInputElement).click();
		await settle();
		button("Finish purchased (1)").click();
		await settle();
		cleanup();
		cleanup = mountShopping(document.body, store);
		await settle();
		button("Staples").click();
		expect(document.body.textContent).toContain("Added 1 times");
		button("Add milk again").click();
		await settle();
		expect(parseShopping(file).items[0]).toMatchObject({
			active: true,
			checked: false,
			frequency: 2,
			store: "Corner shop",
			quantity: "2 litres",
			category: "Special aisle",
		});
		button("Done").click();
		expect(document.querySelector(".toolbox-shopping")?.textContent).toContain(
			"2 litres",
		);
	});
	it("keeps a failed form and allows retry after initial read errors", async () => {
		const read = vi
			.fn()
			.mockRejectedValueOnce(new Error("No access"))
			.mockResolvedValue(null);
		cleanup = mountShopping(
			document.body,
			new ShoppingStore(read, async () => {}),
		);
		await settle();
		expect(document.body.textContent).toContain("No access");
		expect(button("Refresh shopping list").disabled).toBe(false);
		button("Refresh shopping list").click();
		await settle();
		expect(document.body.textContent).not.toContain("No access");
	});
	it("blocks double submission while a write is pending", async () => {
		let file: string | null = null;
		let finish: (() => void) | undefined;
		const write = vi.fn(async (text: string) => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			file = text;
		});
		cleanup = mountShopping(
			document.body,
			new ShoppingStore(async () => file, write),
		);
		await settle();
		cleanup.openAdd();
		field("Item").value = "apples";
		button("Add item").click();
		await settle();
		button("Add item").click();
		expect(write).toHaveBeenCalledTimes(1);
		finish!();
		await settle();
		expect(parseShopping(file).items).toHaveLength(1);
	});
	it("reports stale edits instead of overwriting another device", async () => {
		let file = JSON.stringify({
			version: 1,
			items: [
				{
					id: "1",
					name: "milk",
					store: "Grocery",
					category: "Dairy & eggs",
					quantity: "",
					active: true,
					checked: false,
					frequency: 1,
				},
			],
		});
		cleanup = mountShopping(
			document.body,
			new ShoppingStore(
				async () => file,
				async (text) => {
					file = text;
				},
			),
		);
		await settle();
		button("Edit milk").click();
		const external = parseShopping(file);
		external.items[0].quantity = "3";
		file = JSON.stringify(external);
		field("Quantity / note").value = "2";
		button("Save item").click();
		await settle();
		expect(document.body.textContent).toContain("This item changed");
		expect(parseShopping(file).items[0].quantity).toBe("3");
	});
});

describe("task-style shopping controls", () => {
	it("persists collapsed store sections and pre-fills the section add dialog", async () => {
		const collapseState: Record<string, boolean> = {};
		const persist = vi.fn(async () => {});
		const file = JSON.stringify({
			version: 1,
			items: [
				{
					id: "1",
					name: "milk",
					store: "Corner shop",
					category: "Dairy & eggs",
					quantity: "",
					active: true,
					checked: false,
					frequency: 1,
				},
			],
		});
		const store = new ShoppingStore(
			async () => file,
			async () => {},
		);
		const mount = () =>
			mountPanel(document.body, store, {
				platform: "obsidian",
				openModal,
				collapseState,
				persist,
			});
		cleanup = mount();
		await settle();
		expect(document.querySelector(".tasks-row")).not.toBeNull();
		const toggle = document.querySelector<HTMLButtonElement>(
			".shop-section-toggle",
		)!;
		toggle.click();
		expect(collapseState["shopping:store:Corner shop"]).toBe(true);
		expect(persist).toHaveBeenCalledOnce();
		cleanup();
		cleanup = mount();
		await settle();
		expect(document.querySelector(".tasks-row")).toBeNull();
		button("Add item to Corner shop").click();
		expect(field("Store").value).toBe("Corner shop");
	});
	it("retains the form and displays write errors inside the dialog", async () => {
		cleanup = mountShopping(
			document.body,
			new ShoppingStore(
				async () => null,
				async () => {
					throw new Error("Storage unavailable");
				},
			),
		);
		await settle();
		cleanup.openAdd();
		field("Item").value = "milk";
		button("Add item").click();
		await settle();
		expect(
			document.querySelector(".shop-dialog [role=alert]")?.textContent,
		).toBe("Storage unavailable");
		expect(field("Item").value).toBe("milk");
		expect(button("Add item").disabled).toBe(false);
	});
});
