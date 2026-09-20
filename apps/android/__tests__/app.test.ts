// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/ui/app";
import { DEFAULT_SETTINGS } from "../src/appState";
import { TaskService } from "../src/taskService";
import { parseTasks, VIEW_SHOPPING, VIEW_ALL, SHOPPING_PATH } from "@toolbox/task-core";
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


describe("shopping inside Tasks", () => {
 it("opens from the existing switcher and preserves history and draft on refresh", async () => {
  const { app, root, settings, storage } = setup();
  vi.spyOn(storage, "readFile").mockImplementation(async (_vault, path) => path === SHOPPING_PATH ? JSON.stringify({version: 1, items: [{id: "milk", name: "Milk", store: "Grocery", category: "Dairy & eggs", quantity: "2", active: true, checked: false, frequency: 4}]}) : null);
  await app.render();
  const chip = Array.from(root.querySelectorAll<HTMLButtonElement>(".view-chip")).find(b => b.textContent === "Shopping")!;
  chip.click();
  await vi.waitFor(() => expect(root.textContent).toContain("Milk"));
  expect(settings.activeView).toBe(VIEW_SHOPPING);
  expect(root.querySelector(".view-switcher")).not.toBeNull();
  expect(root.textContent).not.toContain("Back to tasks");
  expect(root.querySelector("form")).toBeNull();
  root.querySelector<HTMLButtonElement>('[aria-label="Add shopping item"]')!.click();
  const input = document.querySelector<HTMLInputElement>(".shop-dialog form input")!;
  input.value = "Bread draft";
  await app.render();
  expect(document.querySelector(".shop-dialog form input")).toBe(input);
  expect(input.value).toBe("Bread draft");
  const all = Array.from(root.querySelectorAll<HTMLButtonElement>(".view-chip")).find(b => b.textContent === "All")!;
  all.click();
  await vi.waitFor(() => expect(root.querySelector(".toolbox-shopping")).toBeNull());
  expect(settings.activeView).toBe(VIEW_ALL);
 });
});
