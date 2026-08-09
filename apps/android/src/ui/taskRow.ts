import { Task, Priority, PRIORITY_LABEL, orderSubtasks } from "@toolbox/task-core";
import { el, toast } from "./dom";
import { setIcon } from "./icons";
import {
	dueLabel,
	dueClass,
	dueState,
	formatDueShort,
	formatDueDisplay,
	formatFocus,
	priorityFilled,
	PRIORITY_SEGMENTS,
} from "../dates";
import { describeRecurrenceText } from "@toolbox/task-core";
import type { AppContext } from "./context";
import { openDetail } from "./detailModal";

// Per-session expand state for subtask trees, keyed by description (stable
// enough across the raw-line changes an edit causes). Subtasks fold by default
// — the list is a triage board of top-level commitments, not a full outline,
// and nothing urgent hides that way because dated subtasks are lifted into the
// list as their own rows (see `sectionCandidates` in task-core).
const expanded = new Set<string>();

/**
 * The due badge (or, once completed, the done date) in the shared
 * `.task-due-slot` treatment, or `null` when the task has neither. Exported
 * so the detail modal's subtask list can show the same due state a task row
 * does, not just the main list.
 */
export function dueSlotEl(task: Task): HTMLElement | null {
	if (task.completed && task.doneDate) {
		return el("span", {
			cls: "task-due-slot task-done-date",
			text: formatDueShort(task.doneDate),
			attrs: { "aria-label": `Done ${formatDueDisplay(task.doneDate)}` },
		});
	}
	if (task.due) {
		return el("span", {
			cls: `task-due-slot task-due ${dueClass(task.due)}`,
			text: dueLabel(task.due),
			attrs: { "aria-label": `Due ${formatDueDisplay(task.due)}` },
		});
	}
	return null;
}

/**
 * The priority chip (five-segment meter + label), or `null` for "normal".
 * Exported so the detail modal's subtask list can show it too — see
 * `dueSlotEl`.
 */
export function priorityChipEl(priority: Priority): HTMLElement | null {
	if (priority === "normal") return null;
	const chip = el("span", {
		cls: `task-priority prio-${priority}`,
		attrs: { "aria-label": `${PRIORITY_LABEL[priority]} priority` },
	});
	const meter = el("span", { cls: "task-priority-meter" });
	const lit = priorityFilled(priority);
	for (let i = 1; i <= PRIORITY_SEGMENTS; i++) {
		meter.append(el("span", { cls: i <= lit ? "task-priority-seg is-on" : "task-priority-seg" }));
	}
	chip.append(meter, el("span", { cls: "task-priority-label", text: PRIORITY_LABEL[priority] }));
	return chip;
}

/**
 * Render one task (and its subtasks) into `parent`.
 *
 * `parentTags` suppresses tag pills inherited from the row's parent when the
 * row is nested — a tag the parent already shows is inheritance, not new
 * information about the child. `promotedFrom` is set only on the *lifted* copy
 * of a dated subtask standing in the main list — it names the parent for the
 * breadcrumb and marks the row so it can't be mistaken for a top-level
 * commitment.
 */
export function renderTask(
	ctx: AppContext,
	parent: HTMLElement,
	task: Task,
	parentTags: string[] = [],
	promotedFrom?: Task
): void {
	const item = el("div", { cls: "task-item" });
	const rowCls = ["task-row"];
	if (task.completed) rowCls.push("is-completed");
	if (promotedFrom) rowCls.push("is-promoted");
	// Priority colours the row's left spine — readable while scanning, before
	// any label is read. Due state washes the row for the same reason.
	if (task.priority !== "normal") rowCls.push(`is-priority-${task.priority}`);
	if (!task.completed && task.due) rowCls.push(`is-due-${dueState(task.due)}`);
	const row = el("div", { cls: rowCls.join(" ") });

	const hasChildren = task.children.length > 0;
	const isCollapsed = hasChildren && !expanded.has(task.description);

	// The twisty's slot is reserved on *every* row, painted or not: without it a
	// childless row's checkbox sits a chevron's width left of a parent's, and the
	// checkbox column — the thing the eye runs down while ticking off — bends.
	if (hasChildren) {
		const twisty = el("button", {
			cls: isCollapsed ? "twisty is-collapsed" : "twisty",
			attrs: { "aria-label": "Toggle subtasks" },
		});
		setIcon(twisty, "chevron");
		twisty.addEventListener("click", () => {
			if (expanded.has(task.description)) expanded.delete(task.description);
			else expanded.add(task.description);
			void ctx.refresh();
		});
		row.append(twisty);
	} else {
		row.append(el("span", { cls: "twisty-spacer" }));
	}

	const cb = el("input", { cls: "task-checkbox", attrs: { type: "checkbox" } }) as HTMLInputElement;
	cb.checked = task.completed;
	cb.addEventListener("change", async () => {
		try {
			await ctx.service.toggleTask(task);
			await ctx.refresh();
		} catch (e) {
			toast(String((e as Error).message ?? e));
		}
	});
	row.append(cb);

	const main = el("div", { cls: "task-main" });

	// Title line = description (flexible) + due column (fixed, right). The due
	// column is what makes dates comparable: every row's date starts and ends at
	// the same x, so the eye scans a strip instead of hunting for a badge at a
	// different offset in every row. Priority owns the left edge, due the right.
	const titleLine = el("div", { cls: "task-title-line" });
	const title = el("div", { cls: "task-title", text: task.description });
	// A task with notes says so on the row — otherwise the only way to find out
	// is to open every task in turn.
	if (task.notes) {
		const note = el("span", { cls: "task-note-indicator", attrs: { "aria-label": "Has notes" } });
		setIcon(note, "notes");
		title.append(note);
	}
	titleLine.append(title);
	// The badge shows the short form ("Thu 25th") so the column stays narrow; the
	// full weekday survives in the label for screen readers.
	const dueSlot = dueSlotEl(task);
	if (dueSlot) titleLine.append(dueSlot);
	main.append(titleLine);

	const meta = el("div", { cls: "task-meta" });

	// On a lifted row the parent leads: it's the first thing you need in order
	// to place the task, and without it the row looks like a top-level task.
	if (promotedFrom) {
		const crumb = el("span", {
			cls: "task-parent-crumb",
			attrs: { "aria-label": `Subtask of ${promotedFrom.description}` },
		});
		crumb.append(
			el("span", { cls: "task-parent-crumb-mark", text: "↳" }),
			el("span", { cls: "task-parent-crumb-name", text: promotedFrom.description })
		);
		crumb.addEventListener("click", (e) => {
			e.stopPropagation();
			openDetail(ctx, promotedFrom);
		});
		meta.append(crumb);
	}

	// Priority leads the rest of the meta line — it's the other fact triage
	// turns on. The five-segment meter encodes rank as shape, so the level
	// survives without colour vision.
	const chip = priorityChipEl(task.priority);
	if (chip) meta.append(chip);

	// Skip a tag pill the parent already shows — it's inherited, not new.
	for (const tag of task.tags) {
		if (parentTags.includes(tag)) continue;
		meta.append(el("span", { cls: "task-tag", text: tag }));
	}
	if (task.recurrence) {
		const recur = el("span", { cls: "task-recur" });
		const ic = el("span", { cls: "task-recur-icon" });
		setIcon(ic, "repeat");
		recur.append(ic, el("span", { text: describeRecurrenceText(task.recurrence) }));
		meta.append(recur);
	}
	if (hasChildren) {
		const done = task.children.filter((c) => c.completed).length;
		meta.append(
			el("span", {
				cls: "task-progress",
				text: `${done}/${task.children.length}`,
				attrs: { "aria-label": `${done} of ${task.children.length} subtasks done` },
			})
		);
	}
	const focus = ctx.settings.taskFocusSeconds[task.description] ?? 0;
	if (focus > 0) {
		const f = el("span", { cls: "task-focus" });
		const ic = el("span", { cls: "task-focus-icon" });
		setIcon(ic, "timer");
		f.append(ic, el("span", { text: formatFocus(focus) }));
		meta.append(f);
	}
	if (meta.childElementCount > 0) main.append(meta);
	// The whole body of the row is the tap target for "open this task" — on a
	// touch screen the row *is* the button, so the target is the full block
	// rather than the description's own text box. The checkbox and twisty sit
	// outside it and keep their own actions.
	main.setAttribute("role", "button");
	main.addEventListener("click", () => openDetail(ctx, task));
	row.append(main);

	// No per-row action buttons. The sidebar can afford them because it reveals
	// them on hover — a phone has no hover, so they would sit there permanently
	// costing ~88px of a ~300px row, which is what broke descriptions across
	// lines mid-word. Tapping the row opens the detail sheet, which carries the
	// same actions (edit fields, notes, + Add subtask) with room to show them.
	item.append(row);

	if (hasChildren && !isCollapsed) {
		const childWrap = el("div", { cls: "task-children" });
		for (const child of orderSubtasks(task.children)) renderTask(ctx, childWrap, child, task.tags);
		item.append(childWrap);
	}

	parent.append(item);
}
