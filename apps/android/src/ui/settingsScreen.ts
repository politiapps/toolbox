import { SORT_ORDER_LABELS, SortOrder } from "@toolbox/task-core";
import { el, field, toast } from "./dom";
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

	/* ------------------------- tasks file ------------------------- */
	const fileSection = el("div", { cls: "settings-group" });
	fileSection.append(el("h3", { cls: "settings-heading", text: "Tasks file" }));
	const fileRow = el("div", { cls: "settings-file-row" });
	fileRow.append(
		el("span", { cls: "settings-file-name", text: ctx.settings.file?.name ?? "No file selected" })
	);
	const chooseBtn = el("button", { cls: "btn", text: ctx.settings.file ? "Change" : "Choose file" });
	chooseBtn.addEventListener("click", async () => {
		await ctx.pickFile();
		rerender();
	});
	fileRow.append(chooseBtn);
	fileSection.append(fileRow);
	screen.append(fileSection);

	/* -------------------------- sections -------------------------- */
	const secSection = el("div", { cls: "settings-group" });
	secSection.append(el("h3", { cls: "settings-heading", text: "Sections" }));

	// Mirror the Obsidian plugin: import its data.json sections in one tap.
	const importRow = el("div", { cls: "settings-import" });
	const linked = ctx.settings.obsidianConfig;
	importRow.append(
		el("p", {
			cls: "settings-hint",
			text: linked
				? `Linked to ${linked.name} — categories re-sync from Obsidian each time you open the app.`
				: "Match your Obsidian categories: pick .obsidian/plugins/toolbox/data.json (in your vault). After that it re-syncs automatically on launch.",
		})
	);
	const importBtn = el("button", {
		cls: "btn",
		text: linked ? "Re-link Obsidian data.json" : "Import sections from Obsidian",
	});
	importBtn.addEventListener("click", async () => {
		const n = await ctx.importObsidianSettings();
		if (n === null) {
			toast("No sections found in that file.");
			return;
		}
		toast(`Imported ${n} section${n === 1 ? "" : "s"}.`);
		rerender();
	});
	importRow.append(importBtn);
	secSection.append(importRow);

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

	/* -------------------------- pomodoro -------------------------- */
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
	screen.append(pom);

	root.append(screen);
}
