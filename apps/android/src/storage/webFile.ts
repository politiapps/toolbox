import type { StorageAdapter, TasksFileRef } from "./types";

/**
 * Development adapter for running the app in a desktop browser. The "file" is a
 * localStorage entry, seeded with a sample so the UI has something to render.
 * Never used inside the native shell.
 */
const KEY = "toolbox-tasks-devfile";

const SAMPLE = [
	"- [ ] Ship the Android app #dev 📅 2026-07-10 ⏫",
	"    - [ ] Wire the SAF picker",
	"    - [x] Extract task-core ✅ 2026-07-04",
	"    a quick note about the release",
	"- [ ] Water the plants #home 🔁 every week 📅 2026-07-06",
	"- [ ] Buy milk #home 🔽",
	"- [x] Pay rent #home 📅 2026-07-01 ✅ 2026-07-01",
	"",
].join("\n");

export class WebFileAdapter implements StorageAdapter {
	isNative(): boolean {
		return false;
	}

	async pickFile(): Promise<TasksFileRef | null> {
		if (localStorage.getItem(KEY) === null) localStorage.setItem(KEY, SAMPLE);
		return { uri: KEY, name: "tasks.md (browser dev)" };
	}

	async hasAccess(_ref: TasksFileRef): Promise<boolean> {
		return true;
	}

	async read(ref: TasksFileRef): Promise<string> {
		return localStorage.getItem(ref.uri) ?? "";
	}

	async write(ref: TasksFileRef, content: string): Promise<void> {
		localStorage.setItem(ref.uri, content);
	}
}
