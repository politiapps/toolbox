/**
 * taskParser.ts — Canonical task parsing and serialisation.
 *
 * STRICT RULE: This is the ONLY place in the plugin where task lines are
 * parsed from or serialised to markdown. No ad hoc parsing anywhere else.
 *
 * Supported task syntax (Obsidian Tasks plugin compatible):
 *   - [ ] Description #tag 📅 YYYY-MM-DD
 *   - [ ] Description #tag 📅 YYYY-MM-DD ⏫
 *   - [x] Description #tag 📅 YYYY-MM-DD ✅ YYYY-MM-DD
 *
 * Priority emojis: ⏫ highest, 🔼 high, 🔽 low, (none) = normal.
 */

export type Priority = "highest" | "high" | "normal" | "low";

/** Maps the non-normal priorities to their canonical emoji. */
export const PRIORITY_EMOJI: Record<Exclude<Priority, "normal">, string> = {
	highest: "⏫",
	high: "🔼",
	low: "🔽",
};

/** Emoji markers used in the task syntax. */
const DUE_EMOJI = "📅";
const DONE_EMOJI = "✅";

/** A single parsed task. `raw` is the exact original line (used to relocate it on write). */
export interface Task {
	/** Exact original line text, including indentation. */
	raw: string;
	/** Zero-based index of this line within the file at parse time. */
	lineIndex: number;
	/** Leading whitespace preserved so nested list items round-trip. */
	indent: string;
	completed: boolean;
	/** Description with tags / dates / priority stripped out. */
	description: string;
	/** Tags including the leading '#', in original order. */
	tags: string[];
	/** Due date as YYYY-MM-DD, or null. */
	due: string | null;
	priority: Priority;
	/** Completion date as YYYY-MM-DD, or null. */
	doneDate: string | null;
}

/** Fields used to build a brand new task or update an existing one. */
export interface TaskInput {
	description: string;
	tags: string[];
	due: string | null;
	priority: Priority;
	completed?: boolean;
	doneDate?: string | null;
}

const TASK_LINE_RE = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;
const DATE_RE = "(\\d{4}-\\d{2}-\\d{2})";
const DUE_RE = new RegExp(DUE_EMOJI + "\\s*" + DATE_RE);
const DONE_RE = new RegExp(DONE_EMOJI + "\\s*" + DATE_RE);
// Tags: '#' followed by at least one non-space, allowing letters, numbers,
// '-', '_', and '/' for nested tags. Must contain a non-numeric character.
const TAG_RE = /#[A-Za-z0-9_\-/]*[A-Za-z_\-/][A-Za-z0-9_\-/]*/g;

/**
 * Parse a single line. Returns a Task if the line is a task list item,
 * otherwise null (blank lines, headings, plain bullets, etc.).
 */
export function parseTask(line: string, lineIndex: number): Task | null {
	const m = line.match(TASK_LINE_RE);
	if (!m) return null;

	const indent = m[1];
	const completed = m[2].toLowerCase() === "x";
	let body = m[3];

	const dueMatch = body.match(DUE_RE);
	const due = dueMatch ? dueMatch[1] : null;

	const doneMatch = body.match(DONE_RE);
	const doneDate = doneMatch ? doneMatch[1] : null;

	const priority = detectPriority(body);

	const tags = body.match(TAG_RE) ?? [];

	// Strip every recognised token to leave a clean description.
	let description = body
		.replace(DUE_RE, " ")
		.replace(DONE_RE, " ")
		.replace(PRIORITY_EMOJI.highest, " ")
		.replace(PRIORITY_EMOJI.high, " ")
		.replace(PRIORITY_EMOJI.low, " ")
		.replace(TAG_RE, " ")
		.replace(/\s+/g, " ")
		.trim();

	return {
		raw: line,
		lineIndex,
		indent,
		completed,
		description,
		tags,
		due,
		priority,
		doneDate,
	};
}

function detectPriority(body: string): Priority {
	if (body.includes(PRIORITY_EMOJI.highest)) return "highest";
	if (body.includes(PRIORITY_EMOJI.high)) return "high";
	if (body.includes(PRIORITY_EMOJI.low)) return "low";
	return "normal";
}

/**
 * Parse the full file content into tasks and the raw line array.
 * The line array is returned so writers can merge edits without reparsing.
 */
export function parseTasks(content: string): { tasks: Task[]; lines: string[] } {
	const lines = content.split("\n");
	const tasks: Task[] = [];
	lines.forEach((line, i) => {
		const t = parseTask(line, i);
		if (t) tasks.push(t);
	});
	return { tasks, lines };
}

/**
 * Serialise a task back to a single markdown line in canonical token order:
 *   indent + "- [ ]/[x] " + description + tags + due + priority + done
 */
export function serializeTask(task: TaskInput & { indent?: string }): string {
	const indent = task.indent ?? "";
	const box = task.completed ? "[x]" : "[ ]";
	const parts: string[] = [task.description.trim()];

	for (const tag of task.tags) {
		const normalised = tag.startsWith("#") ? tag : "#" + tag;
		parts.push(normalised);
	}

	if (task.due) parts.push(`${DUE_EMOJI} ${task.due}`);

	if (task.priority !== "normal") parts.push(PRIORITY_EMOJI[task.priority]);

	if (task.completed && task.doneDate) parts.push(`${DONE_EMOJI} ${task.doneDate}`);

	return `${indent}- ${box} ${parts.filter((p) => p.length > 0).join(" ")}`;
}

/** Collect unique tags across tasks, preserving first-seen order. */
export function collectTags(tasks: Task[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tasks) {
		for (const tag of t.tags) {
			if (!seen.has(tag)) {
				seen.add(tag);
				out.push(tag);
			}
		}
	}
	return out;
}
