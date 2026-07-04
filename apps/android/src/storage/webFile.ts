import type { StorageAdapter, VaultRef } from "./types";
import { DATA_JSON_PATH } from "./types";

/**
 * Development adapter for running the app in a desktop browser. The "vault" is a
 * set of localStorage entries keyed by relative path, seeded with a sample
 * tasks.md and a matching plugin data.json so categories + tasks render.
 */
const PREFIX = "toolbox-devvault::";

const SAMPLE_TASKS = [
	"- [ ] Ship the Android app #work 📅 2026-07-10 ⏫",
	"    - [ ] Wire the SAF picker",
	"    - [x] Extract task-core ✅ 2026-07-04",
	"- [ ] Water the plants #home 🔁 every week 📅 2026-07-06",
	"- [ ] Buy milk #shopping 🔽",
	"- [ ] Eggs #shopping",
	"- [x] Pay rent #home 📅 2026-07-01 ✅ 2026-07-01",
	"",
].join("\n");

const SAMPLE_DATA_JSON = JSON.stringify({
	tasksFilePath: "tasks.md",
	sections: [
		{ id: "s-shop", name: "Shopping list", tag: "#shopping", sort: "file", collapsedByDefault: false },
		{ id: "s-home", name: "Home", tag: "#home", sort: "due", collapsedByDefault: false },
		{ id: "s-work", name: "Work", tag: "#work", sort: "priority-due", collapsedByDefault: false },
	],
});

export class WebFileAdapter implements StorageAdapter {
	isNative(): boolean {
		return false;
	}

	async pickVault(): Promise<VaultRef> {
		if (localStorage.getItem(PREFIX + "tasks.md") === null) {
			localStorage.setItem(PREFIX + "tasks.md", SAMPLE_TASKS);
			localStorage.setItem(PREFIX + DATA_JSON_PATH, SAMPLE_DATA_JSON);
		}
		return { uri: "devvault", name: "Dev vault (browser)" };
	}

	async hasVaultAccess(_vault: VaultRef): Promise<boolean> {
		return true;
	}

	async readFile(_vault: VaultRef, relPath: string): Promise<string | null> {
		return localStorage.getItem(PREFIX + relPath);
	}

	async writeFile(_vault: VaultRef, relPath: string, content: string): Promise<void> {
		localStorage.setItem(PREFIX + relPath, content);
	}
}
