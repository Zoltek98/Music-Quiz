import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import type { Category, Player, RoomState, Song } from './types.js';

const app = express();
app.use(cors({ origin: (process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1host:5173').split(',') }));
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: (process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173').split(',') } });
const prisma = new PrismaClient();

// Live state is cached for fast Socket.IO updates and written through to MySQL after every action.
const rooms = new Map<string, { state: RoomState; adminTokenHash: string }>();
const ROOM_IDLE_MS = 60 * 60 * 1000;
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(5), b => codeAlphabet[b % codeAlphabet.length]).join('');
const starterCategories = ['Pop Hits', 'Rock Anthems', '90s', '2000s', 'Italian Classics', 'Movie Soundtracks', 'One Hit Wonders', 'Dancefloor', 'Love Songs', 'TV Themes'];
const emptySongs = (): Song[] => Array.from({ length: 4 }, (_, i) => ({ slot: i + 1, title: '', artist: '', clipStartMs: 0, clipLength: 6 }));
let catalog: Category[] = starterCategories.map((name, i) => ({ id: i + 1, name, songs: emptySongs() }));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safe = (state: RoomState) => ({ ...state, categories: state.categories.map(c => ({ ...c, songs: c.songs.map(s => {
  const outcome = state.trackOutcomes[`${c.id}-${s.slot}`];
  const visible = Boolean(outcome) || (state.revealed && c.id === state.activeCategoryId && s.slot === state.activeTrackSlot);
  return { ...s, title: visible ? s.title : '', artist: visible ? s.artist : '', album: visible ? s.album : undefined, coverArtUrl: visible ? s.coverArtUrl : undefined };
}) })) });
const emitState = (code: string) => { const r = rooms.get(code); if (r) io.to(code).emit('room:state', safe(r.state)); };
const fail = (message: string) => ({ error: message });

async function persist(room: RoomState) {
  await prisma.room.update({ where: { code: room.code }, data: {
    status: room.status, activeCategory: room.activeCategoryId, activeTrack: room.activeTrackSlot,
    currentPlayerId: room.currentPlayerId, buzzLocked: room.buzzLocked, isPlaying: room.isPlaying,
    revealed: room.revealed, lastResult: room.lastResult, trackOutcomes: room.trackOutcomes, lastActivityAt: new Date(),
    players: { updateMany: room.players.map(p => ({ where: { id: p.id }, data: { score: p.score } })) }
  } });
}
async function initialize() {
  await prisma.$connect();
  for (const name of starterCategories) await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  await prisma.room.deleteMany({ where: { lastActivityAt: { lt: new Date(Date.now() - ROOM_IDLE_MS) } } });
  const rows = await prisma.category.findMany({ include: { tracks: true }, orderBy: { id: 'asc' } });
  catalog = rows.map(c => ({ id: c.id, name: c.name, songs: Array.from({ length: 4 }, (_, i) => {
    const song = c.tracks.find(t => t.slot === i + 1);
    return song ? { slot: song.slot, title: song.title, artist: song.artist, album: song.album ?? undefined, spotifyUri: song.spotifyUri ?? undefined, coverArtUrl: song.coverArtUrl ?? undefined, previewUrl: song.previewUrl ?? undefined, clipStartMs: song.clipStartMs, clipLength: song.clipLength } : emptySongs()[i]!;
  }) }));
  const savedRooms = await prisma.room.findMany({ include: { players: true } });
  for (const r of savedRooms) {
    const state: RoomState = { code: r.code, status: r.status as RoomState['status'], categories: catalog.map(c => ({ ...c, songs: c.songs.map(s => ({ ...s })) })), players: r.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: false })), activeCategoryId: r.activeCategory, activeTrackSlot: r.activeTrack, currentPlayerId: r.currentPlayerId, buzzLocked: r.buzzLocked, isPlaying: false, revealed: r.revealed, lastResult: r.lastResult as RoomState['lastResult'], trackOutcomes: (r.trackOutcomes as RoomState['trackOutcomes'] | null) ?? {} };
    rooms.set(r.code, { state, adminTokenHash: r.adminTokenHash });
  }
}

async function expireIdleRooms() {
  const cutoff = new Date(Date.now() - ROOM_IDLE_MS);
  const candidates = await prisma.room.findMany({ where: { lastActivityAt: { lt: cutoff } }, select: { code: true } });
  for (const candidate of candidates) {
    const deleted = await prisma.room.deleteMany({ where: { code: candidate.code, lastActivityAt: { lt: cutoff } } });
    if (!deleted.count) continue;
    io.to(candidate.code).emit('room:closed', { code: candidate.code, reason: 'idle' });
    io.in(candidate.code).disconnectSockets(true);
    rooms.delete(candidate.code);
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/categories', (_req, res) => res.json(catalog.map(({ id, name }) => ({ id, name, songCount: 4 }))));
app.post('/api/rooms', async (_req, res) => {
  let code = newCode(); while (rooms.has(code)) code = newCode();
  const adminToken = randomBytes(24).toString('hex');
  const state: RoomState = { code, status: 'lobby', categories: catalog.map(c => ({ ...c, songs: c.songs.map(s => ({ ...s })) })), players: [], activeCategoryId: null, activeTrackSlot: null, currentPlayerId: null, buzzLocked: false, isPlaying: false, revealed: false, lastResult: null, trackOutcomes: {} };
  const adminTokenHash = hash(adminToken);
  await prisma.room.create({ data: { code, adminTokenHash } });
  rooms.set(code, { state, adminTokenHash });
  res.status(201).json({ code, adminToken, state: safe(state) });
});
app.post('/api/rooms/:code/join', async (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase()); if (!room) return res.status(404).json(fail('Room not found'));
  const name = String(req.body?.name ?? '').trim().slice(0, 32); if (!name) return res.status(400).json(fail('Name is required'));
  const id = randomUUID();
  await prisma.player.create({ data: { id, roomId: (await prisma.room.findUniqueOrThrow({ where: { code: room.state.code } })).id, name } });
  await prisma.room.update({ where: { code: room.state.code }, data: { lastActivityAt: new Date() } });
  const player = { id, name, score: 0, connected: true };
  room.state.players.push(player); emitState(room.state.code);
  return res.status(201).json({ playerId: player.id, state: safe(room.state) });
});

type ClientData = { code?: string; adminToken?: string; playerId?: string };
io.on('connection', socket => {
  const data = socket.handshake.auth as ClientData;
  const code = String(data.code ?? '').toUpperCase(); const room = rooms.get(code);
  if (!room) { socket.emit('room:error', { message: 'Room not found' }); socket.disconnect(); return; }
  const isAdmin = typeof data.adminToken === 'string' && hash(data.adminToken) === room.adminTokenHash;
  const player = room.state.players.find(p => p.id === data.playerId);
  if (!isAdmin && !player && data.playerId) { socket.emit('room:error', { message: 'Player not found' }); socket.disconnect(); return; }
  if (player) player.connected = true;
  socket.join(code); emitState(code); socket.emit('room:state', isAdmin ? room.state : safe(room.state));
  const adminOnly = (fn: () => void) => { if (!isAdmin) return socket.emit('room:error', { message: 'Admin only action' }); fn(); void persist(room.state).then(() => { emitState(code); socket.emit('room:state', room.state); }).catch(error => socket.emit('room:error', { message: 'Could not save game state' })); };
  socket.on('admin:close-room', async () => {
    if (!isAdmin) return socket.emit('room:error', { message: 'Admin only action' });
    try {
      const deleted = await prisma.room.deleteMany({ where: { code } });
      if (!deleted.count) return socket.emit('room:error', { message: 'La stanza è già stata chiusa.' });
      io.to(code).emit('room:closed', { code, reason: 'admin' });
      io.in(code).disconnectSockets(true);
      rooms.delete(code);
    } catch (error) {
      console.error('Could not close room', error);
      socket.emit('room:error', { message: 'Impossibile chiudere la stanza.' });
    }
  });
  socket.on('admin:save-tracks', async (payload: { categoryId?: number; tracks?: Array<{ title?: string; artist?: string; album?: string; spotifyUri?: string; coverArtUrl?: string; clipStartMs?: number; clipLength?: number }> }) => {
    if (!isAdmin) return socket.emit('room:error', { message: 'Admin only action' });
    const categoryId = Number(payload?.categoryId);
    const category = catalog.find(item => item.id === categoryId);
    const tracks = payload?.tracks;
    if (!category || !Array.isArray(tracks) || tracks.length !== 4 || tracks.some(track =>
      !track.title?.trim() || !track.artist?.trim() || !/^spotify:track:[A-Za-z0-9]+$/.test(track.spotifyUri ?? '') ||
      !Number.isSafeInteger(track.clipStartMs) || Number(track.clipStartMs) < 0 || !Number.isInteger(track.clipLength) || Number(track.clipLength) < 1 || Number(track.clipLength) > 30 ||
      Boolean(track.coverArtUrl && !track.coverArtUrl.startsWith('https://i.scdn.co/'))
    )) return socket.emit('room:error', { message: 'Scegli esattamente quattro brani Spotify e controlla durata e timing.' });
    try {
      await prisma.$transaction(tracks.map((track, index) => prisma.track.upsert({
        where: { categoryId_slot: { categoryId, slot: index + 1 } },
        create: { categoryId, slot: index + 1, title: track.title!.trim().slice(0, 160), artist: track.artist!.trim().slice(0, 160), album: track.album?.slice(0, 160), spotifyUri: track.spotifyUri, coverArtUrl: track.coverArtUrl, clipStartMs: Number(track.clipStartMs), clipLength: Number(track.clipLength) },
        update: { title: track.title!.trim().slice(0, 160), artist: track.artist!.trim().slice(0, 160), album: track.album?.slice(0, 160), spotifyUri: track.spotifyUri, coverArtUrl: track.coverArtUrl, previewUrl: null, clipStartMs: Number(track.clipStartMs), clipLength: Number(track.clipLength) },
      })));
      await prisma.room.update({ where: { code }, data: { lastActivityAt: new Date() } });
      category.songs = tracks.map((track, index) => ({ slot: index + 1, title: track.title!.trim().slice(0, 160), artist: track.artist!.trim().slice(0, 160), album: track.album?.slice(0, 160), spotifyUri: track.spotifyUri, coverArtUrl: track.coverArtUrl, clipStartMs: Number(track.clipStartMs), clipLength: Number(track.clipLength) }));
      for (const roomEntry of rooms.values()) {
        const roomCategory = roomEntry.state.categories.find(item => item.id === categoryId);
        if (roomCategory) roomCategory.songs = category.songs.map(song => ({ ...song }));
        emitState(roomEntry.state.code);
      }
      socket.emit('room:state', room.state);
      socket.emit('catalog:saved', { categoryId });
    } catch (error) {
      console.error('Could not save category tracks', error);
      socket.emit('room:error', { message: 'Impossibile salvare i quattro brani nel database.' });
    }
  });
  socket.on('admin:category', (categoryId: number) => adminOnly(() => {
    if (!room.state.categories.some(c => c.id === Number(categoryId))) return;
    room.state.activeCategoryId = Number(categoryId); room.state.activeTrackSlot = null; room.state.currentPlayerId = null;
    room.state.buzzLocked = false; room.state.isPlaying = false; room.state.revealed = false; room.state.lastResult = null; room.state.status = 'playing';
  }));
  socket.on('admin:track', (slot: number) => adminOnly(() => {
    if (!room.state.activeCategoryId || ![1, 2, 3, 4].includes(Number(slot))) return;
    room.state.activeTrackSlot = Number(slot); room.state.currentPlayerId = null; room.state.buzzLocked = false;
    room.state.revealed = false; room.state.lastResult = null; room.state.isPlaying = true;
  }));
  socket.on('admin:playback', (playing: boolean) => adminOnly(() => { room.state.isPlaying = Boolean(playing) && !room.state.buzzLocked; }));
  socket.on('player:buzz', async () => {
    const p = room.state.players.find(x => x.id === player?.id); if (!p || room.state.activeTrackSlot === null || room.state.buzzLocked) return;
    room.state.buzzLocked = true; room.state.currentPlayerId = p.id; room.state.isPlaying = false;
    try { await persist(room.state); emitState(code); } catch { socket.emit('room:error', { message: 'Could not save buzz' }); }
  });
  socket.on('admin:resolve', (result: 'correct' | 'incorrect') => adminOnly(() => {
    if (!room.state.buzzLocked || !room.state.currentPlayerId || !['correct', 'incorrect'].includes(result)) return;
    room.state.lastResult = result; room.state.revealed = true;
    room.state.trackOutcomes[`${room.state.activeCategoryId}-${room.state.activeTrackSlot}`] = result;
    if (result === 'correct') { const p = room.state.players.find(x => x.id === room.state.currentPlayerId); if (p) p.score += 1; }
  }));
  socket.on('admin:reveal', () => adminOnly(() => { room.state.revealed = true; if (room.state.activeCategoryId && room.state.activeTrackSlot) room.state.trackOutcomes[`${room.state.activeCategoryId}-${room.state.activeTrackSlot}`] = 'revealed'; }));
  socket.on('admin:next', () => adminOnly(() => { room.state.activeTrackSlot = null; room.state.currentPlayerId = null; room.state.buzzLocked = false; room.state.isPlaying = false; room.state.revealed = false; room.state.lastResult = null; }));
  socket.on('admin:reset', () => adminOnly(() => { for (const p of room.state.players) p.score = 0; room.state.activeCategoryId = null; room.state.activeTrackSlot = null; room.state.currentPlayerId = null; room.state.buzzLocked = false; room.state.isPlaying = false; room.state.revealed = false; room.state.lastResult = null; room.state.trackOutcomes = {}; room.state.status = 'lobby'; }));
  socket.on('disconnect', () => { if (player) { player.connected = false; emitState(code); } });
});

const port = Number(process.env.PORT ?? 4000);
initialize().then(() => httpServer.listen(port, () => console.log(`Music Quiz API listening on :${port}`))).catch(error => {
  console.error('Database initialization failed. Check DATABASE_URL and run the Prisma migration.', error);
  process.exit(1);
});
setInterval(() => { void expireIdleRooms().catch(error => console.error('Idle room cleanup failed', error)); }, 60_000).unref();
