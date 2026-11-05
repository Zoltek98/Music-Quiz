const TOKEN_KEY = 'side-a-spotify-token';
const VERIFIER_KEY = 'side-a-spotify-verifier';
const STATE_KEY = 'side-a-spotify-state';
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? `${window.location.origin}/spotify-callback`;

export interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, callback: (payload: any) => void): boolean;
  activateElement(): Promise<void>;
  pause(): Promise<void>;
}

declare global {
  interface Window {
    Spotify?: { Player: new (options: { name: string; volume?: number; getOAuthToken: (callback: (token: string) => void) => void }) => SpotifyPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type TokenRecord = { accessToken: string; refreshToken?: string; expiresAt: number };
export type SpotifySearchTrack = { id: string; name: string; uri: string; is_playable?: boolean; artists: Array<{ name: string }>; album: { name: string; release_date?: string; images?: Array<{ url: string }> }; external_urls: { spotify: string } };
export type SpotifySearchPage = { items: SpotifySearchTrack[]; total: number; offset: number; limit: number };

function readToken(): TokenRecord | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as TokenRecord | null; } catch { return null; }
}
function saveToken(token: TokenRecord) { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); }
function randomString(length: number) {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, value => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[value % 62]).join('');
}
function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function sha256(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

export async function beginSpotifyLogin(roomCode: string, destination: 'room' | 'admin' = 'room') {
  if (!CLIENT_ID) throw new Error('Manca VITE_SPOTIFY_CLIENT_ID nella configurazione frontend.');
  const verifier = randomString(64);
  const state = randomString(32);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem('side-a-spotify-room', roomCode);
  sessionStorage.setItem('side-a-spotify-destination', destination);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state',
    state,
    code_challenge_method: 'S256',
    code_challenge: base64Url(await sha256(verifier)),
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${query}`);
}

export async function finishSpotifyLogin() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) throw new Error(`Spotify ha rifiutato l'accesso: ${params.get('error')}`);
  const code = params.get('code');
  if (!code) return;
  const state = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!state || state !== expectedState || !verifier) throw new Error('Verifica OAuth Spotify non riuscita. Riprova il collegamento.');
  const body = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description ?? 'Scambio del token Spotify non riuscito.');
  saveToken({ accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + payload.expires_in * 1000 });
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

export async function getSpotifyToken(): Promise<string | null> {
  const current = readToken();
  if (!current) return null;
  if (current.expiresAt > Date.now() + 60_000) return current.accessToken;
  if (!current.refreshToken) { localStorage.removeItem(TOKEN_KEY); return null; }
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: current.refreshToken }),
  });
  const payload = await response.json();
  if (!response.ok) { localStorage.removeItem(TOKEN_KEY); return null; }
  const refreshed = { accessToken: payload.access_token as string, refreshToken: (payload.refresh_token as string | undefined) ?? current.refreshToken, expiresAt: Date.now() + Number(payload.expires_in) * 1000 };
  saveToken(refreshed);
  return refreshed.accessToken;
}

let sdkPromise: Promise<void> | null = null;
export function loadSpotifySdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Spotify Web Playback SDK non disponibile.')), 15_000);
    window.onSpotifyWebPlaybackSDKReady = () => { window.clearTimeout(timeout); resolve(); };
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => { window.clearTimeout(timeout); reject(new Error('Impossibile caricare Spotify Web Playback SDK.')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export async function playSpotifyClip(deviceId: string, uri: string, startSecond: number) {
  const token = await getSpotifyToken();
  if (!token) throw new Error('Sessione Spotify scaduta: ricollega l’account dalla schermata stanza.');
  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.round(startSecond * 1000)) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Spotify non ha avviato il brano (${response.status}).`);
  }
}

export function disconnectSpotify() { localStorage.removeItem(TOKEN_KEY); }
export function hasSpotifyClientId() { return Boolean(CLIENT_ID); }

const searchCache = new Map<string, SpotifySearchPage>();
export async function searchSpotifyTracks(query: string, offset = 0, limit = 10): Promise<SpotifySearchPage> {
  const cacheKey = `${query.trim().toLowerCase()}|${offset}|${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const token = await getSpotifyToken();
  if (!token) throw new Error('Collega Spotify da questa schermata per cercare i brani.');
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit), offset: String(offset), market: 'IT' });
  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `Ricerca Spotify non riuscita (${response.status}).`);
  const page = { items: (payload.tracks?.items ?? []) as SpotifySearchTrack[], total: Number(payload.tracks?.total ?? 0), offset, limit };
  searchCache.set(cacheKey, page);
  return page;
}
