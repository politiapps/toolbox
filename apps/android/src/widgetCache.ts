import { Preferences } from "@capacitor/preferences";
import { registerPlugin, Capacitor } from "@capacitor/core";

/**
 * The app writes a small, pre-parsed snapshot of the task list here. The native
 * home-screen widget (same package, so it can read our SharedPreferences) renders
 * from this cache — that way the widget never has to parse markdown, and the
 * parser stays single-sourced in @toolbox/task-core.
 */

interface WidgetBridgePlugin {
	/** Tell the launcher to re-read the cache and redraw all widgets. */
	refresh(): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

export interface WidgetTask {
	text: string;
	dueLabel: string | null;
	/** Proximity class: is-overdue / is-today / … (drives the widget's due colour). */
	dueClass: string | null;
	priority: string;
}

export interface WidgetGroup {
	id: string;
	name: string;
	tasks: WidgetTask[];
}

/** Persist the snapshot and nudge the widgets to redraw. */
export async function writeWidgetCache(groups: WidgetGroup[]): Promise<void> {
	const payload = { updatedAt: Date.now(), groups };
	await Preferences.set({ key: "widget_cache", value: JSON.stringify(payload) });
	if (Capacitor.isNativePlatform()) {
		try {
			await WidgetBridge.refresh();
		} catch {
			/* no widgets placed yet, or bridge unavailable — ignore */
		}
	}
}
