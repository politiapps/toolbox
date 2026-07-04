import { Task } from "@toolbox/task-core";
import { el, openModal, toast } from "./dom";
import { taskForm } from "./taskForm";
import type { AppContext } from "./context";
import { openDetail } from "./detailModal";

/** The "Add task" bottom sheet, with an "Add & open" secondary action. */
export function openAddTask(ctx: AppContext, prefillTag?: string): void {
	openModal((content, close) => {
		content.append(el("h3", { cls: "modal-title", text: "Add task" }));
		const form = taskForm(content, ctx.knownTags, { tag: prefillTag });
		form.focusDescription();

		// Returns the new Task (or null if lookup missed) on success, or `undefined`
		// when the form was invalid / errored — in which case the sheet stays open.
		const create = async (): Promise<Task | null | undefined> => {
			const input = form.collectInput();
			if (!input) return undefined;
			try {
				return await ctx.service.createTask(input);
			} catch (e) {
				toast(String((e as Error).message ?? e));
				return undefined;
			}
		};

		const buttons = el("div", { cls: "modal-buttons" });
		const addBtn = el("button", { cls: "btn btn-cta", text: "Add task" });
		addBtn.addEventListener("click", async () => {
			const t = await create();
			if (t === undefined) return;
			close();
			await ctx.refresh();
		});
		const addOpenBtn = el("button", { cls: "btn", text: "Add & open" });
		addOpenBtn.addEventListener("click", async () => {
			const task = await create();
			if (task === undefined) return;
			close();
			await ctx.refresh();
			if (task) openDetail(ctx, task);
		});
		buttons.append(addBtn, addOpenBtn);
		content.append(buttons);
	});
}

/** The "Add subtask" sheet, pre-tagged with the parent's project. */
export function openAddSubtask(ctx: AppContext, parent: Task): void {
	openModal((content, close) => {
		content.append(el("h3", { cls: "modal-title", text: "Add subtask" }));
		const form = taskForm(content, ctx.knownTags, { tag: parent.tags[0] });
		form.focusDescription();

		const buttons = el("div", { cls: "modal-buttons" });
		const addBtn = el("button", { cls: "btn btn-cta", text: "Add subtask" });
		addBtn.addEventListener("click", async () => {
			const input = form.collectInput();
			if (!input) return;
			try {
				await ctx.service.addSubtask(parent, input);
				close();
				await ctx.refresh();
			} catch (e) {
				toast(String((e as Error).message ?? e));
			}
		});
		buttons.append(addBtn);
		content.append(buttons);
	});
}
