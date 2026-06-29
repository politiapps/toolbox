/**
 * embedEditor.ts — Click-to-edit for transcluded notes inside column cells.
 *
 * Adapted from the MIT-licensed Embed Editor plugin
 * (https://github.com/xmisio72/obsidian-embed-editor): clicking a rendered
 * `![[note]]` embed opens a floating editor pre-filled with the source lines;
 * on save the edits are spliced back into the source file.
 *
 * Scope: this module only RESOLVES an embed element to a source line range and
 * runs the edit modal. The decision of *which* embeds are clickable (only those
 * inside our column cells) lives in main.ts, which owns the document listener.
 *
 * File access goes exclusively through app.vault, and every write re-reads the
 * file first and merges — never overwrite blindly (mirrors taskView's IO rules).
 */

import { App, Modal, Notice, TFile } from "obsidian";

/** A resolved embed target: a file and the [start, end) line range it points to. */
interface EmbedTarget {
	file: TFile;
	/** First line of the embedded region (inclusive). */
	startLine: number;
	/** One past the last line of the embedded region (exclusive). */
	endLine: number;
	/** Human label for the modal header, e.g. "Note A › Heading". */
	label: string;
}

/**
 * Resolve a rendered embed element to its source file and line range.
 *
 * Handles whole-file embeds (`![[Note]]`), heading embeds (`![[Note#Heading]]`)
 * and block embeds (`![[Note#^blockid]]`). Returns null if it can't resolve —
 * e.g. the embed points at a non-markdown file, or the heading/block is gone.
 */
export function resolveEmbed(
	app: App,
	embedEl: HTMLElement,
	sourcePath: string
): EmbedTarget | null {
	// Rendered internal embeds carry the raw link text in their `src` attribute,
	// e.g. "Note A#Heading" or "Note A#^block1".
	const src = embedEl.getAttribute("src");
	if (!src) return null;

	const hashIndex = src.indexOf("#");
	const linkpath = (hashIndex === -1 ? src : src.slice(0, hashIndex)).trim();
	const subpath = hashIndex === -1 ? "" : src.slice(hashIndex + 1).trim();

	const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
	if (!(file instanceof TFile) || file.extension !== "md") return null;

	const range = resolveRange(app, file, subpath);
	if (!range) return null;

	const fileLabel = file.basename;
	const label = subpath ? `${fileLabel} › ${subpath.replace(/^\^/, "")}` : fileLabel;
	return { file, startLine: range.start, endLine: range.end, label };
}

/**
 * Compute the [start, end) line range a subpath points to, using the metadata
 * cache. Empty subpath → the whole file. `#Heading` → that heading plus its body
 * (up to the next heading of the same or higher level). `#^id` → that block.
 */
function resolveRange(
	app: App,
	file: TFile,
	subpath: string
): { start: number; end: number } | null {
	const cache = app.metadataCache.getFileCache(file);
	const lineCount = (cache?.sections?.last()?.position.end.line ?? 0) + 1;

	if (!subpath) {
		// Whole file. We still read the file at edit time for the true line count;
		// here a generous range is fine because the modal re-reads on open.
		return { start: 0, end: Number.MAX_SAFE_INTEGER };
	}

	if (subpath.startsWith("^")) {
		const id = subpath.slice(1);
		const block = cache?.blocks?.[id];
		if (!block) return null;
		return { start: block.position.start.line, end: block.position.end.line + 1 };
	}

	// Heading subpath. Match by exact text first, then case-insensitively.
	const headings = cache?.headings ?? [];
	let i = headings.findIndex((h) => h.heading === subpath);
	if (i === -1) i = headings.findIndex((h) => h.heading.toLowerCase() === subpath.toLowerCase());
	if (i === -1) return null;

	const level = headings[i].level;
	const start = headings[i].position.start.line;
	let end = lineCount;
	for (let j = i + 1; j < headings.length; j++) {
		if (headings[j].level <= level) {
			end = headings[j].position.start.line;
			break;
		}
	}
	return { start, end };
}

/**
 * Open the floating editor for a resolved embed. Reads the current source slice,
 * lets the user edit it, and on save re-reads and splices the edit back in.
 */
export async function openEmbedEditor(app: App, target: EmbedTarget): Promise<void> {
	const content = await app.vault.read(target.file);
	const lines = content.split("\n");
	const start = Math.min(target.startLine, lines.length);
	const end = Math.min(target.endLine, lines.length);
	const original = lines.slice(start, end).join("\n");

	new EmbedEditModal(app, target, original).open();
}

class EmbedEditModal extends Modal {
	private target: EmbedTarget;
	private original: string;
	private value: string;

	constructor(app: App, target: EmbedTarget, original: string) {
		super(app);
		this.target = target;
		this.original = original;
		this.value = original;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("toolbox-embed-modal");
		contentEl.empty();

		contentEl.createEl("div", { text: this.target.label, cls: "toolbox-embed-title" });

		const textarea = contentEl.createEl("textarea", { cls: "toolbox-embed-textarea" });
		textarea.value = this.value;
		textarea.addEventListener("input", () => (this.value = textarea.value));
		window.setTimeout(() => textarea.focus(), 0);

		const footer = contentEl.createDiv({ cls: "toolbox-embed-footer" });
		const cancel = footer.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const save = footer.createEl("button", { text: "Save", cls: "mod-cta" });
		save.addEventListener("click", () => this.save());

		// Mod+Enter saves, matching Embed Editor's shortcut.
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			this.save();
			return false;
		});
	}

	/**
	 * Splice the edited text back into the source file. Re-reads first and locates
	 * the original slice by exact text so a concurrent external edit doesn't make
	 * us clobber the wrong lines (mirrors taskView.replaceLine's strategy).
	 */
	private async save(): Promise<void> {
		const content = await this.app.vault.read(this.target.file);
		const lines = content.split("\n");
		const newLines = this.value.split("\n");

		const origLines = this.original.split("\n");
		const at = indexOfSlice(lines, origLines);
		if (at === -1) {
			new Notice("Couldn't locate the original text — the source changed. Edit aborted.");
			this.close();
			return;
		}

		lines.splice(at, origLines.length, ...newLines);
		await this.app.vault.modify(this.target.file, lines.join("\n"));
		// Obsidian's reactivity re-renders the embed (and our cell) with the update.
		this.close();
	}
}

/** Index of the first occurrence of contiguous `needle` lines within `hay`, or -1. */
function indexOfSlice(hay: string[], needle: string[]): number {
	if (needle.length === 0) return -1;
	for (let i = 0; i + needle.length <= hay.length; i++) {
		let match = true;
		for (let j = 0; j < needle.length; j++) {
			if (hay[i + j] !== needle[j]) {
				match = false;
				break;
			}
		}
		if (match) return i;
	}
	return -1;
}
