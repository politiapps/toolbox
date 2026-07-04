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
	/** Read and clear any action the widget queued (e.g. the + button → "add"). */
	consumePendingAction(): Promise<{ action: string }>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

/** Returns a queued widget action ("add" from the + button) and clears it. */
export async function consumePendingWidgetAction(): Promise<string> {
	if (!Capacitor.isNativePlatform()) return "";
	try {
		return (await WidgetBridge.consumePendingAction()).action;
	} catch {
		return "";
	}
}

export interface WidgetTask {
	text: string;
	/** The exact markdown line, so the native widget can locate it to tick off. */
	raw: string;
	/** Whole days until due (negative = overdue), or null when undated. */
	dueDays: number | null;
	dueLabel: string | null;
	/** Proximity class: is-overdue / is-today / … (drives the widget's due colour). */
	dueClass: string | null;
	priority: string;
	/** Owning category id + name + order, so the widget can group/filter by category. */
	cat: string;
	catName: string;
	catOrder: number;
}

export interface WidgetCategory {
	id: string;
	name: string;
}

/**
 * Persist a flat snapshot (categories + tasks) and nudge the widgets to redraw.
 * The widget itself decides how to group/filter/sort per its own config.
 */
export async function writeWidgetCache(categories: WidgetCategory[], tasks: WidgetTask[]): Promise<void> {
	const payload = { updatedAt: Date.now(), categories, tasks };
	await Preferences.set({ key: "widget_cache", value: JSON.stringify(payload) });
	if (Capacitor.isNativePlatform()) {
		try {
			await WidgetBridge.refresh();
		} catch {
			/* no widgets placed yet, or bridge unavailable — ignore */
		}
	}
}
