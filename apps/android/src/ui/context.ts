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
	/** Open the file picker and adopt the chosen tasks file. */
	pickFile: () => Promise<void>;
	/**
	 * Pick the Obsidian plugin's data.json and copy its sections + Pomodoro config
	 * into the app. Resolves with the number of sections imported, or null if the
	 * user cancelled or the file wasn't a valid Toolbox config.
	 */
	importObsidianSettings: () => Promise<number | null>;
}
