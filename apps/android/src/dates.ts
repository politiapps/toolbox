/**
 * Presentation date helpers.
 *
 * These used to be a hand-copy of the plugin's, which is exactly how the two
 * surfaces drift on what "overdue" looks like. They now live in
 * `@toolbox/task-core` (presentation.ts) and are re-exported here so the app's
 * existing `../dates` imports keep working, and so there is still one obvious
 * place to put an app-only date helper if one is ever needed.
 */

export {
	todayISO,
	parseLocalDate,
	ordinalSuffix,
	formatDueDisplay,
	formatDueShort,
	daysUntil,
	addDaysISO,
	dueLabel,
	dueState,
	dueClass,
	dueWithin,
	PRIORITY_SEGMENTS,
	priorityFilled,
	sectionAccent,
	hash32,
	formatFocus,
	formatClock,
} from "@toolbox/task-core";

export type { DueState } from "@toolbox/task-core";
