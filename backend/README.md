# Music Quiz backend

Node.js, TypeScript, Express, Socket.IO and Prisma service backed by MySQL. Room/player/score/game state and the category/track catalog are stored in MySQL; live socket connections are tracked in memory. On restart, saved rooms and scores are restored, while playback resumes paused. The ten starter categories are inserted automatically; the four track slots are placeholders pending track selection and an approved playback source.

## Local setup

1. Install Docker Desktop and make sure it is running.
2. From this `backend` folder, start MySQL with `docker compose up -d mysql`. It creates `music_quiz` and `music_quiz_shadow` automatically and publishes MySQL on port `3307` (to avoid colliding with a local MySQL server on `3306`).
   If MySQL was already initialized before the shadow database was added, run this once to grant access to the existing container:
   `docker compose exec -T mysql mysql -uroot -proot_local_only -e "CREATE DATABASE IF NOT EXISTS music_quiz_shadow; GRANT ALL PRIVILEGES ON music_quiz_shadow.* TO 'music_quiz'@'%';"`
3. `.env` is preconfigured for this container; adjust `CLIENT_ORIGIN` if needed. `.env.example` is the template for other machines.
4. Run `npm install`, `npm run db:generate`, and `npm run db:migrate`. Prisma uses the separate shadow database for migration development, so the app user does not need permission to create databases.
5. Run `npm run dev` to start the API on port 4000 and seed the starter categories.

After pulling updates that add database migrations, start MySQL and run `npm run db:migrate` again before starting the API. Current migrations add the room activity timestamp and selected-track cover art.

To stop MySQL without deleting the saved data, run `docker compose down`. The database lives in a named Docker volume and survives restarts. `docker compose down -v` also deletes that database volume and all its data.

## HTTP

- `GET /api/health` — health check.
- `GET /api/categories` — ten starter categories, four song slots each.
- `POST /api/rooms` — creates a room; returns `{ code, adminToken, state }`. Keep the token private on the admin device.
- `POST /api/rooms/:code/join` with `{ "name": "..." }` — returns `{ playerId, state }`.

Example create response: `{ "code": "A7KQ2", "adminToken": "<secret>", "state": { "code": "A7KQ2", "status": "lobby", "categories": [], "players": [], "activeCategoryId": null, "activeTrackSlot": null, "currentPlayerId": null, "buzzLocked": false, "isPlaying": false, "revealed": false, "lastResult": null } }`.

## Socket.IO contract

Connect with `auth: { code, adminToken }` for admin or `auth: { code, playerId }` for a player. The read-only room display can connect with `{ code }`.

Server emits `room:state` with `RoomState` and `room:error` with `{ message }`. Unresolved track titles/artists are masked; an answer becomes visible after the host reveals or judges it. `trackOutcomes` preserves each slot's reveal/correct/incorrect state across rounds and restarts. Client should use `activeCategoryId`, `activeTrackSlot`, `isPlaying`, `buzzLocked`, `currentPlayerId`, `lastResult`, `trackOutcomes`, and `players[].score` to render the room and controls.

Admin events: `admin:category(categoryId)`, `admin:track(slot)` (starts playback), `admin:playback(boolean)`, `admin:resolve('correct' | 'incorrect')`, `admin:reveal()`, `admin:next()`, `admin:reset()`.

Player event: `player:buzz()`. The first buzz wins; server locks further buzzes and sets `isPlaying=false` atomically. A correct resolution awards one point to the player who buzzed. Clients should treat server state as authoritative.

Concrete client examples:

```ts
const socket = io(API_URL, { auth: { code: 'A7KQ2', adminToken } });
socket.emit('admin:category', 3);
socket.emit('admin:track', 1);
socket.emit('admin:resolve', 'correct');
socket.on('room:state', state => render(state));

const playerSocket = io(API_URL, { auth: { code: 'A7KQ2', playerId } });
playerSocket.emit('player:buzz');
```

## Track catalog

Each category contains exactly four selected slots. The admin searches Spotify for ten alternatives, chooses four, and saves a Spotify URI, album cover URL, `clipStartMs`, and `clipLength` for each slot. The admin-only `admin:save-tracks` socket event validates and persists all four tracks, and updates connected room displays. The room display starts the selected URI at its millisecond offset and stops it after the clip duration. Album cover and answer metadata remain hidden until reveal.

Rooms can be closed with the admin-only `admin:close-room` event; their player rows are deleted by the Room→Player cascade. The server also expires rooms after one hour without a successful join or game/catalog action. It sweeps once per minute and purges stale rooms at startup. Merely leaving the shared room screen connected does not keep a room alive.
