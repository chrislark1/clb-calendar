# CLB Calendar

Small, read-only Google Calendar foundation for a future household planner. React + TypeScript + Vite; temporary calendar checkboxes and chronological event list. No backend, database, persistent event cache, service worker, offline support or deployment automation. The annual planner is a later milestone.

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

- `src/auth.ts`: loads the official GIS script from Google, requests the two narrow read-only scopes, validates granted permissions, keeps the access token and expiry only in memory, and handles popup errors. Expiry returns to sign-in; renewal requires another click. There is no refresh token or silent/background authorisation.
- `src/calendar-api.ts`: authenticated REST GETs with `cache: 'no-store'`, calendar/event pagination and normalisation. Events use `singleEvents=true` and `orderBy=startTime`, so recurring series produce individual instances; cancellations are omitted. Full refreshes replace results atomically; a failing calendar prevents the retrieval from being reported as complete.
- `src/types.ts`: provider-independent calendar/event types. Preserve calendar ownership, Google event ID, iCalUID, recurrence parent/original start, organiser and relevant timing metadata. The future planner can consume these without Google response types. The same event on two selected calendars remains two separate calendar-owned records.
- `src/dates.ts`: a rolling default from two calendar months before today to ten after, clamped at month ends; local-midnight query bounds. The end date is exclusive. Overlapping events are returned per Google's API bounds. All-day dates remain date strings with exclusive ends; timed values keep their original offsets and optional IANA zone. The temporary list shows those values explicitly without converting them to the browser time zone.
- `src/App.tsx`: public login gate and authenticated selection/range/summary/list. Selection and applied date changes retrieve events; **Refresh** rediscovers calendars and rereads events. Outstanding fetches are aborted on changes or sign-out and late responses are ignored. React renders calendar/event text as text, never HTML.

Discovery uses Google's CalendarList API, including hidden subscribed calendars. Google does not offer a listing of every unsubscribed calendar a user could theoretically access. Add shared calendars to the user's Google Calendar list to discover them here. Free/busy-only calendars appear disabled; Google enforces ACLs and hides details that the account may not read. Calendar colours, descriptions, roles, zones and primary flags are retained.

## Privacy and browser limitations

Tokens, calendars, selection and events are held in memory only. Reloading or closing the app loses its session. No localStorage, sessionStorage, IndexedDB, analytics, API caching, token logging or event persistence is used. **Sign out** clears private app state and cancels requests immediately; it does not sign out of Google globally or revoke Google's saved consent. Revoke that separately in your Google Account's third-party access settings when needed.

A 401 clears the session. A 403 clears stale events and shows an actionable permission/API/quota error while retaining the session; refresh after correcting the cause. Other API/network errors are displayed without exposing Google's raw response body. Retrieval duration measures the selected-calendar event requests, not the preceding calendar discovery.

This is a browser-only app: tokens must temporarily be readable by its JavaScript, so a compromised browser, extension or same-origin script can access them while active. Use trusted devices, HTTPS outside localhost, and avoid adding untrusted scripts. No server enforces household membership; Google consent, the OAuth testing audience and calendar sharing permissions determine access. GIS needs internet access and may be blocked by popup restrictions, content blockers or organisational policy. Use a separate origin for unrelated untrusted apps: GitHub Pages repository paths on the same hostname share an origin. No claim of real-account OAuth or iPad/Safari verification has been made.

## Verification

`npm test` uses Node's built-in runner with stubbed OAuth/fetch and no extra test dependency. Covers scopes, token lifecycle, partial consent, popup failure, late callbacks, calendar/event pagination, recurrence metadata, ownership, all-day/timed dates, empty calendars, errors and cancellation. `npm run build` includes strict TypeScript checks.

For disposable browser integration checks, run the dev server and open **http://localhost:5173/tests/browser.html**, then click **Run browser checks**. It mounts the real UI with fake Google SDK/API responses and rejects persistent-storage writes. It makes no Google requests and is excluded from `dist/`. Reload the test page to run again. Its checks cover the login gate, permissions, text escaping, selection, refresh, 401/403, logout and expiry.

After configuring a real client, manually verify sign-in with each intended account; discover shared and hidden calendars; test checkbox selection, an empty calendar, recurring/moved/cancelled instances, all-day multi-day and DST events; apply a date range; refresh; deny consent/close the popup; sign out and check that no private data remains. Verify in Safari/iPad as well as a desktop browser. Browser stubs cannot verify Google's popup, real consent, ACLs or actual API data. No offline/PWA installation behaviour is implemented in this milestone.

Official references consulted: [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [GIS setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [client-side OAuth](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).
