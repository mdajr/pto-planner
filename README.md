# PTO Planner

Note: This project was generated collaboratively using Google Gemini and OpenAI ChatGPT.

PTO Planner is a lightweight, client‑side web tool to plan future paid time off. It simulates monthly accruals, caps, and year‑end rollover, and lets you add named vacations over arbitrary date ranges. The timeline shows how your balances evolve over time and flags any periods where balances would go negative.

No backend or account is required — everything runs in your browser. Your data is stored locally via `localStorage`, and you can export/import JSON backups.

## Features

- Date‑range vacation planning with optional names (e.g., “Annie’s Birthday Trip”).
- Accrual rules (configurable in code):
  - Standard PTO: 13.34 h/month, balance cap 160 h.
  - Flex PTO: 10 h on Jan 1, 8 h for Feb–Dec, annual credited cap 48 h, carryover cap 48 h, balance cap 96 h.
- Per‑day vacation modeling (skips weekends and recognized US holidays), but the UI shows a single entry per vacation.
- Year‑end rollover merged into the Jan 1 entry with clear indication of any forfeited hours.
- Warnings when balances hit caps and when a vacation would be under‑funded.
- Import/Export of your state using date‑safe `YYYY-MM-DD` strings.
- Auto‑save to `localStorage` so your data persists across reloads.

## Getting Started

1. Clone or download the repo.
2. Serve the folder over HTTP (module imports require it):
   - Python: `python3 -m http.server 8000`
   - Node: `npx http-server -p 8000`
   - VS Code: Live Server extension
3. Open `http://localhost:8000/` to load `index.html`.

Tip: Opening `index.html` directly from the filesystem (file://) won’t work because ES modules require HTTP.

## Usage

- Enter current balances for Standard and Flex PTO.
- Click the date input to select a vacation start → end range.
- Optionally add a name for your vacation.
- Use the suggestion (workdays × 8 h) or enter hours manually and add the vacation.
- The timeline will display projected balances, monthly accruals, and a vacation entry at the start date.
- Use Export to download a JSON snapshot and Import to restore later.

## Configuration

Core rules live in `src/pto-core.js` under `DEFAULT_CONFIG`. You can change:
- Monthly accrual rate for Standard PTO and its cap.
- Flex monthly pattern, annual credited cap, carryover cap, and balance cap.
- Workday hours per day used by suggestions and per‑day modeling.

Holidays are computed programmatically (US set: New Year’s, MLK Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas). Adjust or extend in the same file if needed.

## Tech Notes

- UI: `index.html` uses Tailwind CDN and Litepicker (pinned) for date range selection.
- Business logic: `src/pto-core.js` (pure functions), imported as an ES module.
- Persistence: `localStorage` plus JSON export/import with `YYYY-MM-DD` dates.
- Tests: Node’s built‑in test runner.

Run tests:

```
node --test
```

## Limitations

- Requires a modern browser with ES module support.
- Relies on CDNs for Tailwind and Litepicker by default; vendor files locally if needed for offline/corporate environments.
- Overlapping vacations are not merged or warned yet.

## Project Structure

- `index.html` – UI and rendering
- `src/pto-core.js` – core logic (accruals, holidays, ledger, import/export)
- `test/pto-core.test.js` – unit tests for the core

## Privacy

Data stays in your browser. Use Export/Import to back up or move data between browsers.
