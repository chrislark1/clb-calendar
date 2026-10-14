export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string }
interface OAuth {
  initTokenClient(config: {
    client_id: string; scope: string; include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type: string }) => void;
  }): { requestAccessToken(config: { prompt: string }): void };
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
}
declare global { interface Window { google?: { accounts: { oauth2: OAuth } } } }

let sdkPromise: Promise<OAuth> | undefined;
export function loadGoogle(): Promise<OAuth> {
  if (window.google?.accounts.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<OAuth>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error('Google authorisation could not load. Check your connection and retry.'));
    };
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.google?.accounts.oauth2) resolve(window.google.accounts.oauth2);
      else fail();
    };
    document.head.append(script);
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export class GoogleAuth {
  private token: string | undefined;
  private expiresAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private cancelPending: (() => void) | undefined;

  private clientId: string;
  private onExpired: () => void;
  constructor(clientId: string, onExpired: () => void) {
    this.clientId = clientId;
    this.onExpired = onExpired;
  }

  // Called directly from a click after the SDK has loaded: preserve popup user activation.
  authorize(oauth: OAuth): Promise<void> {
    this.clear();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => fail('Authorisation timed out. Please retry.'), 120000);
      const finish = () => {
        done = true;
        clearTimeout(timeout);
        this.cancelPending = undefined;
      };
      const fail = (message: string) => {
        if (done) return;
        finish();
        reject(new Error(message));
      };
      this.cancelPending = () => fail('Authorisation cancelled.');
      try {
        const client = oauth.initTokenClient({
          client_id: this.clientId, scope: SCOPES.join(' '), include_granted_scopes: false,
          callback: response => {
            if (done || generation !== this.generation) return;
            if (response.error || !response.access_token) return fail('Google authorisation was denied or failed. Please retry.');
            if (!oauth.hasGrantedAllScopes(response, ...SCOPES)) return fail('Both read-only Calendar permissions are required. Please retry and allow both.');
            const seconds = Number(response.expires_in);
            if (!Number.isFinite(seconds) || seconds <= 0) return fail('Google returned an invalid token lifetime. Please retry.');
            this.token = response.access_token;
            this.expiresAt = Date.now() + seconds * 1000;
            this.timer = setTimeout(() => { this.clear(); this.onExpired(); }, seconds * 1000);
            finish();
            resolve();
          },
          error_callback: error => fail(error.type === 'popup_closed'
            ? 'Google sign-in was closed. Please retry.' : 'Google sign-in could not open. Allow popups and retry.'),
        });
        // Let Google reuse saved consent, including after a reload; missing consent
        // is still requested by GIS. Keep this call driven by the sign-in click.
        client.requestAccessToken({ prompt: '' });
      } catch { fail('Google sign-in could not start. Please retry.'); }
    });
  }

  getToken(): string {
    if (!this.token || Date.now() >= this.expiresAt) {
      this.clear();
      this.onExpired();
      throw new Error('Your session expired. Sign in again.');
    }
    return this.token;
  }

  clear(): void {
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.token = undefined;
    this.expiresAt = 0;
  }
}
