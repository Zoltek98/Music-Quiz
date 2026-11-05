import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleHelp, Clock3, ExternalLink, Home, Library, ListMusic, Music2, Pause, Play, Search, Share2, Users, X } from 'lucide-react';
import { apiBase, connectQuiz, type CatalogTrack, type QuizCategory, type QuizPlayer, type QuizSocket, type RoomState } from './services/socket';
import { beginSpotifyLogin, finishSpotifyLogin, getSpotifyToken, hasSpotifyClientId, loadSpotifySdk, playSpotifyClip, searchSpotifyTracks, type SpotifyPlayer, type SpotifySearchTrack } from './services/spotify';
import RoomNowPlaying from './components/RoomNowPlaying';

type View = 'home' | 'admin' | 'join' | 'player' | 'room' | 'spotify-callback';
const accents = ['#1ed760', '#7e7ee8', '#e8c56b', '#53bfa1', '#df82b6', '#e57b6a', '#70a7d9', '#d89765', '#54b9bc', '#b1a16e'];

function fromRoom(state: RoomState): QuizCategory[] {
  return state.categories.map((category, index) => ({
    id: String(category.id),
    name: category.name,
    color: accents[index % accents.length]!,
    songs: category.songs.map(song => {
      const outcome = state.trackOutcomes?.[`${category.id}-${song.slot}`];
      const status = outcome === 'correct' ? 'correct' : outcome === 'incorrect' ? 'missed' : outcome === 'revealed' ? 'revealed' : 'hidden';
      return { id: `${category.id}-${song.slot}`, slot: song.slot, title: song.title, artist: song.artist, spotifyUri: song.spotifyUri, previewUrl: song.previewUrl, coverArtUrl: song.coverArtUrl, clipStartMs: song.clipStartMs, clipLength: song.clipLength, status };
    }),
  }));
}

function initialView(): View {
  const params = new URLSearchParams(location.search);
  if (params.get('screen') === 'room') return 'room';
  if (location.pathname === '/spotify-callback') return 'spotify-callback';
  if (location.pathname === '/join') return 'join';
  if (params.get('player') === '1' && sessionStorage.getItem('quiz-player-id')) return 'player';
  if (sessionStorage.getItem('quiz-admin-token')) return 'admin';
  if (sessionStorage.getItem('quiz-player-id')) return 'player';
  return 'home';
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(location.search).get('code') ?? sessionStorage.getItem('quiz-room-code') ?? '');
  const [playerName, setPlayerName] = useState('');
  const [myName, setMyName] = useState(() => sessionStorage.getItem('quiz-player-name') ?? '');
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('quiz-admin-token') ?? '');
  const [playerId, setPlayerId] = useState(() => sessionStorage.getItem('quiz-player-id') ?? '');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<QuizSocket | null>(null);
  const [toast, setToast] = useState('');
  const [spotifyCallbackError, setSpotifyCallbackError] = useState('');

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);

  const categories = useMemo(() => roomState ? fromRoom(roomState) : [], [roomState]);
  const players = roomState?.players ?? [];
  const activeCategoryId = roomState?.activeCategoryId == null ? null : String(roomState.activeCategoryId);
  const activeCategory = categories.find(category => category.id === activeCategoryId) ?? null;
  const currentPlayer = players.find(player => player.id === roomState?.currentPlayerId) ?? null;
  const slot = roomState?.activeTrackSlot ?? selectedSlot;
  const activeTrack = activeCategory?.songs.find(song => song.slot === slot) ?? null;
  const roomDisplayTrack = activeTrack?.status === 'hidden' ? { ...activeTrack, coverArtUrl: undefined } : activeTrack;
  const activeResult = roomState?.lastResult ?? null;

  useEffect(() => {
    if (view !== 'spotify-callback') return;
    let cancelled = false;
    void finishSpotifyLogin().then(() => {
      const code = sessionStorage.getItem('side-a-spotify-room') ?? '';
      const destination = sessionStorage.getItem('side-a-spotify-destination') ?? 'room';
      history.replaceState(null, '', destination === 'room' ? `/?screen=room&code=${encodeURIComponent(code)}` : '/');
      if (!cancelled) { setRoomCode(code); setView(destination === 'admin' ? 'admin' : 'room'); }
    }).catch(error => {
      const code = sessionStorage.getItem('side-a-spotify-room') ?? '';
      const destination = sessionStorage.getItem('side-a-spotify-destination') ?? 'room';
      history.replaceState(null, '', destination === 'room' ? `/?screen=room&code=${encodeURIComponent(code)}` : '/');
      if (!cancelled) { setRoomCode(code); setSpotifyCallbackError(error instanceof Error ? error.message : 'Accesso Spotify non riuscito.'); setView(destination === 'admin' ? 'admin' : 'room'); }
    });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (socket || !roomCode) return;
    const code = new URLSearchParams(location.search).get('code') ?? roomCode;
    if (view === 'room') setSocket(connectQuiz({ code }));
    else if (view === 'admin' && adminToken) setSocket(connectQuiz({ code, adminToken }));
    else if (view === 'player' && playerId) setSocket(connectQuiz({ code, playerId }));
  }, [view, socket, roomCode, adminToken, playerId]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onState = (next: RoomState) => {
      setRoomCode(next.code);
      setRoomState(next);
      setSelectedSlot(current => next.activeTrackSlot ?? current);
    };
    const onError = (error: { message: string }) => notify(error.message);
    const onCatalogSaved = () => notify('I quattro brani sono stati salvati nella categoria.');
    const onRoomClosed = ({ reason }: { code: string; reason?: 'admin' | 'idle' }) => {
      sessionStorage.removeItem('quiz-room-code'); sessionStorage.removeItem('quiz-admin-token'); sessionStorage.removeItem('quiz-player-id'); sessionStorage.removeItem('quiz-player-name');
      setRoomCode(''); setRoomState(null); setAdminToken(''); setPlayerId(''); setMyName(''); setSelectedSlot(null); setSocket(null);
      history.replaceState(null, '', '/');
      setView('home');
      notify(reason === 'idle' ? 'Stanza chiusa dopo un’ora di inattività.' : 'Stanza chiusa.');
    };
    const onConnectError = () => {
      setConnected(false);
      notify('Connessione alla stanza non disponibile. Controlla il server.');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:state', onState);
    socket.on('room:error', onError);
    socket.on('catalog:saved', onCatalogSaved);
    socket.on('room:closed', onRoomClosed);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:state', onState);
      socket.off('room:error', onError);
      socket.off('catalog:saved', onCatalogSaved);
      socket.off('room:closed', onRoomClosed);
      socket.disconnect();
    };
  }, [socket, notify]);

  const createRoom = async () => {
    try {
      const response = await fetch(`${apiBase}/api/rooms`, { method: 'POST' });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? `Server non disponibile (${response.status})`);
      setRoomCode(result.code);
      setAdminToken(result.adminToken);
      setRoomState(result.state);
      setSelectedSlot(null);
      setSocket(connectQuiz({ code: result.code, adminToken: result.adminToken }));
      sessionStorage.setItem('quiz-room-code', result.code);
      sessionStorage.setItem('quiz-admin-token', result.adminToken);
      sessionStorage.removeItem('quiz-player-id');
      sessionStorage.removeItem('quiz-player-name');
      setView('admin');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Impossibile creare la stanza. Controlla che il backend sia avviato.');
    }
  };

  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim();
    if (!code || code.length !== 5) return notify('Inserisci il codice stanza di 5 caratteri.');
    if (!name) return notify('Inserisci il tuo nome.');
    try {
      const response = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? `Impossibile entrare nella stanza (${response.status})`);
      setRoomCode(code);
      setMyName(name);
      setPlayerId(result.playerId);
      setRoomState(result.state);
      setSocket(connectQuiz({ code, playerId: result.playerId }));
      sessionStorage.setItem('quiz-room-code', code);
      sessionStorage.setItem('quiz-player-id', result.playerId);
      sessionStorage.setItem('quiz-player-name', name);
      sessionStorage.removeItem('quiz-admin-token');
      history.replaceState(null, '', `/?player=1&code=${encodeURIComponent(code)}`);
      setView('player');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Stanza non raggiungibile. Controlla il codice e il server.');
    }
  };

  const chooseCategory = (categoryId: string) => {
    if (!socket || !connected) return notify('Connessione alla stanza in attesa.');
    setSelectedSlot(null);
    socket.emit('admin:category', Number(categoryId));
  };

  const startTrack = () => {
    if (!socket || !connected || !activeTrack) return;
    if (!activeTrack.spotifyUri) return notify('Aggiungi lo Spotify URI a questo brano nel catalogo.');
    socket.emit('admin:track', activeTrack.slot ?? 1);
  };

  const pauseTrack = () => socket?.emit('admin:playback', false);
  const nextTrack = () => {
    socket?.emit('admin:next');
    setSelectedSlot(null);
  };
  const judge = (result: 'correct' | 'incorrect') => {
    if (!socket || !connected || !currentPlayer) return;
    socket.emit('admin:resolve', result);
  };
  const reveal = () => socket?.emit('admin:reveal');
  const saveCategoryTracks = (categoryId: string, tracks: CatalogTrack[]) => {
    if (!socket || !connected) return notify('Connessione alla stanza in attesa.');
    socket.emit('admin:save-tracks', { categoryId: Number(categoryId), tracks });
  };
  const closeRoom = () => {
    if (!socket || !connected) return notify('Connessione alla stanza in attesa.');
    if (window.confirm('Chiudere questa stanza ed eliminare i giocatori e i punteggi salvati?')) socket.emit('admin:close-room');
  };
  const buzz = () => {
    if (!connected || !socket || roomState?.buzzLocked || roomState?.activeTrackSlot == null) return;
    socket.emit('player:buzz');
  };
  const copyInvite = async () => {
    const invite = new URL('/join', window.location.origin);
    invite.searchParams.set('code', roomCode);
    try {
      await navigator.clipboard.writeText(invite.toString());
      notify('Link di invito copiato.');
    } catch {
      notify(`Codice stanza: ${roomCode}`);
    }
  };
  const openRoomScreen = () => window.open(`/?screen=room&code=${encodeURIComponent(roomCode)}`, '_blank', 'noopener');

  if (view === 'spotify-callback') return <main className="display-page"><p className="spotify-status">Collegamento a Spotify…</p></main>;
  if (view === 'join') return <JoinPage roomCode={roomCode} setRoomCode={setRoomCode} playerName={playerName} setPlayerName={setPlayerName} onJoin={joinRoom} onBack={() => setView('home')} toast={toast} />;
  if (view === 'player') return <PlayerPage name={myName} roomCode={roomCode} players={players} playerId={playerId} buzzed={Boolean(roomState?.buzzLocked)} connected={connected} onBuzz={buzz} toast={toast} />;
  if (view === 'room') return <RoomPage roomCode={roomCode} categories={categories} activeCategory={activeCategory} activeTrack={roomDisplayTrack} players={players} currentPlayer={currentPlayer} lastResult={activeResult} playing={Boolean(roomState?.isPlaying)} spotifyError={spotifyCallbackError} toast={toast} />;
  if (view === 'admin') return <AdminPage roomCode={roomCode} categories={categories} activeCategory={activeCategory} activeTrack={activeTrack} selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot} players={players} currentPlayer={currentPlayer} lastResult={activeResult} connected={connected} playing={Boolean(roomState?.isPlaying)} spotifyError={spotifyCallbackError} onCategory={chooseCategory} onPlay={startTrack} onPause={pauseTrack} onNext={nextTrack} onJudge={judge} onReveal={reveal} onSaveCategoryTracks={saveCategoryTracks} onCloseRoom={closeRoom} onCopyInvite={copyInvite} onOpenRoom={openRoomScreen} onHome={() => setView('home')} toast={toast} />;
  return <HomePage onCreate={createRoom} onJoin={() => setView('join')} toast={toast} />;
}

function Brand() {
  return <div className="brand"><span className="brand-icon"><Music2 size={18} fill="currentColor"/></span><span>Side A</span></div>;
}

function Header({ roomCode, connected, onInvite, onScreen, onClose }: { roomCode: string; connected: boolean; onInvite: () => void; onScreen: () => void; onClose: () => void }) {
  return <header className="app-header">
    <Brand />
    <div className="header-room"><Home size={17}/><span>Stanza</span><span className="header-code">{roomCode}</span></div>
    <div className="header-actions"><span className={`connection ${connected ? 'online' : ''}`}><i/>{connected ? 'Connesso' : 'In attesa'}</span><button className="header-button" onClick={onScreen}>Schermo stanza</button><button className="header-button green" onClick={onInvite}><Share2 size={15}/> Invita</button><button className="header-button danger" onClick={onClose} aria-label="Chiudi stanza"><X size={15}/><span>Chiudi</span></button></div>
  </header>;
}

function HomePage({ onCreate, onJoin, toast }: { onCreate: () => void; onJoin: () => void; toast: string }) {
  return <main className="home-page">
    <header className="simple-header"><Brand/><span>Music quiz</span></header>
    <section className="home-actions">
      <h1>Una stanza.<br/>Le tue regole.</h1>
      <p>Crea una partita oppure inserisci il codice ricevuto.</p>
      <button className="spotify-button" onClick={onCreate}>Crea una stanza</button>
      <button className="secondary-button" onClick={onJoin}>Ho un codice</button>
    </section>
    <Toast message={toast}/>
  </main>;
}

function JoinPage({ roomCode, setRoomCode, playerName, setPlayerName, onJoin, onBack, toast }: { roomCode: string; setRoomCode: (value: string) => void; playerName: string; setPlayerName: (value: string) => void; onJoin: () => void; onBack: () => void; toast: string }) {
  return <main className="join-page">
    <header className="simple-header"><button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Indietro</button><Brand/><span>Unisciti a una partita</span></header>
    <form className="join-form" onSubmit={event => { event.preventDefault(); onJoin(); }}>
      <h1>Entra nella stanza</h1>
      <label>Codice stanza<input autoComplete="off" autoCapitalize="characters" maxLength={5} value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase())} placeholder="5 caratteri" /></label>
      <label>Nome giocatore<input autoComplete="nickname" maxLength={24} value={playerName} onChange={event => setPlayerName(event.target.value)} placeholder="Il tuo nome" /></label>
      <button className="spotify-button" type="submit">Entra</button>
    </form>
    <Toast message={toast}/>
  </main>;
}

function AdminPage(props: {
  roomCode: string; categories: QuizCategory[]; activeCategory: QuizCategory | null; activeTrack: QuizCategory['songs'][number] | null; selectedSlot: number | null; setSelectedSlot: (slot: number) => void; players: QuizPlayer[]; currentPlayer: QuizPlayer | null; lastResult: RoomState['lastResult']; connected: boolean; playing: boolean;
  spotifyError: string; onCategory: (id: string) => void; onPlay: () => void; onPause: () => void; onNext: () => void; onJudge: (result: 'correct' | 'incorrect') => void; onReveal: () => void; onSaveCategoryTracks: (categoryId: string, tracks: CatalogTrack[]) => void; onCloseRoom: () => void; onCopyInvite: () => void; onOpenRoom: () => void; onHome: () => void; toast: string;
}) {
  return <div className="app-frame">
    <Header roomCode={props.roomCode} connected={props.connected} onInvite={props.onCopyInvite} onScreen={props.onOpenRoom} onClose={props.onCloseRoom}/>
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-title"><Library size={19}/><span>La tua libreria</span></div>
        <div className="sidebar-tools"><button className="tool-pill active"><ListMusic size={15}/>Categorie</button><button className="tool-pill" onClick={props.onOpenRoom}><Users size={15}/>Schermo</button></div>
        <div className="category-list">
          {props.categories.map((category, index) => <button key={category.id} className={`category-item ${category.id === props.activeCategory?.id ? 'selected' : ''}`} onClick={() => props.onCategory(category.id)}>
            <span className="category-art" style={{ '--accent': category.color } as React.CSSProperties}><Music2 size={17}/></span><span className="category-item-copy"><b>{category.name}</b><small>{category.songs.length} brani</small></span>{index === 0 && !props.activeCategory ? <span className="category-bullet"/> : null}
          </button>)}
          {props.categories.length === 0 && <p className="empty-copy">Caricamento categorie…</p>}
        </div>
      </aside>

      <main className="main-content">
        <div className="content-nav"><button aria-label="Home" onClick={props.onHome}><Home size={17}/></button><div className="content-context">{props.activeCategory?.name ?? 'Scegli una categoria'}</div><span className="connection-inline"><i className={props.connected ? 'online' : ''}/>{props.connected ? 'Online' : 'Connessione…'}</span></div>
        <section className="category-heading">
          <span className="muted-label">STANZA {props.roomCode}</span>
          <h1>{props.activeCategory?.name ?? 'Scegli una categoria'}</h1>
          <p>{props.activeCategory ? 'Seleziona un brano da questa categoria.' : 'Scegli una categoria dalla libreria.'}</p>
        </section>
        <div className="track-header"><span>#</span><span>Brano</span><span>Esito</span></div>
        <div className="track-list">
          {(props.activeCategory?.songs ?? []).map((song, index) => <button key={song.id} className={`track-row ${props.selectedSlot === song.slot ? 'selected' : ''}`} onClick={() => song.slot && props.setSelectedSlot(song.slot)}>
            <span className="track-index">{props.lastResult && props.activeTrack?.slot === song.slot ? <Check size={15}/> : String(index + 1).padStart(2, '0')}</span>
            <span className="track-details"><b>{song.title || `Brano ${index + 1}`}</b><small>{song.artist || 'Non configurato'}</small></span>
            <span className={`track-result ${song.status}`}>{song.status === 'correct' ? 'Indovinato' : song.status === 'missed' ? 'Sbagliato' : song.status === 'revealed' ? 'Mostrato' : '—'}</span>
          </button>)}
          {!props.activeCategory && <p className="empty-copy">Le quattro tracce compariranno qui.</p>}
        </div>
        {props.activeCategory && <SpotifyCatalogPicker roomCode={props.roomCode} category={props.activeCategory} initialError={props.spotifyError} onSave={props.onSaveCategoryTracks} />}
        {props.currentPlayer && <div className="buzz-notice"><Users size={16}/><span><b>{props.currentPlayer.name}</b> ha prenotato la risposta.</span><button onClick={props.onReveal}>Mostra titolo</button><button className="answer-wrong" onClick={() => props.onJudge('incorrect')}><X size={15}/> Sbagliata</button><button className="answer-right" onClick={() => props.onJudge('correct')}><Check size={15}/> Giusta · +1</button></div>}
        {!props.currentPlayer && props.activeTrack && <div className="track-actions"><span>Brano selezionato: {props.activeTrack.title || `Brano ${props.activeTrack.slot}`}</span><button onClick={props.onReveal}>Mostra titolo</button><button onClick={props.onNext}>Prossimo brano</button></div>}
      </main>

      <aside className="players-panel"><div className="players-heading"><h2>In stanza</h2><span>{props.players.length}</span></div><div className="players-list">
        {props.players.length === 0 ? <p className="empty-copy">In attesa dei giocatori.</p> : [...props.players].sort((a, b) => b.score - a.score).map((player, index) => <div className={`player-row ${player.id === props.currentPlayer?.id ? 'buzzing' : ''}`} key={player.id}><span className="player-position">{index + 1}</span><span className="player-name">{player.name}{player.id === props.currentPlayer?.id && <small>HA PRENOTATO</small>}</span><b className="player-points">{player.score}</b></div>)}
      </div></aside>
    </div>
    <PlayerBar track={props.activeTrack} playing={props.playing} onPlay={props.onPlay} onPause={props.onPause}/>
    <Toast message={props.toast}/>
  </div>;
}

type CatalogPick = { title: string; artist: string; album?: string; coverArtUrl?: string; spotifyUri?: string; clipStartMs: number; clipLength: number; spotifyUrl?: string };
const categorySearch: Record<string, string> = {
  'Pop Hits': 'Pop Hits', 'Rock Anthems': 'Rock Anthems', '90s': '90s hits', '2000s': '2000s hits',
  'Italian Classics': 'Italian Classics', 'Movie Soundtracks': 'movie soundtracks', 'One Hit Wonders': 'one hit wonders',
  Dancefloor: 'dancefloor hits', 'Love Songs': 'love songs', 'TV Themes': 'TV theme songs',
};
const categorySuggestions: Record<string, Array<{ title: string; artist: string }>> = {
  'Pop Hits': [
    { title: 'Blinding Lights', artist: 'The Weeknd' }, { title: "Don't Start Now", artist: 'Dua Lipa' },
    { title: 'Uptown Funk', artist: 'Mark Ronson' }, { title: 'bad guy', artist: 'Billie Eilish' },
  ],
  'Rock Anthems': [
    { title: "Don't Stop Me Now", artist: 'Queen' }, { title: "Livin' on a Prayer", artist: 'Bon Jovi' },
    { title: 'Eye of the Tiger', artist: 'Survivor' }, { title: 'The Final Countdown', artist: 'Europe' },
  ],
  '90s': [
    { title: 'Smells Like Teen Spirit', artist: 'Nirvana' }, { title: 'Wannabe', artist: 'Spice Girls' },
    { title: 'Wonderwall', artist: 'Oasis' }, { title: '...Baby One More Time', artist: 'Britney Spears' },
  ],
  '2000s': [
    { title: 'Hey Ya!', artist: 'Outkast' }, { title: 'Crazy in Love', artist: 'Beyoncé' },
    { title: 'Hips Don’t Lie', artist: 'Shakira' }, { title: 'Poker Face', artist: 'Lady Gaga' },
  ],
  'Italian Classics': [
    { title: 'Azzurro', artist: 'Adriano Celentano' }, { title: 'Il mio canto libero', artist: 'Lucio Battisti' },
    { title: 'Gianna', artist: 'Rino Gaetano' }, { title: 'Albachiara', artist: 'Vasco Rossi' },
  ],
  'Movie Soundtracks': [
    { title: 'My Heart Will Go On', artist: 'Céline Dion' }, { title: 'Shallow', artist: 'Lady Gaga' },
    { title: 'Ghostbusters', artist: 'Ray Parker Jr.' }, { title: 'Eye of the Tiger', artist: 'Survivor' },
  ],
  'One Hit Wonders': [
    { title: 'Macarena', artist: 'Los Del Rio' }, { title: 'The One and Only', artist: 'Chesney Hawkes' },
    { title: "What's Up?", artist: '4 Non Blondes' }, { title: 'Somebody That I Used to Know', artist: 'Gotye' },
  ],
  Dancefloor: [
    { title: 'Freed From Desire', artist: 'Gala' }, { title: 'Blue (Da Ba Dee)', artist: 'Eiffel 65' },
    { title: 'L’Amour Toujours', artist: 'Gigi D’Agostino' }, { title: 'Rhythm Is a Dancer', artist: 'SNAP!' },
  ],
  'Love Songs': [
    { title: 'Your Song', artist: 'Elton John' }, { title: 'I Will Always Love You', artist: 'Whitney Houston' },
    { title: 'Perfect', artist: 'Ed Sheeran' }, { title: 'Make You Feel My Love', artist: 'Adele' },
  ],
  'TV Themes': [
    { title: 'I’ll Be There for You', artist: 'The Rembrandts' }, { title: 'The Fresh Prince of Bel-Air', artist: 'DJ Jazzy Jeff & The Fresh Prince' },
    { title: 'Pokémon Theme', artist: 'Jason Paige' }, { title: 'Mission: Impossible Theme', artist: 'Lalo Schifrin' },
  ],
};

function SpotifyCatalogPicker({ roomCode, category, initialError, onSave }: { roomCode: string; category: QuizCategory; initialError: string; onSave: (categoryId: string, tracks: CatalogTrack[]) => void }) {
  const [query, setQuery] = useState(categorySearch[category.name] ?? category.name);
  const [results, setResults] = useState<SpotifySearchTrack[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [selected, setSelected] = useState<CatalogPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(initialError);

  useEffect(() => {
    setQuery(categorySearch[category.name] ?? category.name);
    setResults([]); setOffset(0); setTotalResults(0); setError('');
    const saved = category.songs.filter(song => song.spotifyUri);
    if (saved.length === 4) {
      setSelected(saved.map(song => ({ title: song.title, artist: song.artist, album: '', coverArtUrl: song.coverArtUrl, spotifyUri: song.spotifyUri, clipStartMs: song.clipStartMs ?? 0, clipLength: song.clipLength ?? 6 })));
    } else {
      const seeds = categorySuggestions[category.name] ?? [];
      setSelected(seeds.map(({ title, artist }) => ({ title, artist, clipStartMs: 0, clipLength: 6 })));
    }
  }, [category.id]);

  useEffect(() => { void getSpotifyToken().then(token => setConnected(Boolean(token))); }, []);

  useEffect(() => {
    const seeds = categorySuggestions[category.name] ?? [];
    if (!connected || category.songs.some(song => song.spotifyUri) || seeds.length === 0) return;
    let cancelled = false;
    void Promise.all(seeds.map(async seed => {
      const exactQuery = `track:"${seed.title.replace(/"/g, '')}" artist:"${seed.artist.replace(/"/g, '')}"`;
      const page = await searchSpotifyTracks(exactQuery, 0, 10);
      const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
      return { seed, track: page.items.find(item => item.is_playable !== false && normalize(item.name) === normalize(seed.title) && item.artists.some(artist => normalize(artist.name) === normalize(seed.artist))) };
    })).then(matches => {
      if (cancelled) return;
      setSelected(current => current.map(item => {
        const found = matches.find(match => match.seed.title === item.title && match.seed.artist === item.artist)?.track;
        return found ? { ...item, title: found.name, artist: found.artists.map(artist => artist.name).join(', '), album: found.album.name, spotifyUri: found.uri, coverArtUrl: found.album.images?.[0]?.url, spotifyUrl: found.external_urls.spotify } : item;
      }));
      if (matches.some(match => !match.track)) setError('Alcuni suggerimenti non hanno una corrispondenza esatta in Spotify. Rimuovili e cercali manualmente.');
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Non riesco a caricare i suggerimenti.'); });
    return () => { cancelled = true; };
  }, [category.id, connected]);

  const search = async (event: React.FormEvent, nextOffset = 0) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setError('');
    try {
      const page = await searchSpotifyTracks(query.trim(), nextOffset, 10);
      setResults(page.items); setOffset(page.offset); setTotalResults(page.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ricerca Spotify non riuscita.'); }
    finally { setSearching(false); }
  };

  const toggle = (result: SpotifySearchTrack) => {
    setError('');
    if (result.is_playable === false) { setError('Questo brano non è riproducibile nel mercato Spotify del tuo account.'); return; }
    const existing = selected.findIndex(item => item.spotifyUri === result.uri);
    if (existing >= 0) { setSelected(selected.filter((_, index) => index !== existing)); return; }
    if (selected.length >= 4) { setError('Hai già quattro brani. Togli una scelta per sostituirla.'); return; }
    setSelected([...selected, {
      title: result.name, artist: result.artists.map(artist => artist.name).join(', '), album: result.album.name,
      spotifyUri: result.uri, clipStartMs: 0, clipLength: 6, coverArtUrl: result.album.images?.[0]?.url, spotifyUrl: result.external_urls.spotify,
    }]);
  };

  const updatePick = (index: number, values: Partial<Pick<CatalogPick, 'clipStartMs' | 'clipLength'>>) => setSelected(current => current.map((item, i) => i === index ? { ...item, ...values } : item));
  const save = () => {
    if (selected.length !== 4 || selected.some(item => !item.spotifyUri)) return setError('Scegli quattro brani con corrispondenza Spotify prima di salvare.');
    onSave(category.id, selected.map(({ title, artist, album, coverArtUrl, spotifyUri, clipStartMs, clipLength }) => ({ title, artist, album, coverArtUrl, spotifyUri: spotifyUri!, clipStartMs, clipLength })));
  };

  return <section className="catalog-picker">
    <div className="catalog-title"><div><span className="muted-label">CATALOGO SPOTIFY</span><h2>Quattro brani per {category.name}</h2></div><span>{selected.length}/4</span></div>
    {!connected ? <div className="catalog-connect"><span>Collega Spotify da questo dispositivo per cercare nel catalogo.</span><button onClick={() => void beginSpotifyLogin(roomCode, 'admin').catch(reason => setError(reason instanceof Error ? reason.message : 'Accesso Spotify non riuscito.'))} disabled={!hasSpotifyClientId()}>Collega Spotify</button></div> : <>
      <form className="catalog-search" onSubmit={event => void search(event, 0)}><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Cerca brani Spotify" placeholder="Categoria, artista o titolo"/><button type="submit" disabled={searching}>{searching ? 'Cerco…' : 'Cerca'}</button></form>
      <small className="catalog-hint">Quattro proposte iniziali basate sulla categoria. Puoi cercare titoli o artisti precisi, poi aggiungere o togliere brani.</small>
      <div className="catalog-results">{results.map(result => {
        const isSelected = selected.some(item => item.spotifyUri === result.uri);
        return <button key={result.id} className={`catalog-result ${isSelected ? 'chosen' : ''} ${result.is_playable === false ? 'unavailable' : ''}`} onClick={() => toggle(result)} disabled={result.is_playable === false}>
          {result.album.images?.[2]?.url || result.album.images?.[0]?.url ? <img src={result.album.images?.[2]?.url ?? result.album.images?.[0]?.url} alt=""/> : <span className="catalog-placeholder"><Music2 size={17}/></span>}
          <span><b>{result.name}</b><small>{result.is_playable === false ? 'Non disponibile per la riproduzione' : `${result.artists.map(artist => artist.name).join(', ')} · ${result.album.name}${result.album.release_date ? ` · ${result.album.release_date.slice(0, 4)}` : ''}`}</small></span><span className="catalog-add">{isSelected ? '✓' : result.is_playable === false ? '–' : selected.length < 4 ? '+' : '4/4'}</span>
        </button>;
      })}{results.length === 0 && <p className="empty-copy">Cerca nel catalogo per vedere i risultati.</p>}</div>
      {totalResults > 10 && <div className="catalog-pagination"><button type="button" onClick={event => void search(event, Math.max(0, offset - 10))} disabled={searching || offset === 0}>Precedenti</button><span>{offset + 1}–{Math.min(offset + results.length, totalResults)} di {totalResults}</span><button type="button" onClick={event => void search(event, offset + 10)} disabled={searching || offset + 10 >= totalResults}>Altri 10</button></div>}
      <div className="catalog-selected"><h3>Scelte e timing del clip</h3>{selected.map((item, index) => <div className="catalog-pick" key={item.spotifyUri ?? `${item.title}-${item.artist}`}>
        {item.coverArtUrl ? <img src={item.coverArtUrl} alt=""/> : <span className="catalog-placeholder"><Music2 size={16}/></span>}
        <span className="catalog-pick-copy"><b>{item.title}</b><small>{item.artist}{!item.spotifyUri ? ' · Da associare a Spotify' : ''}</small></span>
        <label>Inizio (s)<input type="number" min="0" max="900" step="0.1" value={(item.clipStartMs / 1000).toFixed(1)} onChange={event => updatePick(index, { clipStartMs: Math.max(0, Math.round(Number(event.target.value) * 1000)) })}/></label>
        <label>Clip (s)<input type="number" min="1" max="30" step="1" value={item.clipLength} onChange={event => updatePick(index, { clipLength: Math.min(30, Math.max(1, Math.round(Number(event.target.value) || 1))) })}/></label>
        {item.spotifyUrl && <a href={item.spotifyUrl} target="_blank" rel="noreferrer" aria-label="Apri il brano su Spotify"><ExternalLink size={15}/></a>}
        <button type="button" className="catalog-remove" onClick={() => setSelected(selected.filter((_, i) => i !== index))} aria-label={`Rimuovi ${item.title}`}><X size={14}/></button>
      </div>)}
      <button className="catalog-save" onClick={save} disabled={selected.length !== 4 || selected.some(item => !item.spotifyUri) || !connected}>Salva i quattro brani</button>
      </div>
    </>}
    {error && <p className="catalog-error">{error}</p>}
  </section>;
}

function PlayerBar({ track, playing, onPlay, onPause }: { track: QuizCategory['songs'][number] | null; playing: boolean; onPlay: () => void; onPause: () => void }) {
  const available = Boolean(track?.spotifyUri);
  return <footer className="player-bar">
    <div className="player-bar-track"><span className="mini-cover"><Music2 size={18}/></span><span><b>{track?.title || (track ? `Brano ${track.slot}` : 'Nessun brano selezionato')}</b><small>{track?.artist || (track ? 'Audio non configurato' : 'Seleziona un brano')}</small></span></div>
    <div className="player-bar-controls"><button className="play-button" disabled={!available} onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pausa' : 'Riproduci'}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><span className="audio-status">{available ? 'Sorgente audio configurata' : 'Sorgente audio da configurare'}</span></div>
  </footer>;
}

function PlayerPage({ name, roomCode, players, playerId, buzzed, connected, onBuzz, toast }: { name: string; roomCode: string; players: QuizPlayer[]; playerId: string; buzzed: boolean; connected: boolean; onBuzz: () => void; toast: string }) {
  const me = players.find(player => player.id === playerId);
  const rank = [...players].sort((a, b) => b.score - a.score).findIndex(player => player.id === playerId) + 1;
  return <main className="phone-page">
    <header className="phone-header"><Brand/><span>STANZA {roomCode}</span><span className={`connection-dot ${connected ? 'online' : ''}`}/></header>
    <section className="phone-main"><p className="phone-name">{name}</p><h1>{buzzed ? 'Hai prenotato.' : 'Riconosci il brano?'}</h1><p className="phone-help">{connected ? buzzed ? 'Aspetta che il presentatore valuti la risposta.' : 'Tocca il pulsante appena riconosci la canzone.' : 'Connessione alla stanza…'}</p>
      <button className={`buzz-button ${buzzed ? 'pressed' : ''}`} disabled={!connected || buzzed} onClick={onBuzz}><span>{buzzed ? <Check size={32}/> : 'PRENOTA'}</span></button>
      <div className="phone-score"><div><small>PUNTEGGIO</small><b>{me?.score ?? 0}</b></div><div><small>POSIZIONE</small><b>{rank > 0 ? `#${rank}` : '—'}</b></div></div>
    </section>
    <Toast message={toast}/>
  </main>;
}

function RoomPage({ roomCode, categories, activeCategory, activeTrack, players, currentPlayer, lastResult, playing, spotifyError, toast }: { roomCode: string; categories: QuizCategory[]; activeCategory: QuizCategory | null; activeTrack: QuizCategory['songs'][number] | null; players: QuizPlayer[]; currentPlayer: QuizPlayer | null; lastResult: RoomState['lastResult']; playing: boolean; spotifyError: string; toast: string }) {
  const [spotifyReady, setSpotifyReady] = useState(false);
  const answerVisible = Boolean(activeTrack && activeTrack.status !== 'hidden');
  return <main className="display-page">
    <header className="display-header"><Brand/><span>STANZA {roomCode}</span><span>{players.length} GIOCATORI</span></header>
    <SpotifyRoomPlayer track={activeTrack} playing={playing} initialError={spotifyError} onConnectionChange={setSpotifyReady} />
    <RoomNowPlaying title={answerVisible ? activeTrack?.title ?? '' : ''} artist={answerVisible ? activeTrack?.artist : undefined} albumArtUrl={answerVisible ? activeTrack?.coverArtUrl : undefined} playing={playing} connected={spotifyReady} />
    <section className="display-content"><p className="muted-label">CATEGORIA</p><h1>{activeCategory?.name ?? 'In attesa del presentatore'}</h1>
      <div className="display-track-list">{(activeCategory?.songs ?? []).map((song, index) => <div key={song.id} className={`display-track ${song.status}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{song.title || (song.status === 'hidden' ? 'Titolo nascosto' : `Brano ${index + 1}`)}</b><small>{song.status === 'correct' ? '✓' : song.status === 'missed' ? '×' : ''}</small></div>)}</div>
      <div className={`display-now result-${lastResult ?? 'pending'}`}>
        {currentPlayer ? <><span>HA PRENOTATO</span><b>{currentPlayer.name}</b><small>{lastResult === 'correct' ? 'Risposta corretta · +1 punto' : lastResult === 'incorrect' ? 'Risposta sbagliata' : 'In attesa del verdetto'}</small></> : <><span>{playing ? 'IN ASCOLTO' : activeTrack ? 'CLIP IN PAUSA' : 'IN ATTESA'}</span><b>{playing ? 'Chi riconosce il brano?' : activeTrack ? 'Brano rivelato o in pausa' : 'Scegli una categoria'}</b></>}
      </div>
    </section>
    <div className="display-scoreboard">{[...players].sort((a, b) => b.score - a.score).map(player => <div key={player.id}><span>{player.name}</span><b>{player.score}</b></div>)}</div>
    <Toast message={toast}/>
  </main>;
}

function SpotifyRoomPlayer({ track, playing, initialError, onConnectionChange }: { track: QuizCategory['songs'][number] | null; playing: boolean; initialError: string; onConnectionChange: (connected: boolean) => void }) {
  const [deviceId, setDeviceId] = useState('');
  const [connected, setConnected] = useState(false);
  const [activated, setActivated] = useState(false);
  const [error, setError] = useState(initialError);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const lastCommandRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    let player: SpotifyPlayer | null = null;
    void (async () => {
      const token = await getSpotifyToken();
      if (!token || !hasSpotifyClientId()) return;
      await loadSpotifySdk();
      if (cancelled || !window.Spotify) return;
      player = new window.Spotify.Player({ name: 'Side A · Stanza', volume: 0.8, getOAuthToken: callback => { void getSpotifyToken().then(value => { if (value) callback(value); }); } });
      playerRef.current = player;
      player.addListener('ready', ({ device_id }: { device_id: string }) => { if (!cancelled) { setDeviceId(device_id); setConnected(true); onConnectionChange(true); setError(''); } });
      player.addListener('not_ready', () => { if (!cancelled) { setConnected(false); onConnectionChange(false); } });
      player.addListener('initialization_error', ({ message }: { message: string }) => { if (!cancelled) setError(message); });
      player.addListener('authentication_error', ({ message }: { message: string }) => { if (!cancelled) setError(message); });
      player.addListener('account_error', ({ message }: { message: string }) => { if (!cancelled) setError(message); });
      player.addListener('playback_error', ({ message }: { message: string }) => { if (!cancelled) setError(message); });
      await player.connect();
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Impossibile avviare Spotify.'); });
    return () => { cancelled = true; if (timeoutRef.current) window.clearTimeout(timeoutRef.current); void player?.pause(); player?.disconnect(); playerRef.current = null; };
  }, []);

  useEffect(() => {
    const command = playing ? `play:${track?.id ?? ''}` : 'pause';
    if (command === lastCommandRef.current) return;
    if (playing && (!track?.spotifyUri || !deviceId)) return;
    const previous = lastCommandRef.current;
    lastCommandRef.current = command;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (playing && track?.spotifyUri && deviceId) {
      void playSpotifyClip(deviceId, track.spotifyUri, track.clipStartMs ?? 0).then(() => {
        timeoutRef.current = window.setTimeout(() => { void playerRef.current?.pause(); }, Math.max(1, track.clipLength ?? 6) * 1000);
      }).catch(reason => setError(reason instanceof Error ? reason.message : 'Riproduzione Spotify non riuscita.'));
    } else if (!playing && previous.startsWith('play:')) {
      void playerRef.current?.pause();
    }
    return () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); };
  }, [playing, track?.id, track?.spotifyUri, track?.clipStartMs, track?.clipLength, deviceId]);

  const connect = () => {
    setError('');
    void beginSpotifyLogin(new URLSearchParams(location.search).get('code') ?? '').catch(reason => setError(reason instanceof Error ? reason.message : 'Accesso Spotify non riuscito.'));
  };
  return <div className="spotify-room-player">
    {!connected ? <button onClick={connect} disabled={!hasSpotifyClientId()}>{hasSpotifyClientId() ? 'Collega Spotify a questa schermata' : 'Configura Client ID Spotify'}</button> : <><span className="spotify-live-dot"/>Spotify collegato alla schermata stanza <button onClick={() => void playerRef.current?.activateElement().then(() => setActivated(true))}>{activated ? 'Audio attivato' : 'Attiva audio'}</button></>}
    {error && <small>{error}</small>}
  </div>;
}

function Toast({ message }: { message: string }) {
  return message ? <div className="toast">{message}</div> : null;
}
