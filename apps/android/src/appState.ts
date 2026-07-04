import { Preferences } from "@capacitor/preferences";
import type { SortOrder } from "@toolbox/task-core";
import type { VaultRef } from "./storage";

/** One user-defined section, matched by a tag (mirrors the plugin). */
export interface SectionConfig {
	id: string;
	name: string;
	tag: string;
	sort: SortOrder;
	collapsedByDefault: boolean;
}

export interface PomodoroConfig {
	enabled: boolean;
	workMin: number;
	shortMin: number;
	longMin: number;
	/** Take a long break after this many focus sessions. */
	longEvery: number;
}

export type PomodoroPhase = "work" | "short" | "long";

/** Persisted timer state so focus survives navigation / app suspension. */
export interface PomodoroState {
	phase: PomodoroPhase;
	running: boolean;
	/** Epoch ms when the current running phase ends (only meaningful if running). */
	endsAt: number | null;
	/** Authoritative ms remaining when paused. */
	remainingMs: number;
	/** Completed work sessions in the current long-break cycle. */
	completedWork: number;
	/** Description of the task being focused, or null. */
	taskName: string | null;
	/** Epoch ms when the current work accrual began (running work only), else null. */
	focusStartedAt: number | null;
}

export interface AppSettings {
	/** One-time SAF folder grant on the Obsidian vault. */
	vault: VaultRef | null;
	/** Vault-relative path to the tasks file (read from the plugin's data.json). */
	tasksPath: string;
	/**
	 * "auto" = categories generated from the tags in the tasks file (used when the
	 * plugin's data.json isn't on the phone); "manual" = user-edited categories.
	 * When data.json IS present it always wins, regardless of this.
	 */
	categoriesMode: "auto" | "manual";
	/** Sections: from data.json if present, else auto from tags, else manual. */
	sections: SectionConfig[];
	recentTags: string[];
	/** Collapse state keyed by section id (and "__completed__"). */
	collapseState: Record<string, boolean>;
	pomodoroConfig: PomodoroConfig;
	pomodoro: PomodoroState | null;
	/** Accumulated focus seconds per task, keyed by task description. */
	taskFocusSeconds: Record<string, number>;
}

export const COMPLETED_KEY = "__completed__";

export const DEFAULT_SETTINGS: AppSettings = {
	vault: null,
	tasksPath: "tasks.md",
	categoriesMode: "auto",
	sections: [],
	recentTags: [],
	collapseState: {},
	pomodoroConfig: { enabled: true, workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 },
	pomodoro: null,
	taskFocusSeconds: {},
};

const KEY = "settings";

/** Load settings, merging over defaults so new fields get sane values. */
export async function loadSettings(): Promise<AppSettings> {
	const { value } = await Preferences.get({ key: KEY });
	if (!value) return structuredClone(DEFAULT_SETTINGS);
	try {
		const parsed = JSON.parse(value) as Partial<AppSettings>;
		return {
			...structuredClone(DEFAULT_SETTINGS),
			...parsed,
			pomodoroConfig: { ...DEFAULT_SETTINGS.pomodoroConfig, ...(parsed.pomodoroConfig ?? {}) },
		};
	} catch {
		return structuredClone(DEFAULT_SETTINGS);
	}
}

export async function saveSettings(settings: AppSettings): Promise<void> {
	await Preferences.set({ key: KEY, value: JSON.stringify(settings) });
}

/** Promote a tag to the front of the recently-used list (max 12). */
export function touchRecentTag(settings: AppSettings, tag: string): void {
	const normalised = tag.startsWith("#") ? tag : "#" + tag;
	settings.recentTags = [normalised, ...settings.recentTags.filter((t) => t !== normalised)].slice(0, 12);
}

/** A short unique id for new sections. */
export function newId(prefix: string): string {
	return prefix + "-" + Math.random().toString(36).slice(2, 8);
}
