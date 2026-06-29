/**
 * editableColumns.ts — A Live Preview multi-row / multi-column layout.
 *
 * Layout and CSS lineage: the MIT-licensed Live Columns plugin
 * (https://github.com/nhiwentwest/live-columns). Live Columns' critical flaw is
 * that it hand-builds HTML for cell content, so embeds / dataviewjs / Tasks show
 * as raw text. The fix that makes this module worthwhile: every cell is routed
 * through `MarkdownRenderer.render`, i.e. Obsidian's real post-processor
 * pipeline, so transclusions, dataviewjs and Tasks actually execute.
 *
 * Authoring uses Obsidian comment markers (not a code fence) so a cell can hold
 * any markdown — including its own ```dataviewjs / ```tasks fenced blocks, which
 * a fenced container could not nest:
 *
 *   %% columns:start %%
 *   %% col %%
 *   first cell — can include ![[Note]]
 *   %% col %%
 *   ```dataviewjs
 *   ...
 *   ```
 *   %% row %%
 *   a full-width second row (no %% col %% = a single column)
 *   %% columns:end %%
 *
 * This module parses those markers and renders cells. It NEVER parses task
 * lines — Tasks-syntax parsing lives only in taskParser.ts; here the Tasks
 * plugin's own post-processor handles any task content inside a cell.
 *
 * Marker syntax is feature-internal grammar (like priority emojis), not
 * user-configurable text, so it lives here as constants rather than in settings.
 */

import { App, MarkdownRenderChild, MarkdownRenderer, editorInfoField } from "obsidian";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

/** CSS class on the rendered container — used by main.ts to scope embed clicks. */
export const COLUMNS_CLASS = "toolbox-columns";

const BLOCK_START = /^%%\s*columns:start\s*%%\s*$/i;
const BLOCK_END = /^%%\s*columns:end\s*%%\s*$/i;
const ROW_MARK = /^%%\s*row\s*%%\s*$/i;
const COL_MARK = /^%%\s*col\s*%%\s*$/i;

/** A parsed columns block: its line span and rows of cell-markdown strings. */
interface ColumnsBlock {
	/** Start-of-block line (the `%% columns:start %%` line), 1-based CM line no. */
	fromLine: number;
	/** End-of-block line (the `%% columns:end %%` line), 1-based CM line no. */
	toLine: number;
	/** rows[r][c] = the raw markdown for the cell at row r, column c. */
	rows: string[][];
	/** The full source text of the block, used for widget identity (eq). */
	source: string;
}

/** Scan the whole document and return every well-formed columns block. */
function findBlocks(view: EditorView): ColumnsBlock[] {
	const doc = view.state.doc;
	const blocks: ColumnsBlock[] = [];

	let start = -1;
	for (let n = 1; n <= doc.lines; n++) {
		const text = doc.line(n).text;
		if (start === -1) {
			if (BLOCK_START.test(text)) start = n;
		} else if (BLOCK_END.test(text)) {
			const bodyLines: string[] = [];
			for (let m = start + 1; m < n; m++) bodyLines.push(doc.line(m).text);
			blocks.push({
				fromLine: start,
				toLine: n,
				rows: parseRows(bodyLines),
				source: doc.sliceString(doc.line(start).from, doc.line(n).to),
			});
			start = -1;
		}
	}
	return blocks;
}

/** Split a block body into rows (`%% row %%`) of cells (`%% col %%`). */
function parseRows(lines: string[]): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell: string[] = [];

	const endCell = () => {
		row.push(cell.join("\n").trim());
		cell = [];
	};
	const endRow = () => {
		endCell();
		rows.push(row);
		row = [];
	};

	for (const line of lines) {
		if (ROW_MARK.test(line)) {
			endRow();
		} else if (COL_MARK.test(line)) {
			endCell();
		} else {
			cell.push(line);
		}
	}
	endRow();

	// Drop a wholly-empty trailing structure (e.g. block with no content yet),
	// but keep intentional empty cells within a populated row.
	return rows.filter((r) => r.some((c) => c.length > 0) || r.length > 1);
}

/** A widget that renders one columns block as a CSS grid of rendered cells. */
class ColumnsWidget extends WidgetType {
	private children: MarkdownRenderChild[] = [];

	constructor(
		private readonly app: App,
		private readonly block: ColumnsBlock,
		private readonly sourcePath: string
	) {
		super();
	}

	eq(other: ColumnsWidget): boolean {
		// Only rebuild when the block's own source or its host file changes —
		// unrelated edits elsewhere in the document keep the existing DOM.
		return other.block.source === this.block.source && other.sourcePath === this.sourcePath;
	}

	toDOM(): HTMLElement {
		const container = document.createElement("div");
		container.className = COLUMNS_CLASS;

		for (const row of this.block.rows) {
			const rowEl = container.createDiv({ cls: "toolbox-columns-row" });
			rowEl.style.gridTemplateColumns = `repeat(${Math.max(row.length, 1)}, minmax(0, 1fr))`;
			for (const cellMarkdown of row) {
				const cellEl = rowEl.createDiv({ cls: "toolbox-columns-cell" });
				const child = new MarkdownRenderChild(cellEl);
				child.load();
				this.children.push(child);
				// THE fix vs. Live Columns: real renderer → post-processors run, so
				// embeds transclude and dataviewjs / Tasks execute. The loaded child
				// is the lifecycle owner Dataview ties its own refresh to.
				MarkdownRenderer.render(this.app, cellMarkdown, cellEl, this.sourcePath, child);
			}
		}
		return container;
	}

	destroy(): void {
		// Unload every cell's render child so nested components (dataviewjs, Tasks)
		// tear down — no orphaned renderers when the widget is replaced or removed.
		for (const child of this.children) child.unload();
		this.children = [];
	}

	ignoreEvent(event: Event): boolean {
		// Let clicks on interactive content (embeds, links, checkboxes, buttons)
		// through to their own handlers (and our document-level embed listener),
		// instead of letting CodeMirror turn them into a cursor move. A click on
		// plain cell background falls through to CM, which positions the cursor in
		// the block and so reveals the source for editing the markers.
		const target = event.target as HTMLElement | null;
		return !!target?.closest(
			"a, input, button, .internal-embed, .markdown-embed, .task-list-item-checkbox, .dataview"
		);
	}
}

/** Build the decoration set: replace each block whose lines the cursor is NOT in. */
function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const info = view.state.field(editorInfoField, false);
	if (!info) return builder.finish();
	const sourcePath = info.file?.path ?? "";
	const selection = view.state.selection;

	for (const block of findBlocks(view)) {
		const from = view.state.doc.line(block.fromLine).from;
		const to = view.state.doc.line(block.toLine).to;

		// If the cursor / a selection touches the block, show raw source so the
		// markers can be edited in place. Otherwise replace it with the widget.
		const intersects = selection.ranges.some((r) => r.from <= to && r.to >= from);
		if (intersects) continue;

		builder.add(
			from,
			to,
			Decoration.replace({
				block: true,
				widget: new ColumnsWidget(info.app, block, sourcePath),
			})
		);
	}
	return builder.finish();
}

/**
 * The CodeMirror 6 view plugin. Rebuilds decorations when the document, the
 * selection, or the viewport changes; widget `eq()` keeps unchanged blocks'
 * DOM (and their live dataviewjs) intact across unrelated edits.
 */
export const editableColumnsExtension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations }
);
