# Timesheet

A sidebar panel for tracking work sessions with a running timer.

## Quick start

1. Open **Settings → Toolbox → Timesheet**.
2. Set the file path (defaults to `timesheet.md`).
3. Add at least one **organisation** with a name, colour, and optional hourly rate.
4. Click the **clock icon** in the ribbon (or run the `Open timesheet` command).

## Features

### Running timer

- Select an org from the dropdown, click **Start**.
- While working: click **Break** to start a break, **Stop** to finish and save.
- While on break: click **Resume** to end the break and return to working.
- The timer state persists across Obsidian restarts (start a session, close
  Obsidian, reopen — the timer picks up where it left off).

### Manual entry

Click the **+** button in the header to manually add an entry with times and
breaks. Useful for backfilling or corrections.

### Week view (shifts)

Shows every shift in the selected week, grouped under a per-day header (with
that day's total). Each shift row has its time range, total hours, break lines,
and edit/delete actions (revealed on hover). Today's group is badged.

The `‹ ›` arrows at the top of this card **step through weeks**; a **This week**
button jumps back to the current week. The whole panel (this list plus the
Summary and Since-last-invoice sections) follows the selected week, so any past
week's shifts are reachable and editable.

### Summary

Groups the selected week's entries (Monday–Sunday) by organisation. Each org row
shows total hours, fractional days (1 day = 7 hours), and estimated earnings
(rate × hours), with a proportion bar for the split and a grand total.

### Since last invoice

Per-org **uninvoiced earnings** — hours tracked since each org's last invoice
(entries on or before `lastInvoiceDate` are treated as billed), multiplied by the
org's rate, with the accrual period and a total outstanding. Only orgs with an
hourly rate appear. This is independent of the week navigation.

## File format

The timesheet file uses human-readable markdown:

```markdown
## 2024-06-30

- 🕐 09:00–17:00 (Org Name)
  - ☕ 12:00–12:30
  - ☕ 14:45–15:00

## 2024-07-01

- 🕐 08:00–12:00 (Other Org)
- 🕐 13:00–17:00 (Org Name)
  - ☕ 13:30–14:00
```

- `## YYYY-MM-DD` — day header
- `- 🕐 HH:MM–HH:MM (Org Name)` — work session
- `  - ☕ HH:MM–HH:MM` — break (indented under its session, can have multiple)

The file is both human-editable and plugin-managed (like the tasks file).
Manual edits are picked up automatically when the file changes.

### Invoice export

The **Generate invoice** button (or `Generate invoice from timesheet` command) opens a
modal that aggregates timesheet entries for a selected org and date range into a
formatted **PDF** invoice (drawn with pdf-lib), saved to the vault and opened in
Obsidian's PDF viewer straight away. The org's colour is the invoice's accent.

In the modal you can also:
- Edit the **line item description** applied to each tracked-hours line (default
  "Professional services").
- Add **custom items** (description + quantity + rate) for anything beyond tracked
  hours — they're appended as line items and included in the amount due.

**Global invoice settings** (Settings → Toolbox → Invoice):
- Business name, ABN, business address (your details).
- Bank name, BSB, account number (appears in the Payment Details section).
- Output folder (default `toolbox/Invoices/`, auto-created).

**Per-org invoice settings** (under each organisation):
- Client name, client address.
- Invoice prefix (e.g. `INV`) and starting number.
- Last invoice date/number (auto-tracked).

The invoice number format is `{prefix}-{number:03d}` (e.g. `INV-001`).
Date range defaults from the day after the last invoice to today.
Invoices are saved as PDF in the configured output folder and opened automatically.

## Settings

| Setting | Description |
|---|---|
| Timesheet file path | Path to the timesheet markdown file |
| Organisations | List of orgs with name, colour picker, hourly rate, client details, and invoice numbering |
| Invoice · Business name | Your business name (appears on invoices) |
| Invoice · ABN | Your Australian Business Number |
| Invoice · Business address | Your business address |
| Invoice · Bank name | Name of your bank (for Payment Details) |
| Invoice · BSB | Bank BSB number |
| Invoice · Account number | Bank account number |
| Invoice · Output folder | Folder for generated invoices (default `toolbox/Invoices/`) |

The colour is used for the dot next to entries and weekly summary rows.
The rate is used to calculate estimated earnings and invoice amounts.
