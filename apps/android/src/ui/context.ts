import type { AppSettings } from "../appState";
import type { TaskService } from "../taskService";

/** Shared handles passed to every screen and modal. */
export interface AppContext {
	service: TaskService;
	settings: AppSettings;
	/** Persist settings to storage. */
	persist: () => Promise<void>;
	/** Reload the file and re-render the current screen. */
	refresh: () => Promise<void>;
	/** Tags known at the last refresh (recently-used first). */
	knownTags: string[];
	/** Navigate to the settings screen. */
	openSettings: () => void;
	/** Link the Obsidian vault folder, then mirror its config. */
	pickVault: () => Promise<void>;
}
