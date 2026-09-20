import { describe, expect, it } from "vitest";
import {
	addShoppingItem,
	inferShoppingCategory,
	parseShopping,
	shoppingStaples,
	sortedShoppingItems,
	ShoppingStore,
} from "../src/shopping";
const input = (name: string, store = "", category = "") => ({
	name,
	store,
	category,
	quantity: "2",
});
describe("shopping", () => {
	it.each([
		["frozen peas", "Frozen"],
		["ice cream", "Frozen"],
		["apples", "Produce"],
		["milk", "Dairy & eggs"],
		["screws", "Hardware"],
		["mystery item", "Other"],
	])("classifies %s as %s", (name, category) =>
		expect(inferShoppingCategory(name)).toBe(category),
	);
	it("preserves explicit stores and category overrides", () => {
		const d = parseShopping(null);
		addShoppingItem(d, input("milk", "Corner shop", "Special order"), "1");
		expect(d.items[0]).toMatchObject({
			store: "Corner shop",
			category: "Special order",
		});
		addShoppingItem(d, input("screws"), "2");
		expect(d.items[1].store).toBe("Hardware store");
	});
	it("normalises repeat items and counts only re-additions", () => {
		const d = parseShopping(null);
		addShoppingItem(d, input(" Milk ", "Woolworths"), "1");
		expect(() => addShoppingItem(d, input("milk", "woolworths"), "2")).toThrow(
			"already",
		);
		d.items[0].checked = true;
		expect(d.items[0].frequency).toBe(1);
		d.items[0].active = false;
		addShoppingItem(d, input("MILK", "woolworths"), "3");
		expect(d.items).toHaveLength(1);
		expect(d.items[0]).toMatchObject({
			id: "1",
			frequency: 2,
			checked: false,
			active: true,
		});
	});
	it("keeps store-specific staples distinct and ranks frequency with stable ties", () => {
		const d = parseShopping(null);
		addShoppingItem(d, input("milk", "A"), "1");
		addShoppingItem(d, input("milk", "B"), "2");
		addShoppingItem(d, input("apples", "A"), "3");
		d.items.forEach((i) => (i.active = false));
		d.items[1].frequency = 3;
		expect(shoppingStaples(d).map((i) => i.id)).toEqual(["2", "3", "1"]);
		d.items[1].active = true;
		expect(shoppingStaples(d).map((i) => i.id)).toEqual(["3", "1"]);
	});
	it("groups stores and aisles, with checked items at the end", () => {
		const d = parseShopping(null);
		for (const [n, s] of [
			["frozen peas", "A"],
			["apples", "B"],
			["bread", "A"],
			["bananas", "A"],
		])
			addShoppingItem(d, input(n, s), n);
		d.items[2].checked = true;
		expect(sortedShoppingItems(d).map((i) => i.name)).toEqual([
			"bananas",
			"frozen peas",
			"apples",
			"bread",
		]);
	});
	it("round trips history and rejects damaged or future files without resetting them", () => {
		const d = parseShopping(null);
		addShoppingItem(d, input("milk"), "1");
		expect(parseShopping(JSON.stringify(d))).toEqual(d);
		for (const text of [
			"",
			"null",
			'{"version":2,"items":[]}',
			'{"version":1,"items":[{}]}',
			JSON.stringify({ ...d, items: [d.items[0], d.items[0]] }),
		])
			expect(() => parseShopping(text)).toThrow();
	});
	it("serializes rapid local mutations without losing additions", async () => {
		let file: string | null = null;
		const store = new ShoppingStore(
			async () => file,
			async (text) => {
				file = text;
			},
		);
		await Promise.all(
			["milk", "bread", "apples"].map((n) =>
				store.mutate((d) => addShoppingItem(d, input(n), n)),
			),
		);
		expect((await store.load()).items).toHaveLength(3);
	});
	it("rejects concurrent external changes and recovers its queue after errors", async () => {
		let reads = 0;
		let writes = 0;
		const external = '{"version":1,"items":[]}';
		const store = new ShoppingStore(
			async () => (++reads === 1 ? null : external),
			async () => {
				writes++;
			},
		);
		await expect(
			store.mutate((d) => addShoppingItem(d, input("milk"), "1")),
		).rejects.toThrow("another device");
		expect(writes).toBe(0);
		await store.mutate((d) => addShoppingItem(d, input("bread"), "2"));
		expect(writes).toBe(1);
	});
	it("does not write malformed existing files", async () => {
		let written = false;
		const store = new ShoppingStore(
			async () => "broken",
			async () => {
				written = true;
			},
		);
		await expect(store.mutate(() => {})).rejects.toThrow();
		expect(written).toBe(false);
	});
});
