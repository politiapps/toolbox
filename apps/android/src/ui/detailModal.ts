import { Task, findTaskByRaw, orderSubtasks } from "@toolbox/task-core";
import { el, openModal, toast } from "./dom";
import { taskForm } from "./taskForm";
import type { AppContext } from "./context";
import { openAddSubtask } from "./addModal";

/** Open a task: edit its fields, notes, and manage its subtasks. */
export function openDetail(ctx: AppContext, task: Task): void {
	openModal((content, close) => {
		let current = task;

		content.append(el("h3", { cls: "modal-title", text: "Task" }));
		const form = taskForm(content, ctx.knownTags, {
			description: current.description,
			tag: current.tags[0],
			due: current.due,
			priority: current.priority,
			recurrence: current.recurrence,
		});

		let notes = current.notes;
		content.append(el("div", { cls: "form-label", text: "Notes" }));
		const notesArea = el("textarea", {
			cls: "form-input notes-input",
			attrs: { rows: 4, placeholder: "Add notes…" },
		}) as HTMLTextAreaElement;
		notesArea.value = notes;
		notesArea.addEventListener("input", () => (notes = notesArea.value));
		content.append(notesArea);

		content.append(el("div", { cls: "form-label", text: "Subtasks" }));
		const subWrap = el("div", { cls: "detail-subtasks" });
		content.append(subWrap);

		const reloadCurrent = async (): Promise<void> => {
			const { flat } = await ctx.service.load();
			const fresh = findTaskByRaw(flat, current.raw);
			if (fresh) current = fresh;
			renderSubtasks();
		};

		function renderSubtasks(): void {
			subWrap.replaceChildren();
			if (current.children.length === 0) {
				subWrap.append(el("div", { cls: "empty-note", text: "No subtasks yet" }));
				return;
			}
			for (const child of orderSubtasks(current.children)) {
				const row = el("div", { cls: "detail-subrow" });
				const cb = el("input", { attrs: { type: "checkbox" } }) as HTMLInputElement;
				cb.checked = child.completed;
				cb.addEventListener("change", async () => {
					try {
						await ctx.service.toggleTask(child);
						await reloadCurrent();
					} catch (e) {
						toast(String((e as Error).message ?? e));
					}
				});
				const label = el("span", {
					cls: child.completed ? "detail-subtitle is-completed" : "detail-subtitle",
					text: child.description,
				});
				row.append(cb, label);
				subWrap.append(row);
			}
		}
		renderSubtasks();

		const addSub = el("button", { cls: "btn btn-ghost", text: "+ Add subtask" });
		addSub.addEventListener("click", () => {
			// Add against the freshest version, then reload this sheet's subtasks.
			openAddSubtask(ctx, current);
			// Re-sync shortly after the add sheet closes.
			const sync = () => void reloadCurrent();
			setTimeout(sync, 400);
		});
		content.append(addSub);

		const buttons = el("div", { cls: "modal-buttons" });
		const saveBtn = el("button", { cls: "btn btn-cta", text: "Save" });
		saveBtn.addEventListener("click", async () => {
			const input = form.collectInput();
			if (!input) return;
			try {
				await ctx.service.saveTaskDetail(current, input, notes);
				close();
				await ctx.refresh();
			} catch (e) {
				toast(String((e as Error).message ?? e));
			}
		});
		const delBtn = el("button", { cls: "btn btn-danger", text: "Delete" });
		delBtn.addEventListener("click", async () => {
			try {
				await ctx.service.removeTask(current);
				close();
				await ctx.refresh();
			} catch (e) {
				toast(String((e as Error).message ?? e));
			}
		});
		buttons.append(saveBtn, delBtn);
		content.append(buttons);
	});
}
