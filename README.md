# READ//OS

A hacker-terminal-themed reading tracker. Local-first, offline-capable,
installable as a PWA. No accounts, no server, no build step.

## How data is stored

Everything lives in the browser's `localStorage` under the key `readOS.v1`,
as a single JSON blob. There's no server and nothing is ever sent anywhere.

That means:
- Data is per-browser, per-device — it does **not** sync across devices.
- Clearing your browser's site data for this page wipes everything.
- Use **Settings → Export Data** regularly if you care about the data.

### Export / Import

Export produces a JSON file containing your sessions, books, settings
(including your display name, if set), acknowledged milestones, and a
`version` field. Import has two explicit modes:

- **Replace** (default): the imported file becomes your entire state. The
  file is validated first — malformed sessions/books are quietly dropped
  rather than corrupting the app, and a restored in-progress session is only
  kept if its start time is actually in the past; otherwise it's discarded.
- **Merge** (checkbox in Settings): sessions and books are merged by ID with
  no duplicates, milestones are combined, and your display name is kept
  unless you don't have one yet. Merge **never** restores an imported
  in-progress session — resuming someone else's live timer on top of your
  own could create an invalid state, so that field is always dropped in
  merge mode.

Older exports (or hand-edited/partial JSON) are handled gracefully: missing
fields fall back to sensible defaults rather than failing the import.

## Features

- Start/Stop/Pause a reading session with a live timer and progress ring —
  timing is entirely timestamp-based (`Date.now()` deltas, not a tick
  counter), so it stays correct across backgrounded tabs, locked screens,
  and browser throttling. Coming back to the tab recalculates from the
  actual timestamps rather than trusting an interval to have fired on time.
- A small persistent session indicator (`● READING 00:42:17`) is visible in
  the sidebar/topbar on every page, not just the dashboard — click it to
  jump back to the dashboard. It's driven by the same timer, not a second
  clock.
- Optional per-session time target, and separate daily/weekly goals
- Optional display name (Settings → Profile), included on the downloadable
  PNG stats card and in JSON exports
- Book library: add, edit, delete, and a per-book detail view with its own
  activity heatmap and session history. New books start as **To-Read**
  rather than assumed to already be in progress.
- Full session log: edit or delete any entry, add notes, filter by book,
  date range, or free-text search. A historical session can never be edited
  into ending in the future — the duration is clamped and you're told why.
- Stats: today/week/month/lifetime totals, streaks, a 12-week activity
  heatmap, and the downloadable PNG stats card
- A **global** terminal panel, present on every page (Dashboard, Sessions,
  Books, Book Detail, Stats, Settings) with a shared command history —
  `help`, `dashboard`, `sessions`, `books`, `stats`, `settings`, `start`,
  `stop`, `pause`, `resume`, `today`, `streak`, `history`, `clear`
- Keyboard: spacebar toggles start/stop from anywhere — except while a
  button, link, input, select, textarea, or contenteditable element has
  focus, so it never steals Space from normal control interaction
- Settings: accent color themes, animation toggle, 12/24h time, sound
  effects, delete confirmations, daily/weekly goals, display name, JSON
  export/import (replace or merge)
- A subtle, non-disruptive online/offline indicator reusing the existing
  "SYSTEM ONLINE" status line — it never interrupts or resets an active
  session when connectivity changes

## Known limitations

- Single-device only — no cloud sync, no accounts, no backend, by design.
- No page/percent-complete tracking — only whole sessions and durations are
  tracked per book.
- The service worker caches the app shell only; it never caches or
  transmits your reading data, which stays in `localStorage` exactly as
  before.
