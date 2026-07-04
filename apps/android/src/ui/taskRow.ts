import { Task, PRIORITY_LABEL, orderSubtasks } from "@toolbox/task-core";
import { el, toast } from "./dom";
import { setIcon, iconButton } from "./icons";
import { dueLabel, dueClass, formatFocus } from "../dates";
import { describeRecurrenceText } from "@toolbox/task-core";
import type { AppContext } from "./context";
import { openDetail } from "./detailModal";
import { openAddSubtask } from "./addModal";

// Per-session collapse state for subtask trees, keyed by description (stable
// enough across the raw-line changes an edit causes).
const collapsed = new Set<string>();

/** Render one task (and its subtasks) into `parent`. */
export function renderTask(ctx: AppContext, parent: HTMLElement, task: Task, depth = 0): void {
	const item = el("div", { cls: "task-item" });
	const row = el("div", { cls: task.completed ? "task-row is-completed" : "task-row" });

	const hasChildren = task.children.length > 0;
	const isCollapsed = collapsed.has(task.description);

	if (hasChildren) {
		const twisty = el("button", {
			cls: isCollapsed ? "twisty is-collapsed" : "twisty",
			attrs: { "aria-label": "Toggle subtasks" },
		});
		setIcon(twisty, "chevron");
		twisty.addEventListener("click", () => {
			if (collapsed.has(task.description)) collapsed.delete(task.description);
			else collapsed.add(task.description);
			void ctx.refresh();
		});
		row.append(twisty);
	} else if (depth > 0) {
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
	const title = el("div", { cls: "task-title", text: task.description });
	title.addEventListener("click", () => openDetail(ctx, task));
	main.append(title);

	const meta = el("div", { cls: "task-meta" });
	for (const tag of task.tags) meta.append(el("span", { cls: "task-tag", text: tag }));
	if (task.due) meta.append(el("span", { cls: `task-due ${dueClass(task.due)}`, text: dueLabel(task.due) }));
	if (task.recurrence) {
		const recur = el("span", { cls: "task-recur" });
		const ic = el("span", { cls: "task-recur-icon" });
		setIcon(ic, "repeat");
		recur.append(ic, el("span", { text: describeRecurrenceText(task.recurrence) }));
		meta.append(recur);
	}
	if (hasChildren) {
		const done = task.children.filter((c) => c.completed).length;
		meta.append(el("span", { cls: "task-progress", text: `${done}/${task.children.length}` }));
	}
	if (task.priority !== "normal") {
		meta.append(
			el("span", {
				cls: `task-priority prio-${task.priority}`,
				text: PRIORITY_LABEL[task.priority],
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
	row.append(main);

	const actions = el("div", { cls: "task-actions" });
	const addBtn = iconButton("plus", "Add subtask");
	addBtn.addEventListener("click", () => openAddSubtask(ctx, task));
	const editBtn = iconButton("pencil", "Open task");
	editBtn.addEventListener("click", () => openDetail(ctx, task));
	actions.append(addBtn, editBtn);
	row.append(actions);

	item.append(row);

	if (hasChildren && !isCollapsed) {
		const childWrap = el("div", { cls: "task-children" });
		for (const child of orderSubtasks(task.children)) renderTask(ctx, childWrap, child, depth + 1);
		item.append(childWrap);
	}

	parent.append(item);
}
