import { SORT_ORDER_LABELS, SortOrder } from "@toolbox/task-core";
import { el, field } from "./dom";
import { iconButton } from "./icons";
import { newId } from "../appState";
import type { AppContext } from "./context";

/** Full-screen settings: file location, sections, and Pomodoro config. */
export function renderSettings(ctx: AppContext, root: HTMLElement, onBack: () => void): void {
	root.replaceChildren();
	const screen = el("div", { cls: "screen settings-screen" });

	const header = el("div", { cls: "screen-header" });
	const back = iconButton("back", "Back");
	back.addEventListener("click", onBack);
	header.append(back, el("h2", { cls: "screen-title", text: "Settings" }));
	screen.append(header);

	const rerender = () => renderSettings(ctx, root, onBack);
	const persist = () => void ctx.persist();

	/* --------------------------- vault ---------------------------- */
	const vaultSection = el("div", { cls: "settings-group" });
	vaultSection.append(el("h3", { cls: "settings-heading", text: "Obsidian vault" }));
	const vaultRow = el("div", { cls: "settings-file-row" });
	vaultRow.append(
		el("span", { cls: "settings-file-name", text: ctx.settings.vault?.name ?? "No vault linked" })
	);
	const linkBtn = el("button", { cls: "btn", text: ctx.settings.vault ? "Change" : "Link vault" });
	linkBtn.addEventListener("click", async () => {
		await ctx.pickVault();
		rerender();
	});
	vaultRow.append(linkBtn);
	vaultSection.append(vaultRow);
	if (ctx.settings.vault) {
		vaultSection.append(
			el("p", {
				cls: "settings-hint",
				text: `Reading ${ctx.settings.tasksPath}. Categories mirror your Obsidian plugin and re-sync on every launch.`,
			})
		);
	}
	screen.append(vaultSection);

	/* -------------------------- sections -------------------------- */
	const secSection = el("div", { cls: "settings-group" });
	secSection.append(el("h3", { cls: "settings-heading", text: "Categories" }));

	// When a vault is linked, categories are mirrored from Obsidian and read-only.
	if (ctx.settings.vault) {
		secSection.append(
			el("p", { cls: "settings-hint", text: "Synced from Obsidian — edit these in the Obsidian plugin." })
		);
		if (ctx.settings.sections.length === 0) {
			secSection.append(
				el("p", { cls: "settings-hint", text: "No categories found in the vault's data.json yet." })
			);
		}
		for (const section of ctx.settings.sections) {
			const chip = el("div", { cls: "section-chip" });
			chip.append(
				el("span", { cls: "section-chip-name", text: section.name }),
				el("span", { cls: "section-chip-tag", text: section.tag })
			);
			secSection.append(chip);
		}
		screen.append(secSection);
		renderPomodoro(screen);
		root.append(screen);
		return;
	}

	// Manual fallback (no vault linked).
	ctx.settings.sections.forEach((section, index) => {
		const card = el("div", { cls: "section-editor" });

		const nameInput = el("input", {
			cls: "form-input",
			attrs: { type: "text", value: section.name, placeholder: "Section name" },
		}) as HTMLInputElement;
		nameInput.addEventListener("input", () => {
			section.name = nameInput.value;
			persist();
		});
		field(card, "Name", nameInput);

		const tagInput = el("input", {
			cls: "form-input",
			attrs: { type: "text", value: section.tag, placeholder: "#tag" },
		}) as HTMLInputElement;
		tagInput.addEventListener("input", () => {
			let v = tagInput.value.trim();
			if (v && !v.startsWith("#")) v = "#" + v;
			section.tag = v;
			persist();
		});
		field(card, "Tag", tagInput);

		const sortSel = el("select", { cls: "form-input" }) as HTMLSelectElement;
		(Object.keys(SORT_ORDER_LABELS) as SortOrder[]).forEach((key) =>
			sortSel.append(el("option", { text: SORT_ORDER_LABELS[key], attrs: { value: key } }))
		);
		sortSel.value = section.sort;
		sortSel.addEventListener("change", () => {
			section.sort = sortSel.value as SortOrder;
			persist();
		});
		field(card, "Sort", sortSel);

		const collapseRow = el("label", { cls: "settings-toggle-row" });
		const collapseCb = el("input", { attrs: { type: "checkbox" } }) as HTMLInputElement;
		collapseCb.checked = section.collapsedByDefault;
		collapseCb.addEventListener("change", () => {
			section.collapsedByDefault = collapseCb.checked;
			persist();
		});
		collapseRow.append(collapseCb, el("span", { text: "Collapsed by default" }));
		card.append(collapseRow);

		const rowActions = el("div", { cls: "section-editor-actions" });
		const up = iconButton("back", "Move up");
		up.classList.add("rotate-up");
		up.disabled = index === 0;
		up.addEventListener("click", () => {
			[ctx.settings.sections[index - 1], ctx.settings.sections[index]] = [
				ctx.settings.sections[index],
				ctx.settings.sections[index - 1],
			];
			persist();
			rerender();
		});
		const down = iconButton("back", "Move down");
		down.classList.add("rotate-down");
		down.disabled = index === ctx.settings.sections.length - 1;
		down.addEventListener("click", () => {
			[ctx.settings.sections[index + 1], ctx.settings.sections[index]] = [
				ctx.settings.sections[index],
				ctx.settings.sections[index + 1],
			];
			persist();
			rerender();
		});
		const del = iconButton("trash", "Delete section");
		del.classList.add("danger");
		del.addEventListener("click", () => {
			ctx.settings.sections.splice(index, 1);
			delete ctx.settings.collapseState[section.id];
			persist();
			rerender();
		});
		rowActions.append(up, down, del);
		card.append(rowActions);

		secSection.append(card);
	});

	const addSection = el("button", { cls: "btn btn-ghost", text: "+ Add section" });
	addSection.addEventListener("click", () => {
		ctx.settings.sections.push({
			id: newId("s"),
			name: "New section",
			tag: "#tag",
			sort: "due",
			collapsedByDefault: false,
		});
		persist();
		rerender();
	});
	secSection.append(addSection);
	screen.append(secSection);

	renderPomodoro(screen);
	root.append(screen);

	function renderPomodoro(parent: HTMLElement): void {
		const pom = el("div", { cls: "settings-group" });
		pom.append(el("h3", { cls: "settings-heading", text: "Pomodoro focus timer" }));

		const enableRow = el("label", { cls: "settings-toggle-row" });
		const enableCb = el("input", { attrs: { type: "checkbox" } }) as HTMLInputElement;
		enableCb.checked = ctx.settings.pomodoroConfig.enabled;
		enableCb.addEventListener("change", () => {
			ctx.settings.pomodoroConfig.enabled = enableCb.checked;
			persist();
		});
		enableRow.append(enableCb, el("span", { text: "Show the focus timer" }));
		pom.append(enableRow);

		const numField = (label: string, get: () => number, set: (n: number) => void) => {
			const input = el("input", {
				cls: "form-input",
				attrs: { type: "number", min: 1, value: get() },
			}) as HTMLInputElement;
			input.addEventListener("input", () => {
				const n = parseInt(input.value, 10);
				if (Number.isFinite(n) && n > 0) {
					set(n);
					persist();
				}
			});
			field(pom, label, input);
		};
		const pc = ctx.settings.pomodoroConfig;
		numField("Focus length (min)", () => pc.workMin, (n) => (pc.workMin = n));
		numField("Short break (min)", () => pc.shortMin, (n) => (pc.shortMin = n));
		numField("Long break (min)", () => pc.longMin, (n) => (pc.longMin = n));
		numField("Focus sessions before a long break", () => pc.longEvery, (n) => (pc.longEvery = n));
		parent.append(pom);
	}
}
