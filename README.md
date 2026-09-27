# READ//OS

A hacker-terminal-themed reading tracker. Local-first, offline-capable,
installable as a PWA. No accounts, no server, no build step.

## Files

```
index.html              markup + structure
styles.css               all visual styling
app.js                    all application logic (state, rendering, storage)
sw.js                     service worker (offline caching)
manifest.webmanifest       PWA manifest
icons/icon-192.png          app icon
icons/icon-512.png           app icon
icons/icon-512-maskable.png   maskable app icon (Android adaptive icons)
README.md                 this file
```

## Running it

Open `index.html` directly, or serve the folder with any static server:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

A local static server is recommended over `file://` — some browsers restrict
`localStorage` and service workers on `file://` pages.

## Deploying to GitHub Pages

Every asset reference in this project (`styles.css`, `app.js`, the manifest,
the icons, and the service worker registration) uses a **relative path**, on
purpose — so it works whether the app is hosted at a domain root or under a
GitHub Pages project subpath like `https://username.github.io/readOS/`. Just
push the contents of this folder to a repo and enable Pages — no path
changes needed.

## Offline support (PWA)

After the first successful load, `sw.js` caches the full app shell
(`index.html`, `styles.css`, `app.js`, the manifest, and the icons). From
then on the app loads and works with **no network connection at all** —
starting/stopping/pausing sessions, books, stats, the terminal, JSON
export/import, and the PNG stats card all work fully offline, because none
of them ever depended on a network request in the first place. Only the
very first page load needs to be online.

**Updates:** the service worker uses a versioned cache name
(`reados-cache-v1` in `sw.js`). When you change any cached file, bump that
version string — the old cache is cleaned up automatically on the next
visit, so users are never permanently stuck on stale assets, and your
`localStorage` data is never touched by this process.

**Installability:** with the manifest and service worker in place, supported
browsers will offer their normal "Install" / "Add to Home Screen" UI. This
app doesn't show its own custom install prompt.

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

## Notes on the code

- No frameworks, no build tooling — plain HTML/CSS/JS on purpose.
- `app.js` is one IIFE. State lives in a single `state` object, persisted to
  `localStorage` on every mutation via `save()`. `normalizeState()` runs on
  every load (and on replace-import) so older or hand-edited save data can
  never crash the app — missing fields are filled with safe defaults rather
  than assumed to exist.
- The terminal is instantiated exactly **once**, mounted outside the
  per-view render cycle, so its command history persists as you navigate
  and `help` behaves identically everywhere.
- The day-popover's outside-click handler is a single delegated
  `document`-level listener registered once at startup — repeated
  navigation to Stats or a Book Detail page never adds duplicate listeners.
- File downloads (export / stats card) try a `window.claude` downloads
  bridge first (present when hosted as a Claude artifact) and fall back to
  a plain `<a download>` link everywhere else — which is the normal path
  when self-hosted, including on GitHub Pages.
- `showConfirm()` is a custom in-page modal, not the browser's native
  `confirm()` — native dialogs are blocked in some embedded/sandboxed
  contexts, so this keeps delete/clear/import confirmations reliable
  everywhere.

## Known limitations

- Single-device only — no cloud sync, no accounts, no backend, by design.
- No page/percent-complete tracking — only whole sessions and durations are
  tracked per book.
- The service worker caches the app shell only; it never caches or
  transmits your reading data, which stays in `localStorage` exactly as
  before.
