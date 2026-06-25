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

export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "lowest";

/**
 * Maps the non-normal priorities to their canonical emoji. These match the
 * official Obsidian Tasks plugin so its queries and sorts interpret the same
 * lines identically.
 */
export const PRIORITY_EMOJI: Record<Exclude<Priority, "normal">, string> = {
	highest: "🔺",
	high: "⏫",
	medium: "🔼",
	low: "🔽",
	lowest: "⏬",
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

	/* --- hierarchy & notes (filled by parseTasks) --- */
	/** Nested subtasks (deeper-indented task lines directly under this one). */
	children: Task[];
	/** Note text under this task (indentation stripped), or "". */
	notes: string;
	/** Indentation width with tabs expanded — used to build the tree. */
	indentWidth: number;
	/** Line range of this task's whole block: itself + notes + all descendants. */
	blockStart: number;
	blockEnd: number;
	/** Line range of the existing note lines, or null when there are none. */
	noteStart: number | null;
	noteEnd: number | null;
	/** Indent string used by this task's note lines (for round-tripping). */
	noteIndent: string | null;
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
	let description = body.replace(DUE_RE, " ").replace(DONE_RE, " ");
	for (const emoji of Object.values(PRIORITY_EMOJI)) {
		description = description.split(emoji).join(" ");
	}
	description = description.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();

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
		children: [],
		notes: "",
		indentWidth: indentWidthOf(indent),
		blockStart: lineIndex,
		blockEnd: lineIndex,
		noteStart: null,
		noteEnd: null,
		noteIndent: null,
	};
}

/** Indentation width with tabs counted as 4 columns. */
function indentWidthOf(indent: string): number {
	let w = 0;
	for (const ch of indent) w += ch === "\t" ? 4 : 1;
	return w;
}

function leadingWhitespace(line: string): string {
	const m = line.match(/^(\s*)/);
	return m ? m[1] : "";
}

function detectPriority(body: string): Priority {
	if (body.includes(PRIORITY_EMOJI.highest)) return "highest";
	if (body.includes(PRIORITY_EMOJI.high)) return "high";
	if (body.includes(PRIORITY_EMOJI.medium)) return "medium";
	if (body.includes(PRIORITY_EMOJI.lowest)) return "lowest";
	if (body.includes(PRIORITY_EMOJI.low)) return "low";
	return "normal";
}

/**
 * Parse the full file content into a task tree.
 *   - `tasks`: top-level tasks, each with nested `children` and `notes`.
 *   - `flat`: every task (including subtasks) in document order.
 *   - `lines`: the raw line array, so writers can merge edits without reparsing.
 *
 * Hierarchy is built from indentation. A task's notes are the indented,
 * non-task lines directly following it (before its first subtask).
 */
export function parseTasks(content: string): { tasks: Task[]; flat: Task[]; lines: string[] } {
	const lines = content.split("\n");
	const roots: Task[] = [];
	const flat: Task[] = [];
	const stack: Task[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const t = parseTask(line, i);

		if (t) {
			flat.push(t);
			while (stack.length && stack[stack.length - 1].indentWidth >= t.indentWidth) stack.pop();
			if (stack.length) stack[stack.length - 1].children.push(t);
			else roots.push(t);
			stack.push(t);
			continue;
		}

		// Blank lines don't close a block (notes may contain them).
		if (line.trim() === "") continue;

		const w = indentWidthOf(leadingWhitespace(line));
		while (stack.length && stack[stack.length - 1].indentWidth >= w) stack.pop();

		// An indented line under a task with no subtasks yet is that task's note.
		const top = stack[stack.length - 1];
		if (top && w > top.indentWidth && top.children.length === 0) {
			top.notes = top.notes ? top.notes + "\n" + line.trim() : line.trim();
			if (top.noteStart === null) {
				top.noteStart = i;
				top.noteIndent = leadingWhitespace(line);
			}
			top.noteEnd = i;
		}
	}

	for (const t of roots) computeBlockEnd(t);
	return { tasks: roots, flat, lines };
}

function computeBlockEnd(t: Task): number {
	let end = t.blockStart;
	if (t.noteEnd !== null) end = Math.max(end, t.noteEnd);
	for (const c of t.children) end = Math.max(end, computeBlockEnd(c));
	t.blockEnd = end;
	return end;
}

/** The indent string a child / note line of `task` should use. */
export function childIndentOf(task: Task): string {
	if (task.children.length) return task.children[0].indent;
	if (task.noteIndent) return task.noteIndent;
	return task.indent + "    ";
}

/** Find a task (anywhere in the tree) by exact original line text. */
export function findTaskByRaw(flat: Task[], raw: string): Task | null {
	return flat.find((t) => t.raw === raw) ?? null;
}

/**
 * Replace a task's note lines with `notes` (newline-separated). Empty `notes`
 * removes them. Pure: takes and returns the line array. `task` must come from a
 * parse of the SAME `lines`.
 */
export function setTaskNotes(lines: string[], task: Task, notes: string): string[] {
	const out = lines.slice();
	const indent = childIndentOf(task);
	const newLines = notes.trim() ? notes.split("\n").map((l) => indent + l.trim()) : [];

	if (task.noteStart !== null && task.noteEnd !== null) {
		out.splice(task.noteStart, task.noteEnd - task.noteStart + 1, ...newLines);
	} else if (newLines.length) {
		out.splice(task.blockStart + 1, 0, ...newLines);
	}
	return out;
}

/** Insert a serialised child line at the end of `parent`'s block. Pure. */
export function addChildTaskLine(lines: string[], parent: Task, childLine: string): string[] {
	const out = lines.slice();
	out.splice(parent.blockEnd + 1, 0, childLine);
	return out;
}

/** Remove a task and its entire block (notes + descendants). Pure. */
export function removeTaskBlock(lines: string[], task: Task): string[] {
	const out = lines.slice();
	out.splice(task.blockStart, task.blockEnd - task.blockStart + 1);
	return out;
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
