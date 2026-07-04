/**
 * The seam between the task UI and where `tasks.md` actually lives.
 *
 * On the phone this is backed by Android's Storage Access Framework (a
 * user-picked file + persistable permission). In a desktop browser during
 * development it's backed by localStorage so the whole UI is exercisable
 * without a device. Everything above this interface is platform-agnostic.
 */

/** A handle to the chosen tasks file: an opaque URI plus a display name. */
export interface TasksFileRef {
	/** Opaque locator (a SAF content:// URI on device; a key in the browser). */
	uri: string;
	/** Human-readable name for the settings screen (e.g. "tasks.md"). */
	name: string;
}

export interface StorageAdapter {
	/** True when running inside the native Android shell. */
	isNative(): boolean;

	/** Prompt the user to choose their tasks file. Null if they cancel. */
	pickFile(): Promise<TasksFileRef | null>;

	/** Whether we still hold read/write permission for `ref`. */
	hasAccess(ref: TasksFileRef): Promise<boolean>;

	/** Read the whole file as UTF-8 text. */
	read(ref: TasksFileRef): Promise<string>;

	/** Overwrite the whole file with `content` (UTF-8). */
	write(ref: TasksFileRef, content: string): Promise<void>;
}
