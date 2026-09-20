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

const modalStack: HTMLElement[] = [];

/**
 * A bottom-sheet modal. `render(content, close)` fills the sheet. Tapping the
 * scrim or the grabber closes it.
 */
export function openModal(render: (content: HTMLElement, close: () => void) => void): ModalHandle {
	const previousFocus = document.activeElement as HTMLElement | null;
	const scrim = el("div", { cls: "modal-scrim" });
	const sheet = el("div", { cls: "modal-sheet", attrs: { role: "dialog", "aria-modal": "true", tabindex: "-1" } });
	const grabber = el("div", { cls: "modal-grabber" });
	const content = el("div", { cls: "modal-content" });
	sheet.append(grabber, content);
	scrim.append(sheet);
	document.body.append(scrim);
	document.body.classList.add("modal-open");
	modalStack.push(sheet);

	let closed = false;
	const focusable = () => Array.from(sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(el => !el.hidden);
	const keydown = (event: KeyboardEvent) => {
		if (modalStack[modalStack.length - 1] !== sheet) return;
		if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
		if (event.key === "Tab") {
			const items = focusable();
			const first = items[0] ?? sheet;
			const last = items[items.length - 1] ?? sheet;
			if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
		}
	};
	const close = () => {
		if (closed) return;
		closed = true;
		const top = modalStack[modalStack.length - 1] === sheet;
		const index = modalStack.indexOf(sheet);
		if (index >= 0) modalStack.splice(index, 1);
		document.removeEventListener("keydown", keydown, true);
		scrim.classList.remove("is-open");
		scrim.style.pointerEvents = "none";
		sheet.setAttribute("aria-hidden", "true");
		sheet.inert = true;
		if (!modalStack.length) document.body.classList.remove("modal-open");
		if (top && previousFocus?.isConnected) previousFocus.focus();
		setTimeout(() => scrim.remove(), 220);
	};
	document.addEventListener("keydown", keydown, true);

	scrim.addEventListener("click", (e) => {
		if (e.target === scrim) close();
	});
	grabber.addEventListener("click", close);

	requestAnimationFrame(() => { if (!closed) scrim.classList.add("is-open"); });
	render(content, close);
	const heading = content.querySelector("h1,h2,h3");
	if (heading) {
		heading.id ||= "dialog-" + Math.random().toString(36).slice(2);
		sheet.setAttribute("aria-labelledby", heading.id);
	} else sheet.setAttribute("aria-label", "Task dialog");
	if (!sheet.contains(document.activeElement)) (focusable()[0] ?? sheet).focus();
	return { contentEl: content, close };
}

/** A labelled form row: label on top, control below. */
export function field(parent: HTMLElement, label: string, control: HTMLElement): void {
	const row = el("label", { cls: "form-field" });
	row.append(el("span", { cls: "form-label", text: label }), control);
	parent.append(row);
}
