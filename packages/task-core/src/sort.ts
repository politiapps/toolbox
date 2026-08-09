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

/** Whether a tag list contains `tag` (leading '#' optional on the argument). */
export function tagListHasTag(tags: string[], tag: string): boolean {
	if (!tag) return false;
	const normalised = tag.startsWith("#") ? tag : "#" + tag;
	return tags.includes(normalised);
}

/** Whether a task carries `tag` (leading '#' optional on the argument). */
export function taskHasTag(task: Task, tag: string): boolean {
	return tagListHasTag(task.tags, tag);
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

/** One row a section may render, with the tags it matches sections by. */
export interface SectionCandidate {
	task: Task;
	/**
	 * The task's own tags plus every ancestor's, de-duplicated in
	 * outermost-first order. **Nesting is what tag inheritance means**: a
	 * subtask belongs to its parent's project whether or not anyone retyped the
	 * tag on it. Matching on raw `task.tags` instead would drop a hand-written
	 * untagged subtask out of every section.
	 */
	tags: string[];
	/**
	 * The immediate parent when this row is a dated subtask lifted out to stand
	 * on its own; null for a genuine top-level task. The view shows it as a
	 * breadcrumb.
	 */
	parent: Task | null;
}

/**
 * Flatten a task tree into the rows a section list should consider: every
 * incomplete top-level task, plus every incomplete **dated** subtask at any
 * depth, lifted to stand on its own.
 *
 * A subtask with a due date is a scheduled commitment in its own right — it has
 * to appear where its date puts it, not only folded inside a parent that may
 * itself be undated. The lifted row is a *second view* of the same task: it
 * still renders nested under its parent too, so a parent's subtask list stays a
 * complete plan. Note that the parent does **not** inherit the child's date in
 * return (see `dueBucket`) — the lifted row already carries that urgency.
 *
 * Both the plugin and the Android app build their sections from this, so the
 * two can't drift on which tasks are listed or which tags they match.
 */
export function sectionCandidates(tasks: Task[]): SectionCandidate[] {
	const out: SectionCandidate[] = [];
	const merge = (inherited: string[], own: string[]): string[] => [
		...new Set([...inherited, ...own]),
	];

	const walk = (task: Task, inherited: string[], parent: Task | null): void => {
		const tags = merge(inherited, task.tags);
		// Top-level tasks always list; nested ones only once they're scheduled.
		if (!task.completed && (parent === null || task.due)) {
			out.push({ task, tags, parent });
		}
		for (const child of task.children) walk(child, tags, task);
	};

	for (const root of tasks) walk(root, [], null);
	return out;
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

/**
 * Which bucket a task falls in, relative to `todayISO` (YYYY-MM-DD).
 *
 * Strictly the task's *own* date. A parent does not inherit a subtask's
 * urgency, because `scheduledSubtasks()` lifts that subtask into the list as
 * its own row — rolling the date up as well would file two rows under Overdue
 * for one piece of late work.
 */
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
