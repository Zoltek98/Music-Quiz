import { Music2, Radio } from 'lucide-react';
import './RoomNowPlaying.css';

export interface RoomNowPlayingProps {
  title: string;
  artist?: string;
  albumArtUrl?: string;
  playing: boolean;
  connected: boolean;
}

/** Shared-screen feature panel. Pass an empty title while the answer is hidden. */
export default function RoomNowPlaying({ title, artist, albumArtUrl, playing, connected }: RoomNowPlayingProps) {
  const hasTrack = Boolean(title);

  return <section className={`room-now-playing ${playing ? 'is-playing' : ''} ${hasTrack ? 'has-track' : 'is-empty'}`} aria-live="polite">
    <div className="room-now-playing-glow" aria-hidden="true" />
    <div className="room-now-playing-topline">
      <span className="room-now-playing-eyebrow"><Radio size={14}/>{playing ? 'ORA IN RIPRODUZIONE' : hasTrack ? 'BRANO SELEZIONATO' : 'PROSSIMO BRANO'}</span>
      <span className={`room-now-playing-connection ${connected ? 'connected' : ''}`}><i/>{connected ? 'PLAYER PRONTO' : 'PLAYER NON COLLEGATO'}</span>
    </div>

    <div className="room-now-playing-main">
      <div className="room-now-playing-art-wrap">
        {albumArtUrl ? <img className="room-now-playing-art" src={albumArtUrl} alt={title ? `Copertina di ${title}` : 'Copertina del brano'} /> : <div className="room-now-playing-art room-now-playing-art-empty"><Music2 size={38}/></div>}
        <span className="room-now-playing-art-ring" aria-hidden="true" />
      </div>
      <div className="room-now-playing-copy">
        <span className="room-now-playing-label">{playing ? 'In ascolto' : hasTrack ? 'Pronto a partire' : 'La selezione continua'}</span>
        <h2>{title || 'La prossima sorpresa'}</h2>
        <p>{artist || (hasTrack ? 'Artista nascosto' : 'Il presentatore sta scegliendo un brano')}</p>
      </div>
      <div className="room-now-playing-wave" aria-label={playing ? 'Riproduzione in corso' : 'Riproduzione in pausa'} role="img">
        {Array.from({ length: 36 }, (_, index) => <i key={index} style={{ '--bar': `${16 + ((index * 37 + index * index * 11) % 77)}%`, '--delay': `${(index % 13) * -0.09}s`, '--duration': `${0.65 + (index % 7) * 0.12}s` } as React.CSSProperties} />)}
      </div>
    </div>
  </section>;
}
