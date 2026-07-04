/**
 * sort.ts — Sort orders, priority ranking, and pure task-list ordering helpers.
 *
 * Extracted from the plugin's view layer so the Obsidian plugin and the Android
 * app order tasks identically. Pure — no vault, no DOM. All ordering the user
 * sees flows through here.
 */

import { Task, Priority } from "./taskParser";

/** The section sort orders a user can choose (canonical definition). */
export type SortOrder = "due" | "priority-due" | "priority" | "file";

/** Human labels for each sort order (settings + section headers). */
export const SORT_ORDER_LABELS: Record<SortOrder, string> = {
	due: "Due date",
	"priority-due": "Priority, then due date",
	priority: "Priority only",
	file: "File order",
};

/** Sort weight for each priority (lower = higher priority, sorts first). */
export const PRIORITY_RANK: Record<Priority, number> = {
	highest: 0,
	high: 1,
	medium: 2,
	normal: 3,
	low: 4,
	lowest: 5,
};

/** Display label for each priority. */
export const PRIORITY_LABEL: Record<Priority, string> = {
	highest: "Highest",
	high: "High",
	medium: "Medium",
	normal: "Normal",
	low: "Low",
	lowest: "Lowest",
};

/** Whether a task carries `tag` (leading '#' optional on the argument). */
export function taskHasTag(task: Task, tag: string): boolean {
	if (!tag) return false;
	const normalised = tag.startsWith("#") ? tag : "#" + tag;
	return task.tags.includes(normalised);
}

/** Total number of descendant tasks (subtasks at any depth). */
export function countDescendants(task: Task): number {
	let n = task.children.length;
	for (const c of task.children) n += countDescendants(c);
	return n;
}

/**
 * Order subtasks so completed ones sink to the bottom of the list, keeping
 * incomplete and completed each in their original document order (stable).
 */
export function orderSubtasks(children: Task[]): Task[] {
	return [...children].sort((a, b) => Number(a.completed) - Number(b.completed));
}

/** Return a new array of `tasks` ordered by `order`. Stable within ties. */
export function sortTasks(tasks: Task[], order: SortOrder): Task[] {
	const copy = [...tasks];
	const byDue = (a: Task, b: Task): number => {
		if (a.due && b.due) return a.due.localeCompare(b.due);
		if (a.due) return -1; // dated tasks before undated
		if (b.due) return 1;
		return 0;
	};
	const byPriority = (a: Task, b: Task): number =>
		PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

	switch (order) {
		case "due":
			return copy.sort(byDue);
		case "priority":
			return copy.sort(byPriority);
		case "priority-due":
			return copy.sort((a, b) => byPriority(a, b) || byDue(a, b));
		case "file":
		default:
			return copy.sort((a, b) => a.lineIndex - b.lineIndex);
	}
}
