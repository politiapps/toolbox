/**
 * taskService.ts — every read and write of the tasks file, ported from the
 * plugin's taskView file-IO + actions onto a StorageAdapter.
 *
 * Like the plugin, every mutation is read-before-write: re-read the file, locate
 * the target by its exact raw line in a fresh parse, apply a pure @toolbox/task-core
 * editor, then write the whole file back. This is what keeps the app safe against
 * the file being edited on the desktop or moved by a sync client mid-session.
 */

import {
	Task,
	TaskInput,
	parseTasks,
	serializeTask,
	findTaskByRaw,
	childIndentOf,
	setTaskNotes,
	addChildTaskLine,
	removeTaskBlock,
	moveTaskAsChild,
	insertTaskLineBefore,
	collectTags,
	parseRecurrence,
	nextDueDate,
} from "@toolbox/task-core";
import type { AppSettings } from "./appState";
import { touchRecentTag } from "./appState";
import type { StorageAdapter } from "./storage";
import { todayISO } from "./dates";

export interface LoadResult {
	tasks: Task[];
	flat: Task[];
}

export class TaskService {
	constructor(
		private storage: StorageAdapter,
		private settings: AppSettings,
		private persist: () => Promise<void>
	) {}

	private get vault() {
		return this.settings.vault;
	}

	/** Read + parse the whole file. Empty tree when no vault is linked. */
	async load(): Promise<LoadResult> {
		const content = await this.readContent();
		const { tasks, flat } = parseTasks(content);
		return { tasks, flat };
	}

	/** Tags across the file, recently-used first then file order. */
	async tagList(): Promise<string[]> {
		const { tasks } = await this.load();
		const fileTags = collectTags(tasks);
		const fileSet = new Set(fileTags);
		const recent = this.settings.recentTags.filter((t) => fileSet.has(t));
		const recentSet = new Set(recent);
		return [...recent, ...fileTags.filter((t) => !recentSet.has(t))];
	}

	/* ------------------------------ raw IO ------------------------------ */

	private async readContent(): Promise<string> {
		if (!this.vault) return "";
		return (await this.storage.readFile(this.vault, this.settings.tasksPath)) ?? "";
	}

	private async writeContent(content: string): Promise<void> {
		if (!this.vault) throw new Error("No vault linked");
		await this.storage.writeFile(this.vault, this.settings.tasksPath, content);
	}

	private async appendLine(line: string): Promise<void> {
		const content = await this.readContent();
		const needsNewline = content.length > 0 && !content.endsWith("\n");
		await this.writeContent(content + (needsNewline ? "\n" : "") + line + "\n");
	}

	/**
	 * Re-read, locate `targetRaw` in a fresh parse, apply a pure line edit, write.
	 * The task handed to `edit` has block indices valid for that `lines` array.
	 */
	private async applyStructural(
		targetRaw: string,
		edit: (lines: string[], task: Task) => string[]
	): Promise<void> {
		const content = await this.readContent();
		const { flat, lines } = parseTasks(content);
		const task = findTaskByRaw(flat, targetRaw);
		if (!task) throw new Error("Couldn't locate the task — it may have changed externally.");
		await this.writeContent(edit(lines, task).join("\n"));
	}

	/* ---------------------------- mutations ---------------------------- */

	/** Append a new top-level task; return its freshly parsed Task (by raw line). */
	async createTask(input: TaskInput): Promise<Task | null> {
		const line = serializeTask({
			indent: "",
			description: input.description,
			tags: input.tags,
			due: input.due,
			priority: input.priority,
			recurrence: input.recurrence,
			completed: false,
			doneDate: null,
		});
		await this.appendLine(line);
		for (const tag of input.tags) touchRecentTag(this.settings, tag);
		await this.persist();
		const { flat } = await this.load();
		return findTaskByRaw(flat, line);
	}

	/**
	 * Complete a task. A recurring task with a due date spawns its next occurrence
	 * just above the now-completed line, exactly like the plugin.
	 */
	async markDone(task: Task): Promise<void> {
		const rule = task.recurrence ? parseRecurrence(task.recurrence) : null;
		if (rule && task.due) {
			await this.applyStructural(task.raw, (lines, t) => {
				lines[t.blockStart] = serializeTask({
					indent: t.indent,
					description: t.description,
					tags: t.tags,
					due: t.due,
					priority: t.priority,
					recurrence: t.recurrence,
					completed: true,
					doneDate: todayISO(),
				});
				if (!t.due) return lines;
				const nextLine = serializeTask({
					indent: t.indent,
					description: t.description,
					tags: t.tags,
					due: nextDueDate(rule, t.due),
					priority: t.priority,
					recurrence: t.recurrence,
					completed: false,
					doneDate: null,
				});
				return insertTaskLineBefore(lines, t, nextLine);
			});
			return;
		}

		await this.applyStructural(task.raw, (lines, t) => {
			lines[t.blockStart] = serializeTask({
				indent: t.indent,
				description: t.description,
				tags: t.tags,
				due: t.due,
				priority: t.priority,
				recurrence: t.recurrence,
				completed: true,
				doneDate: todayISO(),
			});
			return lines;
		});
	}

	async markUndone(task: Task): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => {
			lines[t.blockStart] = serializeTask({
				indent: t.indent,
				description: t.description,
				tags: t.tags,
				due: t.due,
				priority: t.priority,
				recurrence: t.recurrence,
				completed: false,
				doneDate: null,
			});
			return lines;
		});
	}

	toggleTask(task: Task): Promise<void> {
		return task.completed ? this.markUndone(task) : this.markDone(task);
	}

	async addSubtask(parent: Task, input: TaskInput): Promise<void> {
		await this.applyStructural(parent.raw, (lines, t) => {
			const line = serializeTask({
				indent: childIndentOf(t),
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				recurrence: input.recurrence,
				completed: false,
				doneDate: null,
			});
			return addChildTaskLine(lines, t, line);
		});
		for (const tag of input.tags) touchRecentTag(this.settings, tag);
		await this.persist();
	}

	/** Save edited fields and notes together in a single read/write. */
	async saveTaskDetail(task: Task, input: TaskInput, notes: string): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => {
			lines[t.blockStart] = serializeTask({
				indent: t.indent,
				description: input.description,
				tags: input.tags,
				due: input.due,
				priority: input.priority,
				recurrence: input.recurrence,
				completed: t.completed,
				doneDate: t.doneDate,
			});
			return setTaskNotes(lines, t, notes);
		});
		for (const tag of input.tags) touchRecentTag(this.settings, tag);
		await this.persist();
	}

	async setNotes(task: Task, notes: string): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => setTaskNotes(lines, t, notes));
	}

	async removeTask(task: Task): Promise<void> {
		await this.applyStructural(task.raw, (lines, t) => removeTaskBlock(lines, t));
	}

	/** Re-parent `draggedRaw` under `targetRaw`; no-op on a cyclic/invalid move. */
	async moveTaskUnder(draggedRaw: string, targetRaw: string): Promise<void> {
		const content = await this.readContent();
		const { flat, lines } = parseTasks(content);
		const dragged = findTaskByRaw(flat, draggedRaw);
		const target = findTaskByRaw(flat, targetRaw);
		if (!dragged || !target) throw new Error("Couldn't move the task — it may have changed externally.");
		const next = moveTaskAsChild(lines, dragged, target);
		if (next === lines) return;
		await this.writeContent(next.join("\n"));
	}
}
