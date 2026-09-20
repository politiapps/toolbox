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
import { sectionAccent } from "../task-core/src/presentation";

export interface ShoppingUI {
	platform: "obsidian" | "android";
	openModal: (render: (content: HTMLElement, close: () => void) => void) => {
		close: () => void;
	};
	collapseState: Record<string, boolean>;
	persist: () => Promise<void>;
}
export type ShoppingHandle = (() => void) & { openAdd: () => void };
// Structural adjustments only: rows, checkboxes, cards, pills and buttons use
// the host Tasks classes so changes to the task design also apply to Shopping.
const css = `
.toolbox-shopping{font:inherit;color:var(--text-normal,var(--text));min-width:0}
.shop-toolbar{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
.shop-toolbar select{max-width:50%;font:inherit;font-size:.8rem}
.shop-status{font-size:.8rem;color:var(--text-muted);margin:8px 0}.shop-status:empty{display:none}
.shop-error{color:var(--text-error,var(--danger))!important}
.shop-section-toggle{display:flex!important;align-items:center;gap:7px;flex:1;min-width:0;text-align:left;background:none!important;border:0!important;box-shadow:none!important;padding:0!important;color:inherit!important;height:auto!important;font:inherit}
.shop-section-toggle svg{width:14px;height:14px;flex:none}.shop-section-toggle[aria-expanded=false] svg{transform:rotate(-90deg)}
.shop-section-toggle span:first-of-type{overflow-wrap:anywhere}
.shop-title{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;height:auto!important;text-align:left;cursor:pointer;font-family:inherit;font-weight:inherit;color:var(--text-normal,var(--text));display:block;max-width:100%}
.shop-title.task-title{font-size:inherit}
.shop-title:focus-visible,.shop-section-toggle:focus-visible{outline:2px solid var(--interactive-accent,var(--accent));outline-offset:2px}
.shop-quantity{font-size:.75rem;color:var(--text-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.shop-dialog form{display:flex;flex-direction:column;gap:12px}.shop-dialog label{display:flex;flex-direction:column;gap:6px;font-size:.85rem}
.shop-dialog input{width:100%;font:inherit}.shop-dialog .shop-buttons{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}
.shop-dialog .shop-hint{font-size:.8rem;color:var(--text-muted)}
.shop-dialog .shop-staples{max-height:55vh;overflow:auto}.shop-staple-row{display:flex;align-items:center;gap:8px}.shop-staple-row>div{flex:1;min-width:0}
.shop-aisle{margin:10px 0 4px;padding:0 10px;font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}
.toolbox-shopping .shop-actions{align-self:center}.toolbox-shopping .shop-section-add{opacity:1}
@media(pointer:coarse){.toolbox-shopping .shop-actions{opacity:1}.toolbox-shopping .shop-actions button,.shop-dialog .shop-icon{min-width:44px;min-height:44px}.shop-section-toggle{min-height:44px}}
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
function icon(
	button: HTMLElement,
	kind: "plus" | "edit" | "refresh" | "chevron",
): void {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS(svg.namespaceURI, "path");
	path.setAttribute(
		"d",
		{
			plus: "M12 5v14M5 12h14",
			edit: "m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5",
			refresh:
				"M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3",
			chevron: "m6 9 6 6 6-6",
		}[kind],
	);
	svg.append(path);
	button.append(svg);
}

export function mountShopping(
	root: HTMLElement,
	store: ShoppingStore,
	ui: ShoppingUI,
): ShoppingHandle {
	const desktop = ui.platform === "obsidian";
	const cls = {
		section: desktop ? "tasks-section" : "section",
		head: desktop ? "tasks-section-header" : "section-head",
		sectionTitle: desktop ? "tasks-section-title" : "section-name",
		count: desktop ? "tasks-count-badge" : "section-count",
		body: desktop ? "tasks-section-body" : "section-body",
		row: desktop ? "tasks-row" : "task-row",
		checkbox: desktop ? "tasks-checkbox" : "task-checkbox",
		main: desktop ? "tasks-row-main" : "task-main",
		title: desktop ? "tasks-desc" : "task-title",
		meta: desktop ? "tasks-meta" : "task-meta",
		tag: desktop ? "tasks-tag-pill" : "task-tag",
		actions: desktop ? "tasks-actions" : "task-actions",
		icon: desktop ? "tasks-icon-button" : "icon-button",
		empty: desktop ? "tasks-empty" : "empty-note",
		button: desktop ? "tasks-view-chip" : "view-chip",
		primary: desktop ? "mod-cta" : "btn btn-cta",
	};
	const host = node("section", undefined, "toolbox-shopping");
	host.append(node("style", css));
	root.append(host);
	const toolbar = node("div", undefined, "shop-toolbar");
	const status = node("div", undefined, "shop-status");
	status.setAttribute("role", "status");
	const content = node("div");
	host.append(toolbar, status, content);
	let data: ShoppingData = { version: 1, items: [] };
	let busy = false;
	let disposed = false;
	let filter = "";
	let dialog: { close: () => void } | undefined;
	let dialogError: HTMLElement | undefined;
	let dialogRoot: HTMLElement | undefined;
	const button = (
		parent: HTMLElement,
		text: string,
		action: () => void,
		className = cls.button,
	) => {
		const b = node("button", text, className);
		b.type = "button";
		b.onclick = action;
		parent.append(b);
		return b;
	};
	const iconButton = (
		parent: HTMLElement,
		label: string,
		kind: "plus" | "edit" | "refresh",
		action: () => void,
	) => {
		const b = button(parent, "", action, cls.icon + " shop-icon");
		b.setAttribute("aria-label", label);
		b.title = label;
		icon(b, kind);
		return b;
	};
	function showDialog(
		title: string,
		render: (body: HTMLElement, close: () => void) => void,
	): void {
		if (busy || disposed) return;
		dialog?.close();
		const returnLabel = document.activeElement?.getAttribute("aria-label");
		dialog = ui.openModal((container, hostClose) => {
			const close = () => {
				hostClose();
				const target = returnLabel
					? Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
							(b) => b.getAttribute("aria-label") === returnLabel,
						)
					: undefined;
				(
					target ??
					root.querySelector<HTMLButtonElement>(
						'[aria-label="Add shopping item"]',
					)
				)?.focus();
			};
			const body = node("div", undefined, "shop-dialog");
			body.append(node("style", css), node("h3", title, "modal-title"));
			dialogRoot = body;
			dialogError = node("div", undefined, "shop-status shop-error");
			dialogError.setAttribute("role", "alert");
			container.append(body);
			body.append(dialogError);
			render(body, close);
		});
	}
	function error(e: unknown): void {
		const message = e instanceof Error ? e.message : String(e);
		status.textContent = message;
		status.classList.add("shop-error");
		if (dialogError?.isConnected) dialogError.textContent = message;
	}
	async function run(
		work: () => Promise<ShoppingData>,
		after?: () => void,
	): Promise<void> {
		if (busy || disposed) return;
		busy = true;
		host.setAttribute("aria-busy", "true");
		const controls = [
			...Array.from(
				host.querySelectorAll<
					HTMLButtonElement | HTMLInputElement | HTMLSelectElement
				>("button,input,select"),
			),
			...Array.from(
				dialogRoot?.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
					"button,input",
				) ?? [],
			),
		];
		controls.forEach((b) => (b.disabled = true));
		try {
			const result = await work();
			if (disposed) return;
			data = result;
			status.classList.remove("shop-error");
			status.textContent = "";
			if (dialogError) dialogError.textContent = "";
			render();
			after?.();
		} catch (e) {
			if (!disposed) error(e);
		} finally {
			busy = false;
			host.removeAttribute("aria-busy");
			controls.forEach((b) => (b.disabled = false));
		}
	}
	function current(d: ShoppingData, item: ShoppingItem): ShoppingItem {
		const fresh = d.items.find((i) => i.id === item.id);
		if (!fresh || JSON.stringify(fresh) !== JSON.stringify(item))
			throw new Error(
				"This item changed. Close this dialog, refresh, and try again.",
			);
		return fresh;
	}
	function editItem(original?: ShoppingItem, prefillStore = filter): void {
		showDialog(
			original ? "Edit shopping item" : "Add shopping item",
			(body, close) => {
				const form = node("form");
				body.append(form);
				const field = (label: string, value: string, placeholder = "") => {
					const wrap = node("label", label, "form-field");
					const input = node("input", undefined, "form-input");
					input.value = value;
					input.placeholder = placeholder;
					wrap.append(input);
					form.append(wrap);
					return input;
				};
				const name = field("Item", original?.name ?? "", "e.g. frozen peas");
				name.required = true;
				const quantity = field(
					"Quantity / note",
					original?.quantity ?? "",
					"e.g. 2 bags",
				);
				const shop = field(
					"Store",
					original?.store ?? prefillStore,
					"Automatic",
				);
				const category = field(
					"Category",
					original?.category ?? "",
					"Automatic",
				);
				for (const [input, values] of [
					[shop, [...SHOPPING_STORES, ...data.items.map((i) => i.store)]],
					[
						category,
						[...SHOPPING_CATEGORIES, ...data.items.map((i) => i.category)],
					],
				] as [HTMLInputElement, string[]][]) {
					const list = node("datalist");
					list.id = "shop-" + crypto.randomUUID();
					input.setAttribute("list", list.id);
					for (const value of new Set(values)) {
						const o = node("option");
						o.value = value;
						list.append(o);
					}
					form.append(list);
				}
				form.append(
					node(
						"p",
						"Leave store and category blank for automatic grouping.",
						"shop-hint",
					),
				);
				const buttons = node("div", undefined, "shop-buttons modal-buttons");
				if (original) {
					const remove = button(buttons, "Remove from list", () => {
						if (remove.textContent !== "Confirm remove") {
							remove.textContent = "Confirm remove";
							return;
						}
						void run(
							() =>
								store.mutate((d) => {
									const item = current(d, original);
									item.active = false;
									item.checked = false;
								}),
							close,
						);
					});
				}
				button(buttons, "Cancel", close);
				const save = button(
					buttons,
					original ? "Save item" : "Add item",
					() => {},
					cls.primary,
				);
				save.type = "submit";
				form.append(buttons);
				form.onsubmit = (e) => {
					e.preventDefault();
					const input = {
						name: name.value,
						quantity: quantity.value,
						store: shop.value,
						category: category.value,
					};
					void run(
						() =>
							store.mutate((d) => {
								if (!original) {
									addShoppingItem(d, input, crypto.randomUUID());
									return;
								}
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
									quantity: next.quantity,
									store: next.store,
									category: next.category,
								});
							}),
						close,
					);
				};
				name.focus();
			},
		);
	}
	function openStaples(): void {
		showDialog("Staples", (body, close) => {
			body.append(
				node(
					"p",
					"Previously listed items, most frequently added first.",
					"shop-hint",
				),
			);
			const search = node("input", undefined, "form-input");
			search.type = "search";
			search.placeholder = "Find a staple";
			search.setAttribute("aria-label", "Find a staple");
			body.append(search);
			const list = node("div", undefined, "shop-staples");
			body.append(list);
			const renderStaples = () => {
				list.replaceChildren();
				const items = shoppingStaples(data).filter(
					(i) =>
						(!filter || i.store === filter) &&
						`${i.name} ${i.store} ${i.category}`
							.toLowerCase()
							.includes(search.value.toLowerCase()),
				);
				if (!items.length)
					list.append(
						node(
							"p",
							"No matching staples. Removed and finished items appear here.",
							cls.empty,
						),
					);
				for (const item of items) {
					const row = node("div", undefined, cls.row + " shop-staple-row");
					const main = node("div");
					main.append(
						node("span", item.name, cls.title),
						node(
							"div",
							`${item.store} · ${item.category} · Added ${item.frequency} times`,
							"shop-hint",
						),
					);
					row.append(main);
					iconButton(
						row,
						`Add ${item.name} again`,
						"plus",
						() =>
							void run(
								() =>
									store.mutate((d) => {
										current(d, item);
										addShoppingItem(d, item, crypto.randomUUID());
									}),
								() => {
									renderStaples();
									search.focus();
								},
							),
					);
					list.append(row);
				}
			};
			search.oninput = renderStaples;
			renderStaples();
			button(body, "Done", close);
			search.focus();
		});
	}
	function renderRow(parent: HTMLElement, item: ShoppingItem): void {
		const row = node(
			"div",
			undefined,
			cls.row + (item.checked ? " is-completed" : ""),
		);
		row.append(
			node("span", undefined, desktop ? "tasks-twisty" : "twisty-spacer"),
		);
		const check = node("input", undefined, cls.checkbox);
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
		row.append(check);
		const main = node("div", undefined, cls.main);
		const title = button(
			main,
			item.name,
			() => editItem(item),
			cls.title + " shop-title",
		);
		title.setAttribute("aria-label", `Edit ${item.name}`);
		const meta = node("div", undefined, cls.meta);
		if (item.quantity)
			meta.append(node("span", item.quantity, "shop-quantity"));
		if (item.checked)
			meta.append(
				node("span", item.store, cls.tag),
				node("span", item.category, cls.tag),
			);
		main.append(meta);
		row.append(main);
		const actions = node("div", undefined, cls.actions + " shop-actions");
		iconButton(actions, `Edit ${item.name}`, "edit", () => editItem(item));
		row.append(actions);
		parent.append(row);
	}
	function renderSection(
		title: string,
		items: ShoppingItem[],
		purchased = false,
	): void {
		const id = purchased ? "shopping:purchased" : "shopping:store:" + title;
		const collapsed = ui.collapseState[id] ?? purchased;
		const section = node(
			"div",
			undefined,
			cls.section +
				(purchased
					? desktop
						? " tasks-section-completed"
						: " section-completed"
					: ""),
		);
		section.style.setProperty("--section-accent", sectionAccent(id));
		const header = node("div", undefined, cls.head);
		const toggle = button(
			header,
			"",
			() => {
				ui.collapseState[id] = !collapsed;
				void ui.persist().catch(error);
				render();
			},
			"shop-section-toggle",
		);
		toggle.setAttribute("aria-expanded", String(!collapsed));
		icon(toggle, "chevron");
		toggle.append(
			node("span", title, cls.sectionTitle),
			node("span", String(items.length), cls.count),
		);
		if (!purchased) {
			const add = iconButton(header, `Add item to ${title}`, "plus", () =>
				editItem(undefined, title),
			);
			add.classList.add("shop-section-add");
		}
		section.append(header);
		if (!collapsed) {
			const body = node("div", undefined, cls.body);
			let category = "";
			for (const item of items) {
				if (!purchased && category !== item.category) {
					body.append(
						node(
							"div",
							item.category,
							desktop ? "tasks-due-group shop-aisle" : "due-group shop-aisle",
						),
					);
					category = item.category;
				}
				renderRow(body, item);
			}
			section.append(body);
		}
		content.append(section);
	}
	function render(): void {
		toolbar.replaceChildren();
		content.replaceChildren();
		const select = node(
			"select",
			undefined,
			desktop ? "dropdown" : "form-input",
		);
		select.setAttribute("aria-label", "Filter by store");
		for (const value of [
			"",
			...Array.from(new Set(data.items.map((i) => i.store))).sort(),
		]) {
			const o = node("option", value || "All stores");
			o.value = value;
			select.append(o);
		}
		if (filter && !data.items.some((i) => i.store === filter)) filter = "";
		select.value = filter;
		select.onchange = () => {
			filter = select.value;
			render();
		};
		toolbar.append(select);
		button(toolbar, "Staples", openStaples);
		iconButton(
			toolbar,
			"Refresh shopping list",
			"refresh",
			() => void run(() => store.load()),
		);
		const items = sortedShoppingItems(data).filter(
			(i) => !filter || i.store === filter,
		);
		const active = items.filter((i) => !i.checked);
		const checked = items.filter((i) => i.checked);
		status.textContent = `${active.length} items remaining`;
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
		if (!items.length) {
			content.append(
				node(
					"div",
					"No shopping items. Use + to add an item or choose Staples.",
					cls.empty,
				),
			);
		}
		for (const name of new Set(active.map((i) => i.store)))
			renderSection(
				name,
				active.filter((i) => i.store === name),
			);
		if (checked.length) renderSection("Purchased", checked, true);
	}
	render();
	void run(() => store.load());
	return Object.assign(
		() => {
			disposed = true;
			dialog?.close();
			host.remove();
		},
		{ openAdd: () => editItem() },
	);
}
