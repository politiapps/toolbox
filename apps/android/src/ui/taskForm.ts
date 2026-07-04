import { Priority, TaskInput } from "@toolbox/task-core";
import { el, field, toast } from "./dom";
import { recurrenceControl } from "./recurrenceControl";

export interface TaskFormInitial {
	description?: string;
	tag?: string;
	due?: string | null;
	priority?: Priority;
	recurrence?: string | null;
}

export interface TaskFormHandle {
	/** Validate + gather the form, or null (with a toast) if invalid. */
	collectInput(): TaskInput | null;
	focusDescription(): void;
}

const NEW_TAG = "__new__";
const NO_TAG = "__none__";

/** Render the shared task fields into `parent`. Used by add and detail modals. */
export function taskForm(parent: HTMLElement, knownTags: string[], initial: TaskFormInitial = {}): TaskFormHandle {
	let description = initial.description ?? "";
	let tag = initial.tag ?? "";
	let due: string | null = initial.due ?? null;
	let priority: Priority = initial.priority ?? "normal";
	let recurrence: string | null = initial.recurrence ?? null;

	const descInput = el("input", {
		cls: "form-input",
		attrs: { type: "text", placeholder: "What needs doing?", value: description },
	}) as HTMLInputElement;
	descInput.addEventListener("input", () => (description = descInput.value));
	field(parent, "Description", descInput);

	// Tag dropdown (recent-first) with a "create new" escape hatch.
	const tagOptions = [...knownTags];
	if (tag && !tagOptions.includes(tag)) tagOptions.unshift(tag);
	const tagSel = el("select", { cls: "form-input" }) as HTMLSelectElement;
	tagSel.append(el("option", { text: "No tag", attrs: { value: NO_TAG } }));
	for (const t of tagOptions) tagSel.append(el("option", { text: t, attrs: { value: t } }));
	tagSel.append(el("option", { text: "+ Create new tag", attrs: { value: NEW_TAG } }));
	tagSel.value = tag || NO_TAG;
	field(parent, "Tag", tagSel);

	const newTagInput = el("input", {
		cls: "form-input",
		attrs: { type: "text", placeholder: "#tag" },
	}) as HTMLInputElement;
	const newTagField = el("label", { cls: "form-field" });
	newTagField.append(el("span", { cls: "form-label", text: "New tag" }), newTagInput);
	newTagField.style.display = "none";
	parent.append(newTagField);
	newTagInput.addEventListener("input", () => (tag = newTagInput.value.trim()));
	tagSel.addEventListener("change", () => {
		if (tagSel.value === NEW_TAG) {
			tag = "";
			newTagField.style.display = "";
			newTagInput.focus();
		} else {
			tag = tagSel.value === NO_TAG ? "" : tagSel.value;
			newTagField.style.display = "none";
		}
	});

	const dueInput = el("input", { cls: "form-input", attrs: { type: "date" } }) as HTMLInputElement;
	if (due) dueInput.value = due;
	dueInput.addEventListener("input", () => (due = dueInput.value || null));
	field(parent, "Due date", dueInput);

	const prioSel = el("select", { cls: "form-input" }) as HTMLSelectElement;
	const prios: [string, string][] = [
		["normal", "None"],
		["highest", "🔺 Highest"],
		["high", "⏫ High"],
		["medium", "🔼 Medium"],
		["low", "🔽 Low"],
		["lowest", "⏬ Lowest"],
	];
	for (const [v, label] of prios) prioSel.append(el("option", { text: label, attrs: { value: v } }));
	prioSel.value = priority;
	prioSel.addEventListener("change", () => (priority = prioSel.value as Priority));
	field(parent, "Priority", prioSel);

	recurrenceControl(parent, recurrence, (text) => (recurrence = text));

	return {
		collectInput(): TaskInput | null {
			const desc = description.trim();
			if (!desc) {
				toast("Description is required.");
				return null;
			}
			let t = tag.trim();
			if (t && !t.startsWith("#")) t = "#" + t;
			return { description: desc, tags: t ? [t] : [], due, priority, recurrence };
		},
		focusDescription() {
			setTimeout(() => descInput.focus(), 50);
		},
	};
}
