/** Shared shopping domain. History is retained when purchased items leave the list. */
export const SHOPPING_PATH = "shopping-list.json";
export const SHOPPING_CATEGORIES = [
	"Produce",
	"Bakery",
	"Meat & seafood",
	"Pantry",
	"Household",
	"Dairy & eggs",
	"Frozen",
	"Hardware",
	"Other",
];
export const SHOPPING_STORES = [
	"Grocery",
	"Woolworths",
	"Hardware store",
	"Other",
];
export interface ShoppingItem {
	id: string;
	name: string;
	store: string;
	category: string;
	quantity: string;
	active: boolean;
	checked: boolean;
	frequency: number;
}
export interface ShoppingData {
	version: 1;
	items: ShoppingItem[];
}
const key = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function inferShoppingCategory(name: string): string {
	const n = key(name);
	const rules: [string, RegExp][] = [
		["Frozen", /\b(frozen|ice cream|ice blocks|ice cubes)\b/],
		[
			"Hardware",
			/\b(screws?|nails?|hammer|drill|paint|sandpaper|timber|bolts?|screwdriver)\b/,
		],
		[
			"Household",
			/\b(detergent|soap|toilet paper|dishwashing|laundry|cleaner|shampoo|toothpaste|bin bags)\b/,
		],
		["Dairy & eggs", /\b(milk|cheese|yog[hu]urt|butter|cream|eggs?)\b/],
		[
			"Meat & seafood",
			/\b(chicken|beef|pork|lamb|steak|salmon|prawns?|fish|bacon|sausages?|mince)\b/,
		],
		["Bakery", /\b(bread|rolls?|bagels?|croissants?|wraps?)\b/],
		[
			"Pantry",
			/\b(rice|pasta|flour|sugar|salt|pepper|oil|canned|tinned|cereal|coffee|tea|sauce|beans|lentils)\b/,
		],
		[
			"Produce",
			/\b(apples?|bananas?|oranges?|lemons?|limes?|tomatoes?|potatoes?|onions?|carrots?|lettuce|spinach|broccoli|avocados?|berries|strawberries|mushrooms?|cucumber|capsicum|garlic|ginger|fruit|vegetables?)\b/,
		],
	];
	return rules.find(([, re]) => re.test(n))?.[0] ?? "Other";
}
export function parseShopping(text: string | null): ShoppingData {
	if (text === null) return { version: 1, items: [] };
	const data = JSON.parse(text);
	if (!data || data.version !== 1 || !Array.isArray(data.items))
		throw new Error(
			"Unsupported shopping file. The file has not been changed.",
		);
	const ids = new Set<string>();
	for (const i of data.items) {
		if (
			!i ||
			!["id", "name", "store", "category", "quantity"].every(
				(k) => typeof i[k] === "string",
			) ||
			!i.id ||
			!i.name.trim() ||
			!i.store.trim() ||
			!i.category.trim() ||
			ids.has(i.id) ||
			typeof i.active !== "boolean" ||
			typeof i.checked !== "boolean" ||
			!Number.isSafeInteger(i.frequency) ||
			i.frequency < 1
		) {
			throw new Error("Invalid shopping file. The file has not been changed.");
		}
		ids.add(i.id);
	}
	return data;
}
export type ShoppingInput = Pick<
	ShoppingItem,
	"name" | "store" | "category" | "quantity"
>;
export function addShoppingItem(
	data: ShoppingData,
	input: ShoppingInput,
	id: string,
): void {
	const name = input.name.trim().replace(/\s+/g, " ");
	if (!name) throw new Error("Enter an item name.");
	const category = input.category.trim() || inferShoppingCategory(name);
	const store =
		input.store.trim() ||
		(category === "Hardware" ? "Hardware store" : "Grocery");
	const existing = data.items.find(
		(i) => key(i.name) === key(name) && key(i.store) === key(store),
	);
	if (existing?.active)
		throw new Error(
			"This item is already on the list for that store. Edit its quantity instead.",
		);
	if (existing) {
		Object.assign(existing, {
			name,
			category,
			store,
			quantity: input.quantity.trim(),
			active: true,
			checked: false,
			frequency: existing.frequency + 1,
		});
	} else
		data.items.push({
			id,
			name,
			category,
			store,
			quantity: input.quantity.trim(),
			active: true,
			checked: false,
			frequency: 1,
		});
}
export function shoppingStaples(data: ShoppingData): ShoppingItem[] {
	return data.items
		.filter((i) => !i.active)
		.sort(
			(a, b) =>
				b.frequency - a.frequency ||
				a.name.localeCompare(b.name) ||
				a.store.localeCompare(b.store),
		);
}
export function sortedShoppingItems(data: ShoppingData): ShoppingItem[] {
	const rank = (s: string) => {
		const i = SHOPPING_CATEGORIES.indexOf(s);
		return i < 0 ? SHOPPING_CATEGORIES.length : i;
	};
	return data.items
		.filter((i) => i.active)
		.sort(
			(a, b) =>
				Number(a.checked) - Number(b.checked) ||
				a.store.localeCompare(b.store) ||
				rank(a.category) - rank(b.category) ||
				a.category.localeCompare(b.category) ||
				a.name.localeCompare(b.name),
		);
}
/** Serialize local edits, re-read before every mutation, and reject observed external changes. */
export class ShoppingStore {
	private tail: Promise<unknown> = Promise.resolve();
	constructor(
		private read: () => Promise<string | null>,
		private write: (text: string) => Promise<void>,
	) {}
	async load(): Promise<ShoppingData> {
		return parseShopping(await this.read());
	}
	mutate(edit: (data: ShoppingData) => void): Promise<ShoppingData> {
		const work = this.tail.then(async () => {
			const before = await this.read();
			const data = parseShopping(before);
			edit(data);
			const output = JSON.stringify(data, null, 2) + "\n";
			parseShopping(output);
			if ((await this.read()) !== before)
				throw new Error(
					"Shopping changed on another device. Refresh and try again.",
				);
			await this.write(output);
			return data;
		});
		this.tail = work.catch(() => {});
		return work;
	}
}
