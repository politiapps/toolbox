/**
 * invoiceGenerator.ts — Build and save invoice markdown files.
 *
 * Generates a formatted markdown invoice from timesheet entries for a given
 * org and date range, saves it to the configured invoice folder, and updates
 * the last-invoice tracking data.
 */

import { App, TFile } from "obsidian";
import type TasksPlugin from "./main";
import { parseTimesheet, entryWorkMinutes } from "./timesheetParser";
import { TimesheetOrg } from "./settings";

export interface InvoiceOptions {
	org: TimesheetOrg;
	clientName: string;
	clientAddress: string;
	dateFrom: string; // YYYY-MM-DD
	dateTo: string; // YYYY-MM-DD
	invoiceNumber: number;
	invoiceLabel: string;
	notes: string;
}

/** Format a Date as "30 June 2026". */
function formatDateLong(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	return date.toLocaleDateString("en-AU", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

/** Escape user-supplied text for safe inclusion in the invoice HTML. */
function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Money in the document's currency style: $1,234.00. */
function money(n: number): string {
	return (
		"$" +
		n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
	);
}

/**
 * Build the saved invoice document. It is written into a `.md` note but emitted
 * as a self-contained HTML document wrapped in `.toolbox-invoice`, so the
 * plugin's stylesheet renders it as a proper invoice in reading view (and in
 * print/PDF export) across any theme. Figures use the tabular-mono ledger
 * register shared across Toolbox; the "Amount due" band is the one bold moment.
 */
export function buildInvoiceMarkdown(
	plugin: TasksPlugin,
	options: InvoiceOptions,
	entries: { date: string; hours: number; amount: number }[],
	totalHours: number,
	totalAmount: number,
): string {
	const inv = plugin.settings.invoice;
	const { org } = options;
	const issued = formatDateLong(new Date().toISOString().slice(0, 10));
	const period = `${formatDateLong(options.dateFrom)} – ${formatDateLong(options.dateTo)}`;
	const clientName = options.clientName || org.name;

	const out: string[] = [];
	out.push(`<div class="toolbox-invoice">`);

	// Masthead — issuer as letterhead, "Invoice" + number as the document label.
	out.push(`<header class="ti-masthead">`);
	out.push(`<div class="ti-issuer">`);
	out.push(`<div class="ti-issuer-name">${esc(inv.businessName || "Your business")}</div>`);
	if (inv.abn) out.push(`<div class="ti-issuer-meta">ABN ${esc(inv.abn)}</div>`);
	if (inv.businessAddress) {
		out.push(`<div class="ti-issuer-meta">${esc(inv.businessAddress.replace(/\n/g, ", "))}</div>`);
	}
	out.push(`</div>`);
	out.push(
		`<div class="ti-doclabel"><div class="ti-doctype">Invoice</div>` +
			`<div class="ti-docnum">${esc(options.invoiceLabel)}</div></div>`,
	);
	out.push(`</header>`);

	// Meta strip — issued / period / bill-to.
	out.push(`<section class="ti-meta">`);
	out.push(
		`<div class="ti-meta-block"><span class="ti-eyebrow">Issued</span>` +
			`<span class="ti-meta-val">${esc(issued)}</span></div>`,
	);
	out.push(
		`<div class="ti-meta-block"><span class="ti-eyebrow">Period</span>` +
			`<span class="ti-meta-val">${esc(period)}</span></div>`,
	);
	out.push(
		`<div class="ti-meta-block ti-billto"><span class="ti-eyebrow">Bill to</span>` +
			`<span class="ti-meta-val">${esc(clientName)}</span>`,
	);
	if (options.clientAddress) {
		for (const addrLine of options.clientAddress.split("\n")) {
			if (addrLine.trim()) out.push(`<span class="ti-meta-sub">${esc(addrLine.trim())}</span>`);
		}
	}
	out.push(`</div></section>`);

	// Services ledger — money right-aligned; the footer subtotals hours only,
	// leaving the dollar figure to the Amount-due hero below.
	out.push(`<table class="ti-table"><thead><tr>`);
	out.push(`<th>Date</th><th>Description</th>`);
	out.push(`<th class="ti-num">Hours</th><th class="ti-num">Rate</th><th class="ti-num">Amount</th>`);
	out.push(`</tr></thead><tbody>`);
	for (const entry of entries) {
		out.push(
			`<tr><td>${esc(formatDateLong(entry.date))}</td><td>Professional services</td>` +
				`<td class="ti-num">${entry.hours.toFixed(2)}</td>` +
				`<td class="ti-num">${money(org.rate)}</td>` +
				`<td class="ti-num">${money(entry.amount)}</td></tr>`,
		);
	}
	out.push(`</tbody><tfoot><tr>`);
	out.push(`<td class="ti-foot-label" colspan="2">Total hours</td>`);
	out.push(`<td class="ti-num ti-foot">${totalHours.toFixed(2)}</td><td></td><td></td>`);
	out.push(`</tr></tfoot></table>`);

	// Hero — the bottom line.
	out.push(
		`<div class="ti-total"><span class="ti-total-label">Amount due</span>` +
			`<span class="ti-total-amount">${money(totalAmount)}</span></div>`,
	);

	if (options.notes) {
		out.push(
			`<div class="ti-notes"><span class="ti-eyebrow">Notes</span>` +
				`<p>${esc(options.notes).replace(/\n/g, "<br>")}</p></div>`,
		);
	}

	if (inv.bankName || inv.bsb || inv.accountNumber) {
		out.push(`<section class="ti-pay"><span class="ti-eyebrow">Payment details</span><dl class="ti-paylist">`);
		if (inv.bankName) out.push(`<div><dt>Bank</dt><dd>${esc(inv.bankName)}</dd></div>`);
		if (inv.bsb) out.push(`<div><dt>BSB</dt><dd class="ti-num">${esc(inv.bsb)}</dd></div>`);
		if (inv.accountNumber) {
			out.push(`<div><dt>Account</dt><dd class="ti-num">${esc(inv.accountNumber)}</dd></div>`);
		}
		out.push(`</dl></section>`);
	}

	out.push(`</div>`);
	return out.join("\n");
}

/** Aggregate timesheet entries into daily line items for an invoice. */
export function aggregateEntries(
	parsed: ReturnType<typeof parseTimesheet>,
	orgName: string,
	dateFrom: string,
	dateTo: string,
	rate: number,
): { entries: { date: string; hours: number; amount: number }[]; totalHours: number; totalAmount: number } {
	const entries: { date: string; hours: number; amount: number }[] = [];
	let totalHours = 0;
	let totalAmount = 0;

	const fromDate = dateFrom;
	const toDate = dateTo;

	for (const day of parsed.days) {
		if (day.date < fromDate || day.date > toDate) continue;
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

/** Compute the next invoice label for an org (e.g. "INV-005"). */
export function nextInvoiceLabel(org: TimesheetOrg): { number: number; label: string } {
	const prefix = org.invoicePrefix || "INV";
	const nextNum = (org.lastInvoiceNumber ?? org.invoiceStartNumber ?? 1);
	return {
		number: nextNum,
		label: `${prefix}-${String(nextNum).padStart(3, "0")}`,
	};
}

/** Ensure the invoice output folder exists, creating it if needed. */
async function ensureInvoiceFolder(app: App, path: string): Promise<void> {
	const parts = path.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!current) continue;
		const exists = app.vault.getAbstractFileByPath(current);
		if (!exists) {
			await app.vault.createFolder(current);
		}
	}
}

/**
 * Generate an invoice markdown file and save it.
 * Returns the path of the saved file.
 */
export async function generateInvoice(
	plugin: TasksPlugin,
	options: InvoiceOptions,
): Promise<string> {
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

	if (entries.length === 0) {
		throw new Error("No timesheet entries found for this org and date range.");
	}

	const markdown = buildInvoiceMarkdown(plugin, options, entries, totalHours, totalAmount);

	// Ensure folder exists
	const folder = plugin.settings.invoice.invoiceFolder || "toolbox/Invoices";
	await ensureInvoiceFolder(plugin.app, folder);

	// Build file path
	const filename = `${options.invoiceLabel}-${options.org.name.replace(/[^a-zA-Z0-9]/g, "-")}.md`;
	const filePath = `${folder}/${filename}`;

	// Check if file already exists and append a suffix
	let finalPath = filePath;
	let counter = 1;
	while (plugin.app.vault.getAbstractFileByPath(finalPath) instanceof TFile) {
		const base = filePath.replace(/\.md$/, "");
		finalPath = `${base}-${counter}.md`;
		counter++;
	}

	await plugin.app.vault.create(finalPath, markdown);

	// Update org tracking data
	options.org.lastInvoiceDate = options.dateTo;
	options.org.lastInvoiceNumber = options.invoiceNumber + 1;
	await plugin.saveSettings();

	return finalPath;
}
