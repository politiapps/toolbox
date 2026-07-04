/** Tiny DOM helpers — the app's stand-in for Obsidian's createEl/createDiv. */

type Attrs = Record<string, string | number | boolean | undefined>;

interface ElOpts {
	cls?: string | string[];
	text?: string;
	attrs?: Attrs;
}

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	opts: ElOpts = {},
	children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (opts.cls) node.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
	if (opts.text !== undefined) node.textContent = opts.text;
	if (opts.attrs) {
		for (const [k, v] of Object.entries(opts.attrs)) {
			if (v === undefined || v === false) continue;
			node.setAttribute(k, v === true ? "" : String(v));
		}
	}
	for (const c of children) node.append(c);
	return node;
}

export function clear(node: HTMLElement): void {
	node.replaceChildren();
}

/** A transient toast at the bottom of the screen. */
export function toast(message: string): void {
	const t = el("div", { cls: "toast", text: message });
	document.body.append(t);
	requestAnimationFrame(() => t.classList.add("is-visible"));
	setTimeout(() => {
		t.classList.remove("is-visible");
		setTimeout(() => t.remove(), 250);
	}, 2600);
}

export interface ModalHandle {
	contentEl: HTMLElement;
	close: () => void;
}

/**
 * A bottom-sheet modal. `render(content, close)` fills the sheet. Tapping the
 * scrim or the grabber closes it.
 */
export function openModal(render: (content: HTMLElement, close: () => void) => void): ModalHandle {
	const scrim = el("div", { cls: "modal-scrim" });
	const sheet = el("div", { cls: "modal-sheet" });
	const grabber = el("div", { cls: "modal-grabber" });
	const content = el("div", { cls: "modal-content" });
	sheet.append(grabber, content);
	scrim.append(sheet);
	document.body.append(scrim);
	document.body.classList.add("modal-open");

	const close = () => {
		scrim.classList.remove("is-open");
		document.body.classList.remove("modal-open");
		setTimeout(() => scrim.remove(), 220);
	};

	scrim.addEventListener("click", (e) => {
		if (e.target === scrim) close();
	});
	grabber.addEventListener("click", close);

	requestAnimationFrame(() => scrim.classList.add("is-open"));
	render(content, close);
	return { contentEl: content, close };
}

/** A labelled form row: label on top, control below. */
export function field(parent: HTMLElement, label: string, control: HTMLElement): void {
	const row = el("label", { cls: "form-field" });
	row.append(el("span", { cls: "form-label", text: label }), control);
	parent.append(row);
}
