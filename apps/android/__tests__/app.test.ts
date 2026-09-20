// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/app";
import { DEFAULT_SETTINGS } from "../src/appState";
import { TaskService } from "../src/taskService";
import { parseTasks } from "@toolbox/task-core";
import type { StorageAdapter } from "../src/storage";
vi.mock("@capacitor/preferences", () => ({
	Preferences: { set: vi.fn(async () => {}) },
}));
vi.mock("../src/widgetCache", () => ({
	writeWidgetCache: vi.fn(),
	consumePendingWidgetAction: vi.fn(async () => null),
}));
function setup() {
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.vault = { uri: "test", name: "Test" };
	settings.pomodoroConfig.enabled = false;
	const storage: StorageAdapter = {
		isNative: () => false,
		pickVault: async () => null,
		hasVaultAccess: async () => true,
		readFile: async () => null,
		writeFile: async () => {},
	};
	const service = new TaskService(storage, settings, async () => {});
	const root = document.createElement("div");
	const app = new App(root, settings, service, storage);
	return { settings, storage, service, root, app };
}
describe("Android task audit regressions", () => {
	it("filters completed tasks to the selected category", async () => {
		const { settings, service, root, app } = setup();
		settings.categoriesMode = "manual";
		settings.sections = [
			{
				id: "work",
				name: "Work",
				tag: "#work",
				sort: "due",
				collapsedByDefault: false,
			},
		];
		settings.activeView = "work";
		settings.collapseState.__completed__ = false;
		vi.spyOn(service, "load").mockResolvedValue(
			parseTasks("- [x] Work done #work\n- [x] Home done #home"),
		);
		await app.render();
		expect(root.textContent).toContain("Work done");
		expect(root.textContent).not.toContain("Home done");
	});
	it("discards an older read that resolves after a newer render", async () => {
		const { service, root, app } = setup();
		let finish!: (value: ReturnType<typeof parseTasks>) => void;
		vi.spyOn(service, "load")
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValueOnce(parseTasks("- [ ] Latest task"));
		const old = app.render();
		await app.render();
		finish(parseTasks("- [ ] Stale task"));
		await old;
		expect(root.textContent).toContain("Latest task");
		expect(root.textContent).not.toContain("Stale task");
	});
});
