# Music Quiz

Room-based music quiz with a React/TypeScript client, a Node/TypeScript realtime server, and MySQL persistence.

## Shape of the application

- `/admin`: host controls, room setup, category selection, playback, answer reveal, and scoring.
- `/join`: player join flow and mobile-first full-screen buzz control.
- `/?screen=room&code=ROOMCODE`: shared display for a TV or projector, showing the active category, four tracks, buzz status, answer reveal, and scores.
- Socket.IO carries live room updates. The server is authoritative for buzz locking and score changes.
- MySQL stores rooms, players, scores, category/track catalog, and per-track outcomes. Socket.IO keeps live state in sync between devices.

## Music source decision

Playback is intentionally behind a provider boundary until the source is confirmed. Spotify's [Developer Policy](https://developer.spotify.com/policy) excludes games and trivia using Spotify content, and its [compliance guidance](https://developer.spotify.com/compliance-tips) specifically addresses “name that tune” formats. Premium does not grant an exception. Do not expose credentials or scrape audio. The content model supports a track reference plus a chosen excerpt start time, so a permitted source can be added without changing quiz logic.

## Local setup

See `frontend/README.md` and `backend/README.md` for app-specific setup, configuration, and the realtime contract. MySQL credentials, Spotify credentials, and other secrets belong in environment variables and must not be committed.

## Initial scope

This first implementation includes the room flow and MySQL persistence, but not an in-app track editor or licensed audio playback. The host can run room controls against ten seeded categories with four blank slots each. Add track curation and a playback provider only after confirming the provider's technical access and permitted use.
