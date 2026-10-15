# CLB Calendar

Google Calendar household planner with ordinary event creation, editing and deletion. React + TypeScript + Vite; a dense, Excel-inspired rolling planner with collapsible calendar selection, date-based creation and event details. No backend, database, persistent event cache, service worker or offline support. GitHub Actions builds and publishes the static application to GitHub Pages.

## Install and run

Use Node.js 22.18+ (Node 24 recommended) and npm. From this repository:

```sh
npm ci
```

Copy `.env.example` to `.env.local` and replace the placeholder:

```dotenv
VITE_GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

```sh
npm run dev
```

Open **http://localhost:5173/**. The port is fixed to keep OAuth origins predictable. Restart Vite after changing configuration. Without a configured client ID the login page still loads; clicking sign-in explains the missing configuration.

## Google Cloud configuration (manual)

1. Open [Google Cloud Console](https://console.cloud.google.com/), create a project (for example **CLB Calendar**) and select it.
2. In **APIs & Services → Library**, find **Google Calendar API** and click **Enable** in that project.
3. In **Google Auth Platform → Branding**, click **Get started** if required. Enter the app name, your support email and developer/contact email. Review Google's user-data policy and complete the setup.
4. Choose **External** for personal Google accounts. In **Audience**, keep the app in **Testing** and add both intended household users' actual Google email addresses as **Test users**. No accounts are hardcoded in this app. Workspace Internal audience is only appropriate if all users belong to that organisation.
5. In **Data Access → Add or remove scopes**, add exactly these two scopes and save:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
6. In **Clients → Create client**, choose **Web application**, and give it a name. This is a browser OAuth client, not a Desktop client or service account.
7. Add these **Authorised JavaScript origins** (origins have no path or trailing slash):
   - `http://localhost`
   - `http://localhost:5173` (development)
   - `http://localhost:4173` (production preview)
   - Later, `https://YOUR_USERNAME.github.io` or your exact HTTPS custom-domain origin. For `https://YOUR_USERNAME.github.io/clb-calendar/`, register the origin without `/clb-calendar/`.
8. No authorised redirect URI is needed for this GIS popup token flow. Create the client, copy only its **Client ID** into `.env.local`, and restart Vite. Never put a client secret, credentials JSON or service-account key into this repository. Configuration changes can take time to propagate.
9. Open the app, click **Sign in with Google**, choose an added test account and grant calendar discovery and event read/write permissions. Allow popups and Google scripts. Confirm the calendars, then select the ones to include. Primary calendar is initially selected when readable.

The client ID is public and embedded in the build. These permissions discover calendars and read/write events on calendars where Google grants access; no profile, email or OpenID scope is requested. OAuth authorisation itself establishes the app's session. Testing/unverified-app restrictions and Workspace administrator policies can affect sign-in. Review Google's verification requirements before changing the audience to Production; public frontend hosting does not itself grant access to anyone's private calendars.

## Build for static hosting

```sh
npm run check
npm test
npm run build
npm run preview
```

Open **http://localhost:4173/clb-calendar/** for the production preview. Vite builds with `base: '/clb-calendar/'` for **https://chrislark1.github.io/clb-calendar/**; normal localhost development stays at `/`. Publish only `dist/`, never the source tree, `.env.local` or browser test fixtures. The client ID is embedded at build time; rebuild to change it.

## GitHub Pages deployment

Review `.github/workflows/pages.yml` and `vite.config.ts` before committing/pushing this configuration; a push to `main` will trigger deployment once Pages is configured.

1. In the repository's **Settings → Secrets and variables → Actions → Variables**, add the repository variable **VITE_GOOGLE_CLIENT_ID** with the Google Web application client ID. It is a public frontend identifier, not a client secret. `.env.local` remains ignored and continues to supply local development configuration; Actions uses the repository variable instead.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as Source. Ensure Actions are enabled and repository policies allow the official `actions/*` actions. If GitHub reports Pages unavailable for the repository's visibility/plan, resolve that in repository/account settings first.
3. In the Google OAuth Web client's **Authorised JavaScript origins**, add **https://chrislark1.github.io** (no `/clb-calendar/` path). Keep the localhost origins for development and preview. No redirect URI is required by the existing GIS popup flow.
4. After review, push the configuration to `main`, or use **Actions → Deploy GitHub Pages → Run workflow** on `main`. The workflow runs `npm ci`, existing tests, TypeScript checks and the production build, then publishes only `dist/` using the official Pages Actions. A missing client-ID variable fails the build. Manual runs on other branches cannot deploy.

The `github-pages` environment records the deployment URL. Configure required reviewers there if each future deployment needs approval; otherwise successful pushes to `main` deploy automatically. The configuration can be validated locally without publishing, and adding it locally does not enable Pages or change GitHub settings. See the [GitHub Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [Vite deployment guide](https://vite.dev/guide/static-deploy.html#github-pages).

## Architecture and behaviour

- `src/auth.ts`: loads the official GIS script from Google, requests CalendarList read-only plus Calendar event read/write scopes, validates granted permissions, keeps the access token and expiry only in memory, and handles popup errors. Every user-clicked token request uses `prompt: ''`: Google obtains any missing initial consent and can reuse saved consent on subsequent sign-in, including after a browser refresh. The app does not force account selection or consent. Refresh still returns to the sign-in button because tokens are not persisted; Google may show a popup/account chooser when its session requires it (for example, multiple accounts). Expiry returns to sign-in; renewal requires another click. There is no refresh token or silent/background authorisation.
- `src/calendar-api.ts`: authenticated REST requests with `cache: 'no-store'`, calendar/event pagination and normalisation. Events use `singleEvents=true` and `orderBy=startTime`, so recurring series produce individual instances; cancellations are omitted. Full refreshes replace results atomically; a failing calendar prevents the retrieval from being reported as complete.
- `src/types.ts`: provider-independent calendar/event types, preserving calendar ownership, Google event ID, iCalUID, recurrence parent/original start, organiser and timing metadata. The same event on two selected calendars remains two separate calendar-owned records.
- `src/dates.ts`: local-midnight API query bounds and source timestamp formatting. All ends are exclusive. Original all-day dates and timed offsets/IANA zones are preserved for event details.
- `src/planner-layout.ts`: pure civil-date calculations and deterministic track allocation. The initial horizon includes two preceding months, the current month and ten future months (13 in total). Monday is the first column; all months use the same 42 consistently aligned day columns (six weeks), including months with only four or five weeks. Events sort by clipped start, longer span first, then calendar/event identity, and occupy the lowest non-overlapping track. Timed dates use the browser's time zone, explicitly shown above the planner; exclusive midnight ends and DST transitions use instant-to-zone conversion, never local 24-hour arithmetic. All-day dates retain their Google date-only semantics. Query bounds include two days of padding for calendars in other zones; those extra dates are clipped out of the view.
- `src/planner-events.ts`: temporary per-calendar, per-range session cache. Calendar visibility toggles filter immediately and reuse loaded events; horizon expansion fetches only uncovered intervals. Cross-range events deduplicate by calendar/event identity. Coverage and events commit together only after a successful, non-aborted load. **Refresh** invalidates the cache, rediscovers calendars and rereads selected events. External Google changes appear on manual refresh; this is not background sync.
- `src/Planner.tsx`: compact month rows, continuous month-spanning bars, weekday/weekend bands, sticky labels and Today navigation. Previous/Next navigate one month from the current viewport. The month/year picker accepts 1900–2199; nearby navigation reuses or extends the horizon, while distant navigation replaces it with a 13-month window. The horizon is limited to 36 months and the session cache evicts data outside it. Selected calendars are preserved. Month navigation retains horizontal scroll; Today also brings today's column into view. Columns share the available desktop width, with a 27px minimum and a 48px month-label column. A single shared horizontal scroll is used on narrower screens; months scroll vertically with the page. The compact sticky toolbar and weekday header keep navigation accessible. Event text adapts between 7–11px over at most two centred lines; tracks remain 25px and date headers 20px. Populated month height follows track count. Full titles appear in native tooltips and details. There is no virtualisation or separate mobile view.
- `src/App.tsx`: existing public login gate plus authenticated calendar dropdown, compact toolbar and planner. Outstanding requests are aborted on selection/horizon changes or sign-out and late responses are ignored. React renders all Google text as text, never HTML.
- `src/categories.ts`: central category fills/text colours and a small `CALENDAR_CATEGORIES` map from exact Google calendar ID to default category. Populate this map when you want to assign defaults; find IDs in Google Calendar settings → Integrate calendar → Calendar ID. Unmapped calendars use **Other**. Categories are Bank Holiday, Social, Holiday, Sport, Wedding, Work / Jobs, Garden and Other. Ownership is independent: Google calendar colour supplies the narrow bar stripe and calendar detail indicator. No owner-based category inference, retired Louise category, category inference or local metadata store is included. Explicit categories are persisted in Google shared extended properties under `clbCalendarCategory`, with precedence over configured calendar defaults and Other; unknown metadata values fall back safely.

Discovery uses Google's CalendarList API, including hidden subscribed calendars. Google does not offer a listing of every unsubscribed calendar a user could theoretically access. Add shared calendars to the user's Google Calendar list to discover them here. Free/busy-only calendars appear disabled; Google enforces ACLs and hides details that the account may not read. Calendar colours, descriptions, roles, zones and primary flags are retained.

## Privacy and browser limitations

Tokens, calendars, selection, event cache and planning horizon are held in memory only. Reloading or closing the app loses its session. No localStorage, sessionStorage, IndexedDB, analytics, persistent API caching, token logging or local event persistence is used. Google Calendar remains the canonical persistent event store. **Sign out** clears private app state and cancels requests immediately; it does not sign out of Google globally or revoke Google's saved consent. Revoke that separately in your Google Account's third-party access settings when needed.

A 401 clears the session. A 403 clears stale events and shows an actionable permission/API/quota error while retaining the session; refresh after correcting the cause. Other API/network errors are displayed without exposing Google's raw response body. Mutation errors retain the draft. A 412 indicates a concurrent event change; close, refresh and reopen before editing.

This is a browser-only app: tokens must temporarily be readable by its JavaScript, so a compromised browser, extension or same-origin script can access them while active. Use trusted devices, HTTPS outside localhost, and avoid adding untrusted scripts. No server enforces household membership; Google consent, the OAuth testing audience and calendar sharing permissions determine access. GIS needs internet access and may be blocked by popup restrictions, content blockers or organisational policy. Use a separate origin for unrelated untrusted apps: GitHub Pages repository paths on the same hostname share an origin. No claim of real-account OAuth or iPad/Safari verification has been made.

## Verification

`npm test` uses Node's built-in runner with no extra test dependency. Covers existing OAuth/API behaviour plus weekday alignment, four/five/six-week months, leap days, month/year boundaries, exclusive ends, midnight/DST/zone conversion, deterministic track packing, category fallback/contrast, calendar filtering, session coverage, incremental fetches and cancellation. `npm run build` includes strict TypeScript checks.

For disposable browser integration checks, run the dev server and open **http://localhost:5173/tests/browser.html**, then click **Run browser checks**. It mounts the real UI with fake Google SDK/API responses and rejects persistent-storage writes. It makes no Google requests and is excluded from `dist/`. Reload the test page to run again. Checks cover the login gate, permissions, text escaping, selection/cache reuse, refresh, 401/403, logout/expiry, rolling months, bar widths, overlap tracks, multi-month/year details and Today/horizon navigation. The fixture uses fixed 2026/2027 dates; update them when testing outside that horizon.

After configuring a real client, manually verify sign-in with each intended account; discover shared and hidden calendars; test selection, empty calendars, recurring/moved/cancelled instances, all-day/multi-month and DST events; extend the horizon and use Today; open details; refresh; deny consent/close the popup; sign out and check that no private data remains. Verify Safari/iPad and desktop usability, including dense real calendars and horizontal scrolling. Browser stubs cannot verify Google's popup, real consent, ACLs or actual API data. The horizon/session cache grows as you extend it and lasts until refresh/sign-out; no virtualisation or eviction is implemented. No offline/PWA installation behaviour is implemented in this milestone.

Official references consulted: [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [GIS setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [client-side OAuth](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

For M2.1 visual validation, open **http://localhost:5173/tests/layout.html** while Vite runs. This disposable fixture contains representative events across eight sample calendars, busy and empty months, single-day events and month/year spans. It makes no Google requests and is excluded from the production build. Desktop checks at 1280, 1440 and 1920px widths (1080px height) show five fully visible populated months in this fixture; no fixed visible-month count is imposed. Check narrow-screen horizontal scrolling and the calendar dropdown as well.

## M3.1 event editing

Existing installations must replace `calendar.events.readonly` with `calendar.events` in **Google Auth Platform → Data Access**, keeping `calendar.calendarlist.readonly`. Use the same Web OAuth client and authorised origins. Sign out/reload, then sign in and approve the new event read/write permission. GIS uses `prompt: ''` to reuse existing grants and ask for missing permissions. No profile scopes, client secrets, backend or stored refresh tokens are introduced. Calendar event scope covers shared writable calendars; owned-only scope would exclude them. Review consent/verification requirements before moving out of Testing.

**New event** opens an all-day draft defaulting to today. Only writable calendars appear. Existing ordinary events offer **Edit** in details; they stay on their original calendar. Recurring instances/series, special event types, locked copies, restricted private events and guest events without modification rights remain read-only with an explanation. Google remains the authority for ACLs; write requests may still return 403.

The form requires a title and offers the central categories, inclusive all-day start/end dates, optional note and these timing modes: All day; AM (08:00–13:00); PM (13:00–18:00); Evening (18:00–23:00); Custom (exact editable times). Shortcuts are normal timed events, not Google event types. Europe/London is the fallback zone; a new event uses its selected calendar's zone, and existing events use their original event/calendar zone. The editable IANA zone is shown for timed events. Timed end date/time is the actual endpoint; use the following end date for an overnight event. All-day end dates convert to Google's exclusive next date.

`src/editor-model.ts` handles permissions, drafts and conversion. Existing timed events always open as Custom. Unchanged endpoints are omitted from PATCH entirely, preserving original timestamps, seconds/fractions, offsets and potentially different endpoint zones. Explicit timing changes use IANA-zone conversion. DST gaps and duplicated fall-back clock times are rejected with a clear message rather than shifted/guessed; existing ambiguous timestamps are preserved when their timing is unchanged. To change a time in a repeated clock hour, use Google Calendar or choose an unambiguous time in this editor.

`src/EventEditor.tsx` provides the compact modal, immediate duplicate-submit guard, error handling and explicit **Delete event → Confirm delete** flow. Cancel before submission makes no change. Form controls are disabled during mutations; Escape/Cancel cannot interrupt a pending save. Logout/expiry unmounts the editor and aborts client requests, but a request already received by Google may still commit. Reauthorise and refresh to confirm its result; this app never claims an abort rolls back a cloud write.

`src/calendar-api.ts` implements POST, PATCH and DELETE. Updates/deletions fetch the latest event, recheck editing restrictions and use its ETag with If-Match; a changed editor snapshot is rejected. PATCH leaves unrelated event fields (attendees, reminders, location, conference data, etc.) untouched and merges fresh private/shared extended properties before setting the category key. Shared category metadata is visible across attendee copies; do not put private notes in that key. No attendee editor, invitations UI or notification system is added; Google controls any effects on existing guests.

New drafts have stable client-generated Google-compatible event IDs. Double submissions are blocked both by the editor and API client. Retrying an uncertain create uses the same ID; a 409 is recovered only when the existing event matches the intended values. If it differs, refresh and edit the existing event rather than creating another. Edits/deletions are not automatically retried after uncertain network results. Successful writes invalidate only the affected calendar's in-memory coverage and fetch its canonical events again; other loaded calendars are reused. Newly used calendars are selected and the horizon extends when needed to include a saved event. A failed post-save refresh cannot undo a confirmed write; retry Refresh.

Click or tap an uncovered date area to open an all-day draft with that date as both inclusive endpoints. The preferred writable calendar follows the existing New event logic (primary writable calendar, otherwise the first writable calendar). Date creation remains available when viewing read-only calendars if another writable calendar exists; otherwise date targets are disabled with an explanation. Tab enters the date surface; arrow keys move by one day or seven days and Enter/Space opens the editor. Event bars open details independently. Set the end date in the editor for multiple-day events; Shift-click and drag selection are not implemented. Native scrolling is used without custom touch gestures. The modal blocks background interaction, scrolls internally and keeps Cancel/Save/Delete accessible; coarse-pointer controls have larger targets.

No offline editing, cross-calendar movement, recurrence editing, drag selection, backend or database is implemented. Responsive Chromium checks cover 1440px, 1024px, 768px and 390px viewports. Physical iPad/Safari and touch-scrolling behaviour still require device verification; the browser test tool does not expose touch emulation.

For disposable editing browser checks, open **http://localhost:5173/tests/editing.html** while Vite runs and click **Run editing checks**. It uses fake OAuth and an in-memory Google API stub; no Google requests or persistent storage are used. The fixture checks create/update/delete, repeated submissions, exclusive dates, category persistence, preserved metadata/timestamps, API-error recovery, read-only/recurring restrictions and fresh-session reloads. Like the other fixtures it uses 2026 dates and is excluded from `dist/`.

Manual real-account verification is still required: approve the new scope, create a disposable event on a writable calendar, refresh/reload and confirm dates/category in CLB Calendar and Google Calendar; edit title/note without changing existing custom times; test a timed/overnight event and explicit all-day conversion; confirm deletion of the disposable event; verify read-only and recurring calendars remain protected. Also check iPad/Safari form controls. Do not use real appointments for disposable tests.

Official mutation references: [Insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [Delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete), [Extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties), [ETag concurrency](https://developers.google.com/workspace/calendar/api/guides/version-resources).
