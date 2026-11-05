# Side A — frontend

Frontend responsive React + TypeScript for the music quiz. It includes the welcome page, `/join`, the host console, the player's phone view and the shared room screen (`?screen=room`). The player roster and scores come only from the backend; if the server is unavailable, the app reports the error instead of showing a simulated game. The music control remains a playback placeholder until an authorized source is configured; there is no Spotify streaming implementation.

## Run locally

```sh
npm install
npm run dev
```

For local development the app connects to `http://localhost:4000` by default. Set `VITE_API_URL` to a different backend origin when needed; see `.env.example`.

## Spotify Web Playback SDK

The admin catalog uses Spotify Search to show ten alternatives for the selected category, then saves the four chosen tracks and their clip start/duration. Connect Spotify in the admin browser to search. Search uses Spotify's catalog search endpoint with a category query (such as `genre:rock` or `year:1990-1999`), not the recommendations endpoint.

The shared room screen is the Spotify Connect playback device. Create a Spotify developer app, add the exact redirect URI `http://localhost:5173/spotify-callback` (and the deployed equivalent) to its allowlist, then copy `.env.example` to `.env.local` and set `VITE_SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_REDIRECT_URI`. The Client ID is public; never put a Spotify client secret in the frontend. Restart Vite after changing environment variables. Connect Spotify separately in the room screen browser/device that is wired to the speakers.

Open the shared room screen on the device connected to the speakers, connect the Spotify account there, and press **Attiva audio** once to satisfy browser audio activation. The admin's play/pause controls are sent through the room socket. Each catalog track stores a Spotify URI (`spotify:track:…`), `clipStartMs`, and `clipLength` in seconds. The room screen starts at that millisecond offset and pauses after the clip duration. Spotify Premium is required. Each browser/device that searches or plays audio must connect its own Spotify session.

## Backend integration

The frontend follows `../backend/README.md`:

- `POST /api/rooms` creates a room; the admin socket authenticates with `{ code, adminToken }`.
- `POST /api/rooms/:code/join` accepts `{ name }`; player socket authenticates with `{ code, playerId }`.
- `GET /api/categories` is available for category discovery.
- Socket server `room:state` is authoritative; `room:error` displays server errors.
- Admin emits `admin:category(categoryId)`, `admin:track(slot)`, `admin:playback(boolean)`, `admin:resolve('correct' | 'incorrect')`, `admin:reveal()`, `admin:next()`, `admin:reset()`.
- Player emits `player:buzz()`; server atomically accepts the first buzz and stops playback.
- Room codes are five characters. The join screen accepts `/join?code=ABCDE`, and the host's invite button copies a link with the code filled in.

The admin token stays in the admin browser session and is only sent as Socket.IO auth. Track data returned by the backend is masked until reveal. The host view asks the server to start/stop clips; clip source and start position still need to be configured in the backend catalog.
