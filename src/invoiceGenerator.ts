/**
 * invoiceGenerator.ts — Build and save invoices as PDF files.
 *
 * Generates a formatted PDF invoice from timesheet entries (plus any custom
 * line items) for a given org and date range, saves it to the configured
 * invoice folder via the vault's binary API, and updates the last-invoice
 * tracking data. The PDF is drawn with pdf-lib (pure JS — no native deps), so
 * it works on desktop and mobile and opens in Obsidian's built-in PDF viewer.
 */

import { TFile } from "obsidian";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, RGB } from "pdf-lib";
import type TasksPlugin from "./main";
import { parseTimesheet, entryWorkMinutes } from "./timesheetParser";
import { TimesheetOrg } from "./settings";

/** A user-added line item beyond the tracked timesheet hours. */
export interface CustomInvoiceItem {
	description: string;
	quantity: number;
	rate: number;
}

export interface InvoiceOptions {
	org: TimesheetOrg;
	clientName: string;
	clientAddress: string;
	dateFrom: string; // YYYY-MM-DD
	dateTo: string; // YYYY-MM-DD
	/** Date the invoice is issued/dated (YYYY-MM-DD). */
	issueDate: string;
	invoiceNumber: number;
	invoiceLabel: string;
	notes: string;
	/** Description applied to each tracked-hours line. */
	serviceDescription: string;
	/** Extra line items added by the user. */
	customItems: CustomInvoiceItem[];
}

/** Format an ISO date as "30 June 2026". */
function formatDateLong(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	return date.toLocaleDateString("en-AU", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

/** Money in the document's currency style: $1,234.00. */
function money(n: number): string {
	return (
		"$" +
		n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
	);
}

/** Parse a #rrggbb colour into a pdf-lib RGB, falling back to slate ink. */
function hexToRgb(hex: string): RGB {
	const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
	if (!m) return rgb(0.16, 0.17, 0.21);
	const n = parseInt(m[1], 16);
	return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Greedy word-wrap to a pixel width. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
			lines.push(line);
			line = w;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/** Truncate to a pixel width, adding an ellipsis if it doesn't fit. */
function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
	if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
	let s = text;
	while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) {
		s = s.slice(0, -1);
	}
	return s + "…";
}

/** One rendered ledger row (a tracked-hours day or a custom item). */
interface RenderRow {
	date: string;
	description: string;
	qty: string;
	rate: string;
	amount: string;
}

/**
 * Draw the invoice and return the PDF bytes. The org's own colour is the single
 * accent (doc label + amount-due rule); figures use Courier — the tabular-mono
 * ledger register shared across Toolbox. The "Amount due" band is the hero.
 */
export async function buildInvoicePdf(
	plugin: TasksPlugin,
	options: InvoiceOptions,
	rows: RenderRow[],
	totalHours: number,
	grandTotal: number,
): Promise<Uint8Array> {
	const inv = plugin.settings.invoice;
	const { org } = options;

	const pdf = await PDFDocument.create();
	const helv = await pdf.embedFont(StandardFonts.Helvetica);
	const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
	const courier = await pdf.embedFont(StandardFonts.Courier);
	const courierBold = await pdf.embedFont(StandardFonts.CourierBold);

	const ink = rgb(0.13, 0.13, 0.15);
	const muted = rgb(0.45, 0.46, 0.5);
	const hair = rgb(0.85, 0.86, 0.88);
	const accent = hexToRgb(org.colour);

	const pageW = 595.28;
	const pageH = 841.89;
	const margin = 50;
	const cols = {
		date: margin,
		desc: margin + 92,
		hours: margin + 352,
		rate: margin + 430,
		amount: pageW - margin,
	};

	let page: PDFPage = pdf.addPage([pageW, pageH]);
	let cur = 0; // baseline position measured from the top of the page

	type Opts = { font?: PDFFont; size?: number; color?: RGB; align?: "left" | "right" };
	const draw = (s: string, x: number, baselineTop: number, o: Opts = {}): void => {
		const font = o.font ?? helv;
		const size = o.size ?? 10;
		const w = font.widthOfTextAtSize(s, size);
		const drawX = o.align === "right" ? x - w : x;
		page.drawText(s, { x: drawX, y: pageH - baselineTop, size, font, color: o.color ?? ink });
	};
	const rule = (y: number, thickness: number, color: RGB): void => {
		page.drawLine({
			start: { x: margin, y: pageH - y },
			end: { x: pageW - margin, y: pageH - y },
			thickness,
			color,
		});
	};
	const drawTableHead = (): void => {
		const o: Opts = { font: courier, size: 7.5, color: muted };
		draw("DATE", cols.date, cur, o);
		draw("DESCRIPTION", cols.desc, cur, o);
		draw("HOURS / QTY", cols.hours, cur, { ...o, align: "right" });
		draw("RATE", cols.rate, cur, { ...o, align: "right" });
		draw("AMOUNT", cols.amount, cur, { ...o, align: "right" });
		cur += 8;
		rule(cur, 1, ink);
		cur += 16;
	};

	// ── Masthead ───────────────────────────────────────────────────────────
	cur = 66;
	draw(inv.businessName || "Your business", margin, cur, { font: helvBold, size: 19 });
	draw("INVOICE", pageW - margin, cur - 1, { font: courierBold, size: 10, color: accent, align: "right" });
	draw(options.invoiceLabel, pageW - margin, cur + 16, { font: courierBold, size: 13, align: "right" });

	let ly = cur;
	const issuerMeta: string[] = [];
	if (inv.abn) issuerMeta.push(`ABN ${inv.abn}`);
	if (inv.businessAddress) issuerMeta.push(inv.businessAddress.replace(/\n/g, ", "));
	for (const line of issuerMeta) {
		ly += 14;
		draw(line, margin, ly, { font: helv, size: 9, color: muted });
	}
	cur = Math.max(ly, cur + 16) + 20;
	rule(cur, 1.4, ink);
	cur += 26;

	// ── Meta strip: issued / period / bill-to ──────────────────────────────
	const metaTop = cur;
	draw("ISSUED", cols.date, metaTop, { font: courier, size: 7.5, color: muted });
	draw(formatDateLong(options.issueDate), cols.date, metaTop + 14, {
		font: helvBold,
		size: 10,
	});
	draw("PERIOD", margin + 175, metaTop, { font: courier, size: 7.5, color: muted });
	draw(
		`${formatDateLong(options.dateFrom)} – ${formatDateLong(options.dateTo)}`,
		margin + 175,
		metaTop + 14,
		{ font: helvBold, size: 10 },
	);

	draw("BILL TO", pageW - margin, metaTop, { font: courier, size: 7.5, color: muted, align: "right" });
	draw(options.clientName || org.name, pageW - margin, metaTop + 14, {
		font: helvBold,
		size: 10,
		align: "right",
	});
	let by = metaTop + 14;
	if (options.clientAddress) {
		for (const addr of options.clientAddress.split("\n")) {
			if (!addr.trim()) continue;
			by += 12;
			draw(addr.trim(), pageW - margin, by, { font: helv, size: 9, color: muted, align: "right" });
		}
	}
	cur = Math.max(metaTop + 14, by) + 32;

	// ── Services ledger ────────────────────────────────────────────────────
	drawTableHead();
	const descMax = cols.hours - 14 - cols.desc;
	for (const row of rows) {
		if (cur > pageH - 150) {
			page = pdf.addPage([pageW, pageH]);
			cur = 60;
			drawTableHead();
		}
		draw(row.date, cols.date, cur, { font: helv, size: 9.5, color: muted });
		draw(ellipsize(row.description, helv, 9.5, descMax), cols.desc, cur, { font: helv, size: 9.5 });
		draw(row.qty, cols.hours, cur, { font: courier, size: 9.5, align: "right" });
		draw(row.rate, cols.rate, cur, { font: courier, size: 9.5, align: "right" });
		draw(row.amount, cols.amount, cur, { font: courier, size: 9.5, align: "right" });
		cur += 9;
		rule(cur, 0.5, hair);
		cur += 15;
	}

	// Hours subtotal (money is reserved for the Amount-due hero).
	cur += 2;
	draw("Total hours", cols.desc, cur, { font: helv, size: 9, color: muted });
	draw(totalHours.toFixed(2), cols.hours, cur, { font: courierBold, size: 9.5, align: "right" });
	cur += 26;

	// ── Hero: amount due ───────────────────────────────────────────────────
	rule(cur, 1.6, accent);
	cur += 24;
	draw("AMOUNT DUE", margin, cur, { font: courierBold, size: 10, color: accent });
	draw(money(grandTotal), cols.amount, cur + 4, { font: helvBold, size: 22, align: "right" });
	cur += 22;

	// ── Notes ──────────────────────────────────────────────────────────────
	if (options.notes.trim()) {
		cur += 20;
		rule(cur, 0.5, hair);
		cur += 18;
		draw("NOTES", margin, cur, { font: courier, size: 7.5, color: muted });
		cur += 15;
		for (const para of options.notes.split("\n")) {
			const wrapped = para.trim() ? wrapText(para, helv, 9.5, pageW - margin * 2) : [""];
			for (const line of wrapped) {
				draw(line, margin, cur, { font: helv, size: 9.5 });
				cur += 13;
			}
		}
	}

	// ── Payment details ────────────────────────────────────────────────────
	if (inv.bankName || inv.bsb || inv.accountNumber) {
		cur += 18;
		rule(cur, 0.5, hair);
		cur += 18;
		draw("PAYMENT DETAILS", margin, cur, { font: courier, size: 7.5, color: muted });
		cur += 16;
		const payFields: [string, string, PDFFont][] = [];
		if (inv.bankName) payFields.push(["Bank", inv.bankName, helv]);
		if (inv.bsb) payFields.push(["BSB", inv.bsb, courier]);
		if (inv.accountNumber) payFields.push(["Account", inv.accountNumber, courier]);
		for (const [label, value, valFont] of payFields) {
			draw(label, margin, cur, { font: helv, size: 9, color: muted });
			draw(value, margin + 64, cur, { font: valFont, size: 9.5 });
			cur += 14;
		}
	}

	return pdf.save();
}

/**
 * Zero-pad a possibly non-padded ISO date (e.g. "2026-07-1" → "2026-07-01") so
 * string comparison sorts correctly. Guards the date-range filter against
 * malformed input — an unpadded month/day would otherwise sort wrongly and
 * silently drop entries.
 */
export function normalizeISO(iso: string): string {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((iso || "").trim());
	if (!m) return (iso || "").trim();
	return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** Aggregate timesheet entries into daily line items for an invoice. */
export function aggregateEntries(
	parsed: ReturnType<typeof parseTimesheet>,
	orgName: string,
	dateFrom: string,
	dateTo: string,
	rate: number,
): { entries: { date: string; hours: number; amount: number }[]; totalHours: number; totalAmount: number } {
	const from = normalizeISO(dateFrom);
	const to = normalizeISO(dateTo);
	const entries: { date: string; hours: number; amount: number }[] = [];
	let totalHours = 0;
	let totalAmount = 0;

	for (const day of parsed.days) {
		if (day.date < from || day.date > to) continue;
		for (const entry of day.entries) {
			if (entry.org !== orgName) continue;
			const mins = entryWorkMinutes(entry);
			if (mins <= 0) continue;
			const hours = mins / 60;
			const amount = hours * rate;
			entries.push({ date: day.date, hours, amount });
			totalHours += hours;
			totalAmount += amount;
		}
	}

	return { entries, totalHours, totalAmount };
}

/** Sum of all custom line items (quantity × rate), ignoring blank rows. */
export function customItemsTotal(items: CustomInvoiceItem[]): number {
	return items.reduce((sum, it) => sum + (it.description.trim() ? it.quantity * it.rate : 0), 0);
}

/** Compute the next invoice label for an org (e.g. "INV-005"). */
export function nextInvoiceLabel(org: TimesheetOrg): { number: number; label: string } {
	const prefix = org.invoicePrefix || "INV";
	const nextNum = org.lastInvoiceNumber ?? org.invoiceStartNumber ?? 1;
	return {
		number: nextNum,
		label: `${prefix}-${String(nextNum).padStart(3, "0")}`,
	};
}

/** Ensure the invoice output folder exists, creating it if needed. */
async function ensureInvoiceFolder(plugin: TasksPlugin, path: string): Promise<void> {
	const parts = path.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!current) continue;
		if (!plugin.app.vault.getAbstractFileByPath(current)) {
			await plugin.app.vault.createFolder(current);
		}
	}
}

/**
 * Generate an invoice PDF and save it to the vault. Returns the saved file so
 * the caller can open it in the PDF viewer.
 */
export async function generateInvoice(
	plugin: TasksPlugin,
	options: InvoiceOptions,
): Promise<TFile> {
	const file = plugin.app.vault.getAbstractFileByPath(plugin.settings.timesheetFilePath);
	if (!(file instanceof TFile)) {
		throw new Error("Timesheet file not found.");
	}

	const content = await plugin.app.vault.read(file);
	const parsed = parseTimesheet(content);

	const { entries, totalHours, totalAmount } = aggregateEntries(
		parsed,
		options.org.name,
		options.dateFrom,
		options.dateTo,
		options.org.rate,
	);

	const customRows = options.customItems.filter((it) => it.description.trim());
	if (entries.length === 0 && customRows.length === 0) {
		throw new Error("No timesheet entries or custom items to invoice for this range.");
	}

	// Build the rendered ledger: tracked-hours days first, then custom items.
	const rows: RenderRow[] = [];
	for (const e of entries) {
		rows.push({
			date: formatDateLong(e.date),
			description: options.serviceDescription || "Professional services",
			qty: e.hours.toFixed(2),
			rate: money(options.org.rate),
			amount: money(e.amount),
		});
	}
	for (const it of customRows) {
		rows.push({
			date: "",
			description: it.description.trim(),
			qty: String(it.quantity),
			rate: money(it.rate),
			amount: money(it.quantity * it.rate),
		});
	}

	const grandTotal = totalAmount + customItemsTotal(options.customItems);
	const bytes = await buildInvoicePdf(plugin, options, rows, totalHours, grandTotal);

	const folder = plugin.settings.invoice.invoiceFolder || "toolbox/Invoices";
	await ensureInvoiceFolder(plugin, folder);

	const safeOrg = options.org.name.replace(/[^a-zA-Z0-9]/g, "-");
	const basePath = `${folder}/${options.invoiceLabel}-${safeOrg}`;
	let finalPath = `${basePath}.pdf`;
	let counter = 1;
	while (plugin.app.vault.getAbstractFileByPath(finalPath) instanceof TFile) {
		finalPath = `${basePath}-${counter}.pdf`;
		counter++;
	}

	const created = await plugin.app.vault.createBinary(finalPath, bytes.slice().buffer);

	// Update org tracking data.
	options.org.lastInvoiceDate = options.dateTo;
	options.org.lastInvoiceNumber = options.invoiceNumber + 1;
	await plugin.saveSettings();

	return created;
}
