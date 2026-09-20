import {
	ShoppingStore,
	ShoppingData,
	ShoppingItem,
	addShoppingItem,
	shoppingStaples,
	sortedShoppingItems,
	SHOPPING_CATEGORIES,
	SHOPPING_STORES,
} from "../task-core/src/shopping";

const css = `
.toolbox-shopping{font:inherit;color:var(--text-normal,var(--text,inherit));max-width:780px;margin:auto;padding:16px;box-sizing:border-box}
.toolbox-shopping *{box-sizing:border-box}.toolbox-shopping h2{margin:0 0 8px}.toolbox-shopping p{opacity:.8}
.toolbox-shopping button,.toolbox-shopping input,.toolbox-shopping select{font:inherit;min-height:44px;border:1px solid var(--background-modifier-border,var(--border,#8886));border-radius:8px;padding:8px;background:var(--background-primary,var(--bg-elev,#fff));color:var(--text-normal,var(--text,#222));max-width:100%}
.toolbox-shopping button{cursor:pointer}.toolbox-shopping button:disabled{opacity:.5;cursor:default}
.toolbox-shopping :focus-visible{outline:2px solid var(--interactive-accent,var(--accent,#6577dd));outline-offset:2px}
.toolbox-shopping .shop-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.toolbox-shopping [aria-pressed=true]{background:var(--interactive-accent,var(--accent,#5968bf));color:var(--text-on-accent,#fff)}
.toolbox-shopping form{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;background:var(--background-secondary,var(--bg-elev-2,#8881));border-radius:12px}
.toolbox-shopping label{display:flex;flex-direction:column;gap:4px;min-width:0}.toolbox-shopping label:first-child{grid-column:1/-1}
.toolbox-shopping .shop-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--background-modifier-border,var(--border,#8884))}
.toolbox-shopping .shop-row label{flex:1;display:flex;flex-direction:row;align-items:center;overflow-wrap:anywhere}.toolbox-shopping .shop-row input{flex:none;width:24px;height:24px}
.toolbox-shopping .shop-row small{display:block;opacity:.7}.toolbox-shopping .shop-checked .shop-name{text-decoration:line-through;opacity:.65}
.toolbox-shopping .shop-status{min-height:24px}.toolbox-shopping .shop-error{color:var(--text-error,var(--danger,#c43939))}
.toolbox-shopping h3{margin:24px 0 4px;font-size:1.1em}.toolbox-shopping h4{margin:14px 0 0;opacity:.7;font-size:.9em}
@media(max-width:380px){.toolbox-shopping form{grid-template-columns:1fr}.toolbox-shopping{padding:8px}.toolbox-shopping .shop-row{flex-wrap:wrap}}
`;
function node<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	text?: string,
	cls?: string,
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (text) el.textContent = text;
	if (cls) el.className = cls;
	return el;
}
/** A single accessible shopping surface shared by both hosts. Returns cleanup. */
export function mountShopping(
	root: HTMLElement,
	store: ShoppingStore,
): () => void {
	const host = node("section", undefined, "toolbox-shopping");
	const style = node("style", css);
	host.append(style);
	root.append(host);
	const title = node("h2", "Shopping list");
	const status = node("div", "", "shop-status");
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const toolbar = node("div", undefined, "shop-toolbar");
	const content = node("div");
	let data: ShoppingData = { version: 1, items: [] };
	let busy = false;
	let disposed = false;
	let tab: "list" | "staples" = "list";
	let filter = "";
	let editing: ShoppingItem | undefined;
	const form = node("form");
	const field = (label: string, placeholder: string) => {
		const wrap = node("label", label);
		const input = node("input");
		input.placeholder = placeholder;
		wrap.append(input);
		form.append(wrap);
		return input;
	};
	const name = field("Item", "e.g. frozen peas");
	name.required = true;
	const quantity = field("Quantity / note", "e.g. 2 bags");
	const shop = field("Store", "Automatic (Grocery or Hardware store)");
	const category = field("Category", "Automatic");
	const uid = "shop-" + Math.random().toString(36).slice(2);
	const shops = node("datalist");
	shops.id = uid + "-stores";
	shop.setAttribute("list", shops.id);
	const categories = node("datalist");
	categories.id = uid + "-categories";
	category.setAttribute("list", categories.id);
	const submit = node("button", "Add item");
	submit.type = "submit";
	const cancel = node("button", "Cancel edit");
	cancel.type = "button";
	cancel.hidden = true;
	form.append(shops, categories, submit, cancel);
	const clearForm = () => {
		editing = undefined;
		form.reset();
		submit.textContent = "Add item";
		cancel.hidden = true;
	};
	cancel.onclick = clearForm;
	host.append(
		title,
		node(
			"p",
			"Grouped by store and aisle. Choose a category to override automatic sorting.",
		),
		form,
		toolbar,
		status,
		content,
	);
	const error = (e: unknown) => {
		status.textContent = e instanceof Error ? e.message : String(e);
		status.classList.add("shop-error");
	};
	async function run(
		work: () => Promise<ShoppingData>,
		after?: () => void,
	): Promise<void> {
		if (busy || disposed) return;
		busy = true;
		host.setAttribute("aria-busy", "true");
		host.querySelectorAll("button").forEach((b) => (b.disabled = true));
		try {
			const result = await work();
			if (disposed) return;
			data = result;
			status.classList.remove("shop-error");
			status.textContent = "";
			after?.();
			render();
		} catch (e) {
			if (!disposed) error(e);
		} finally {
			busy = false;
			host.removeAttribute("aria-busy");
			host.querySelectorAll("button").forEach((b) => (b.disabled = false));
		}
	}
	function current(d: ShoppingData, item: ShoppingItem): ShoppingItem {
		const fresh = d.items.find((i) => i.id === item.id);
		if (!fresh || JSON.stringify(fresh) !== JSON.stringify(item))
			throw new Error("This item changed. Refresh before trying again.");
		return fresh;
	}
	form.onsubmit = (e) => {
		e.preventDefault();
		const input = {
			name: name.value,
			quantity: quantity.value,
			store: shop.value,
			category: category.value,
		};
		const original = editing;
		void run(
			() =>
				store.mutate((d) => {
					if (original) {
						const item = current(d, original);
						const temp: ShoppingData = { version: 1, items: [] };
						addShoppingItem(temp, input, item.id);
						const next = temp.items[0];
						if (
							d.items.some(
								(i) =>
									i.id !== item.id &&
									i.name.toLowerCase() === next.name.toLowerCase() &&
									i.store.toLowerCase() === next.store.toLowerCase(),
							)
						)
							throw new Error("That item already exists for this store.");
						Object.assign(item, {
							name: next.name,
							store: next.store,
							category: next.category,
							quantity: next.quantity,
						});
					} else addShoppingItem(d, input, crypto.randomUUID());
				}),
			() => {
				clearForm();
				name.focus();
			},
		);
	};
	function button(
		parent: HTMLElement,
		text: string,
		action: () => void,
	): HTMLButtonElement {
		const b = node("button", text);
		b.type = "button";
		b.onclick = action;
		parent.append(b);
		return b;
	}
	function render(): void {
		toolbar.replaceChildren();
		content.replaceChildren();
		const opts = (list: HTMLDataListElement, values: string[]) => {
			list.replaceChildren();
			for (const value of new Set(values)) {
				const o = node("option");
				o.value = value;
				list.append(o);
			}
		};
		opts(shops, [...SHOPPING_STORES, ...data.items.map((i) => i.store)]);
		opts(categories, [
			...SHOPPING_CATEGORIES,
			...data.items.map((i) => i.category),
		]);
		for (const [value, label] of [
			["list", "List"],
			["staples", "Staples"],
		] as const) {
			const b = button(toolbar, label, () => {
				tab = value;
				render();
			});
			b.setAttribute("aria-pressed", String(tab === value));
		}
		button(toolbar, "Refresh", () => void run(() => store.load()));
		const select = node("select");
		select.setAttribute("aria-label", "Filter by store");
		for (const value of [
			"",
			...Array.from(new Set(data.items.map((i) => i.store))).sort(),
		]) {
			const o = node("option", value || "All stores");
			o.value = value;
			select.append(o);
		}
		select.value = filter;
		select.onchange = () => {
			filter = select.value;
			render();
		};
		toolbar.append(select);
		const source =
			tab === "list" ? sortedShoppingItems(data) : shoppingStaples(data);
		const items = source.filter((i) => !filter || i.store === filter);
		if (tab === "list") {
			const checked = items.filter((i) => i.checked);
			if (checked.length)
				button(
					toolbar,
					`Finish purchased (${checked.length})`,
					() =>
						void run(() =>
							store.mutate((d) => {
								for (const item of checked) {
									const fresh = current(d, item);
									fresh.active = false;
									fresh.checked = false;
								}
							}),
						),
				);
			status.textContent = `${items.filter((i) => !i.checked).length} items remaining`;
		} else
			status.textContent =
				"Previously listed items, most frequently added first. Items already on your list are hidden.";
		if (!items.length)
			content.append(
				node(
					"p",
					tab === "list"
						? "Your list is empty. Add an item above or choose Staples."
						: "No staples yet. Finish purchased items to make them available here.",
				),
			);
		let lastGroup = "";
		for (const item of items) {
			const group = `${item.checked ? "Purchased" : item.store} / ${item.category}`;
			if (tab === "list" && group !== lastGroup) {
				content.append(node("h3", group));
				lastGroup = group;
			}
			const row = node(
				"div",
				undefined,
				"shop-row" + (item.checked ? " shop-checked" : ""),
			);
			const label = node("label");
			const text = node("span", undefined, "shop-name");
			text.append(
				node("span", item.name + (item.quantity ? ` · ${item.quantity}` : "")),
			);
			if (tab === "list") {
				const check = node("input");
				check.type = "checkbox";
				check.checked = item.checked;
				check.setAttribute("aria-label", `Purchased ${item.name}`);
				check.onchange = () => {
					const checked = check.checked;
					check.checked = item.checked;
					void run(() =>
						store.mutate((d) => {
							current(d, item).checked = checked;
						}),
					);
				};
				label.append(check);
			}
			text.append(
				node(
					"small",
					tab === "staples"
						? `${item.store} · ${item.category} · Added ${item.frequency} times`
						: item.store,
				),
			);
			label.append(text);
			row.append(label);
			if (tab === "staples")
				button(
					row,
					"Add again",
					() =>
						void run(() =>
							store.mutate((d) => {
								current(d, item);
								addShoppingItem(d, item, crypto.randomUUID());
							}),
						),
				);
			button(row, "Edit", () => {
				editing = item;
				name.value = item.name;
				quantity.value = item.quantity;
				shop.value = item.store;
				category.value = item.category;
				submit.textContent = "Save item";
				cancel.hidden = false;
				name.focus();
			});
			if (tab === "list")
				button(
					row,
					"Remove",
					() =>
						void run(() =>
							store.mutate((d) => {
								const fresh = current(d, item);
								fresh.active = false;
								fresh.checked = false;
							}),
						),
				);
			content.append(row);
		}
	}
	render();
	void run(() => store.load());
	return () => {
		disposed = true;
		host.remove();
	};
}
