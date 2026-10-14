# CLB Calendar

Read-only Google Calendar household planner. React + TypeScript + Vite; a dense, Excel-inspired rolling planner with collapsible calendar selection and event details. No backend, database, persistent event cache, service worker, offline support or deployment automation. M2 implements the rolling planner; editing and other M3 features are not included.

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
   - `https://www.googleapis.com/auth/calendar.events.readonly`
6. In **Clients → Create client**, choose **Web application**, and give it a name. This is a browser OAuth client, not a Desktop client or service account.
7. Add these **Authorised JavaScript origins** (origins have no path or trailing slash):
   - `http://localhost`
   - `http://localhost:5173` (development)
   - `http://localhost:4173` (production preview)
   - Later, `https://YOUR_USERNAME.github.io` or your exact HTTPS custom-domain origin. For `https://YOUR_USERNAME.github.io/clb-calendar/`, register the origin without `/clb-calendar/`.
8. No authorised redirect URI is needed for this GIS popup token flow. Create the client, copy only its **Client ID** into `.env.local`, and restart Vite. Never put a client secret, credentials JSON or service-account key into this repository. Configuration changes can take time to propagate.
9. Open the app, click **Sign in with Google**, choose an added test account and grant **both** read-only permissions. Allow popups and Google scripts. Confirm the calendars, then select the ones to include. Primary calendar is initially selected when readable.

The client ID is public and embedded in the build. These permissions read calendars/events; no profile, email or OpenID scope is requested. OAuth authorisation itself establishes the app's session. Testing/unverified-app restrictions and Workspace administrator policies can affect sign-in. Review Google's verification requirements before changing the audience to Production; public frontend hosting does not itself grant access to anyone's private calendars.

## Build for static hosting

```sh
npm run check
npm test
npm run build
npm run preview
```

Open **http://localhost:4173/** for the build preview. Publish only the contents of `dist/` to GitHub Pages or another HTTPS static host. Vite uses `base: './'`, so assets work under `/clb-calendar/` as well as at a domain root; there is no router or server fallback requirement. Set the client ID before building, and rebuild to change it. Do not deploy the source tree, `.env.local` or the test fixture. No GitHub Actions workflow is included.

## Architecture and behaviour

- `src/auth.ts`: loads the official GIS script from Google, requests the two narrow read-only scopes, validates granted permissions, keeps the access token and expiry only in memory, and handles popup errors. Every user-clicked token request uses `prompt: ''`: Google obtains any missing initial consent and can reuse saved consent on subsequent sign-in, including after a browser refresh. The app does not force account selection or consent. Refresh still returns to the sign-in button because tokens are not persisted; Google may show a popup/account chooser when its session requires it (for example, multiple accounts). Expiry returns to sign-in; renewal requires another click. There is no refresh token or silent/background authorisation.
- `src/calendar-api.ts`: authenticated REST GETs with `cache: 'no-store'`, calendar/event pagination and normalisation. Events use `singleEvents=true` and `orderBy=startTime`, so recurring series produce individual instances; cancellations are omitted. Full refreshes replace results atomically; a failing calendar prevents the retrieval from being reported as complete.
- `src/types.ts`: provider-independent calendar/event types, preserving calendar ownership, Google event ID, iCalUID, recurrence parent/original start, organiser and timing metadata. The same event on two selected calendars remains two separate calendar-owned records.
- `src/dates.ts`: local-midnight API query bounds and source timestamp formatting. All ends are exclusive. Original all-day dates and timed offsets/IANA zones are preserved for event details.
- `src/planner-layout.ts`: pure civil-date calculations and deterministic track allocation. The initial horizon includes two preceding months, the current month and ten future months (13 in total). Monday is the first column; all months use the same 42 consistently aligned day columns (six weeks), including months with only four or five weeks. Events sort by clipped start, longer span first, then calendar/event identity, and occupy the lowest non-overlapping track. Timed dates use the browser's time zone, explicitly shown above the planner; exclusive midnight ends and DST transitions use instant-to-zone conversion, never local 24-hour arithmetic. All-day dates retain their Google date-only semantics. Query bounds include two days of padding for calendars in other zones; those extra dates are clipped out of the view.
- `src/planner-events.ts`: temporary per-calendar, per-range session cache. Calendar visibility toggles filter immediately and reuse loaded events; horizon expansion fetches only uncovered intervals. Cross-range events deduplicate by calendar/event identity. Coverage and events commit together only after a successful, non-aborted load. **Refresh** invalidates the cache, rediscovers calendars and rereads selected events. External Google changes appear on manual refresh; this is not background sync.
- `src/Planner.tsx`: compact month rows, continuous month-spanning bars, weekday/weekend bands, sticky labels, Today navigation and a read-only modal details panel. Previous/Next month extend and scroll the horizon by one month; Today brings the current date into view. Columns share the available desktop width, with a 27px minimum and a 48px month-label column. A single shared horizontal scroll is used on narrower screens; months scroll vertically with the page. The compact sticky toolbar and weekday header keep navigation accessible. Event text is 12px, tracks are 25px, date headers are 20px and empty months are about 39px. Populated month height follows track count, so the visible number of months varies with actual overlaps. Counts, timing diagnostics and the permanent category legend are removed from the default interface. Wide event labels are centred; shorter labels align left and truncate only within their actual bar width. Full titles appear in native tooltips and details; Escape, Close or the backdrop dismisses details. There is no virtualisation or separate mobile view.
- `src/App.tsx`: existing public login gate plus authenticated calendar dropdown, compact toolbar and planner. Outstanding requests are aborted on selection/horizon changes or sign-out and late responses are ignored. React renders all Google text as text, never HTML.
- `src/categories.ts`: central category fills/text colours and a small `CALENDAR_CATEGORIES` map from exact Google calendar ID to default category. Populate this map when you want to assign defaults; find IDs in Google Calendar settings → Integrate calendar → Calendar ID. Unmapped calendars use **Other**. Categories are Bank Holiday, Social, Holiday, Sport, Wedding, Work / Jobs, Garden and Other. Ownership is independent: Google calendar colour supplies the narrow bar stripe and calendar detail indicator. No owner-based category inference, retired Louise category, category editor or category persistence is included.

Discovery uses Google's CalendarList API, including hidden subscribed calendars. Google does not offer a listing of every unsubscribed calendar a user could theoretically access. Add shared calendars to the user's Google Calendar list to discover them here. Free/busy-only calendars appear disabled; Google enforces ACLs and hides details that the account may not read. Calendar colours, descriptions, roles, zones and primary flags are retained.

## Privacy and browser limitations

Tokens, calendars, selection, event cache and planning horizon are held in memory only. Reloading or closing the app loses its session. No localStorage, sessionStorage, IndexedDB, analytics, persistent API caching, token logging or event persistence is used. **Sign out** clears private app state and cancels requests immediately; it does not sign out of Google globally or revoke Google's saved consent. Revoke that separately in your Google Account's third-party access settings when needed.

A 401 clears the session. A 403 clears stale events and shows an actionable permission/API/quota error while retaining the session; refresh after correcting the cause. Other API/network errors are displayed without exposing Google's raw response body. Retrieval duration measures the selected-calendar event requests, not the preceding calendar discovery.

This is a browser-only app: tokens must temporarily be readable by its JavaScript, so a compromised browser, extension or same-origin script can access them while active. Use trusted devices, HTTPS outside localhost, and avoid adding untrusted scripts. No server enforces household membership; Google consent, the OAuth testing audience and calendar sharing permissions determine access. GIS needs internet access and may be blocked by popup restrictions, content blockers or organisational policy. Use a separate origin for unrelated untrusted apps: GitHub Pages repository paths on the same hostname share an origin. No claim of real-account OAuth or iPad/Safari verification has been made.

## Verification

`npm test` uses Node's built-in runner with no extra test dependency. Covers existing OAuth/API behaviour plus weekday alignment, four/five/six-week months, leap days, month/year boundaries, exclusive ends, midnight/DST/zone conversion, deterministic track packing, category fallback/contrast, calendar filtering, session coverage, incremental fetches and cancellation. `npm run build` includes strict TypeScript checks.

For disposable browser integration checks, run the dev server and open **http://localhost:5173/tests/browser.html**, then click **Run browser checks**. It mounts the real UI with fake Google SDK/API responses and rejects persistent-storage writes. It makes no Google requests and is excluded from `dist/`. Reload the test page to run again. Checks cover the login gate, permissions, text escaping, selection/cache reuse, refresh, 401/403, logout/expiry, rolling months, bar widths, overlap tracks, multi-month/year details and Today/horizon navigation. The fixture uses fixed 2026/2027 dates; update them when testing outside that horizon.

After configuring a real client, manually verify sign-in with each intended account; discover shared and hidden calendars; test selection, empty calendars, recurring/moved/cancelled instances, all-day/multi-month and DST events; extend the horizon and use Today; open details; refresh; deny consent/close the popup; sign out and check that no private data remains. Verify Safari/iPad and desktop usability, including dense real calendars and horizontal scrolling. Browser stubs cannot verify Google's popup, real consent, ACLs or actual API data. The horizon/session cache grows as you extend it and lasts until refresh/sign-out; no virtualisation or eviction is implemented. No offline/PWA installation behaviour is implemented in this milestone.

Official references consulted: [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [GIS setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [client-side OAuth](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

For M2.1 visual validation, open **http://localhost:5173/tests/layout.html** while Vite runs. This disposable fixture contains representative events across eight sample calendars, busy and empty months, single-day events and month/year spans. It makes no Google requests and is excluded from the production build. Desktop checks at 1280, 1440 and 1920px widths (1080px height) show five fully visible populated months in this fixture; no fixed visible-month count is imposed. Check narrow-screen horizontal scrolling and the calendar dropdown as well.
