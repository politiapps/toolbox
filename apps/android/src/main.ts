import "./styles.css";
import { loadSettings, saveSettings } from "./appState";
import { getStorage } from "./storage";
import { TaskService } from "./taskService";
import { App } from "./ui/app";

async function boot(): Promise<void> {
	const rootEl = document.getElementById("app");
	if (!rootEl) return;

	const settings = await loadSettings();
	const storage = getStorage();

	// If we linked a vault but lost the SAF grant (revoked / moved), forget it so
	// the UI prompts to re-link rather than erroring on every read.
	if (settings.vault && !(await storage.hasVaultAccess(settings.vault))) {
		settings.vault = null;
		await saveSettings(settings);
	}

	const service = new TaskService(storage, settings, () => saveSettings(settings));
	const app = new App(rootEl, settings, service, storage);
	await app.start();
}

void boot();
