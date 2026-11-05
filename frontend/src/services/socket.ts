import { io, type Socket } from 'socket.io-client';
export type SongStatus = 'hidden' | 'revealed' | 'correct' | 'missed';
export interface QuizSong { id: string; title: string; artist: string; status: SongStatus; slot?: number; spotifyUri?: string; previewUrl?: string; coverArtUrl?: string; clipStartMs?: number; clipLength?: number; }
export interface QuizCategory { id: string; name: string; color: string; songs: QuizSong[]; }
export interface QuizPlayer { id: string; name: string; score: number; connected?: boolean; }
export interface ServerSong { slot: number; title: string; artist: string; album?: string; coverArtUrl?: string; spotifyUri?: string; previewUrl?: string; clipStartMs: number; clipLength: number; }
export interface CatalogTrack { title: string; artist: string; album?: string; coverArtUrl?: string; spotifyUri: string; clipStartMs: number; clipLength: number; }
export interface ServerCategory { id: number; name: string; songs: ServerSong[]; }
export interface RoomState { code: string; status: 'lobby'|'playing'|'finished'; categories: ServerCategory[]; players: QuizPlayer[]; activeCategoryId: number|null; activeTrackSlot: number|null; currentPlayerId: string|null; buzzLocked: boolean; isPlaying: boolean; revealed: boolean; lastResult: 'correct'|'incorrect'|null; trackOutcomes: Record<string,'correct'|'incorrect'|'revealed'>; }
export interface ClientToServerEvents {
 'admin:category': (categoryId:number)=>void; 'admin:track':(slot:number)=>void; 'admin:playback':(playing:boolean)=>void; 'admin:save-tracks':(payload:{categoryId:number;tracks:CatalogTrack[]})=>void;
 'admin:resolve':(result:'correct'|'incorrect')=>void; 'admin:reveal':()=>void; 'admin:next':()=>void; 'admin:reset':()=>void; 'admin:close-room':()=>void; 'player:buzz':()=>void;
}
export interface ServerToClientEvents { 'room:state':(state:RoomState)=>void; 'room:error':(payload:{message:string})=>void; 'catalog:saved':(payload:{categoryId:number})=>void; 'room:closed':(payload:{code:string;reason?:'admin'|'idle'})=>void; }
export type QuizSocket=Socket<ServerToClientEvents,ClientToServerEvents>;
export const apiBase=(import.meta.env.VITE_API_URL??(import.meta.env.DEV?'http://127.0.0.1:4000':window.location.origin)).replace(/\/$/,'');
export function connectQuiz(auth:{code:string;adminToken?:string;playerId?:string}):QuizSocket{return io(apiBase,{auth,transports:['websocket','polling'],autoConnect:true});}

