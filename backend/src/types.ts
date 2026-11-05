export type Song = { slot: number; title: string; artist: string; album?: string; spotifyUri?: string; coverArtUrl?: string; previewUrl?: string; clipStartMs: number; clipLength: number };
export type Category = { id: number; name: string; songs: Song[] };
export type Player = { id: string; name: string; score: number; connected: boolean };
export type RoomState = {
  code: string; status: 'lobby' | 'playing' | 'finished'; categories: Category[]; players: Player[];
  activeCategoryId: number | null; activeTrackSlot: number | null; currentPlayerId: string | null;
  buzzLocked: boolean; isPlaying: boolean; revealed: boolean; lastResult: 'correct' | 'incorrect' | null;
  trackOutcomes: Record<string, 'correct' | 'incorrect' | 'revealed'>;
};
