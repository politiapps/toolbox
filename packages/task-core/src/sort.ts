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
	due: "Due date, then priority",
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

/** Due-proximity buckets a due-sorted list is broken into, in display order. */
export type DueBucket = "overdue" | "today" | "upcoming" | "undated";

/** Header label for each bucket. */
export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
	overdue: "Overdue",
	today: "Today",
	upcoming: "Upcoming",
	undated: "No date",
};

/** Which bucket a task falls in, relative to `todayISO` (YYYY-MM-DD). */
export function dueBucket(task: Task, todayISO: string): DueBucket {
	if (!task.due) return "undated";
	// ISO dates compare correctly as strings — no Date math, no timezone traps.
	if (task.due < todayISO) return "overdue";
	if (task.due === todayISO) return "today";
	return "upcoming";
}

/** One bucket's tasks, kept in the order they arrived. */
export interface DueGroup {
	bucket: DueBucket;
	tasks: Task[];
}

/**
 * Split an already-due-sorted list into its proximity buckets, dropping empty
 * ones. Order-preserving: this only inserts boundaries, it never re-sorts.
 */
export function groupTasksByDue(tasks: Task[], todayISO: string): DueGroup[] {
	const order: DueBucket[] = ["overdue", "today", "upcoming", "undated"];
	const byBucket = new Map<DueBucket, Task[]>();
	for (const task of tasks) {
		const bucket = dueBucket(task, todayISO);
		const list = byBucket.get(bucket);
		if (list) list.push(task);
		else byBucket.set(bucket, [task]);
	}
	return order
		.filter((b) => byBucket.has(b))
		.map((bucket) => ({ bucket, tasks: byBucket.get(bucket) as Task[] }));
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
			// The date decides the order; priority breaks ties, so the most
			// urgent thing on a given day sits at the top of that day's run.
			return copy.sort((a, b) => byDue(a, b) || byPriority(a, b));
		case "priority":
			return copy.sort(byPriority);
		case "priority-due":
			return copy.sort((a, b) => byPriority(a, b) || byDue(a, b));
		case "file":
		default:
			return copy.sort((a, b) => a.lineIndex - b.lineIndex);
	}
}
