import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { readApiResponse } from '../src/api-response.mjs';

const API = '/api/server/v1';
type Source = { id: string; name: string; ecosystem: string; languages: string[]; available: boolean };
type Anime = { id: string; title?: string; name?: string; image?: string; poster?: string; type?: string; sourceId: string; sourceName: string };
type Stream = { url: string; source?: string; quality?: string; subtitles?: Array<{ url?: string; lang?: string; language?: string; label?: string }> };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const envelope = await readApiResponse(response) as { success: boolean; data?: T; error?: { message?: string } };
  if (!envelope.success) throw Error(envelope.error?.message || 'Request failed');
  return envelope.data as T;
}

function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Anime[]>([]);
  const [selected, setSelected] = useState<Anime | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api<Source[]>('/sources').then(setSources).catch(() => setError('Connect Anidaku to a configured Hindi source server first.')); }, []);
  const sourceLabel = useMemo(() => sources.length ? `${sources.length} Hindi source${sources.length === 1 ? '' : 's'} online` : 'No Hindi sources configured', [sources.length]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || !sources.length) return;
    setLoading(true); setError(''); setSelected(null); setStreams([]);
    try {
      const groups = await Promise.all(sources.map(async source => {
        const items = await api<any[]>(`/invoke`, { method: 'POST', body: JSON.stringify({ sourceId: source.id, op: 'search', args: { query: query.trim(), type: 'series' } }) });
        return (Array.isArray(items) ? items : []).slice(0, 12).map(item => ({ ...item, title: item.title || item.name, sourceId: source.id, sourceName: source.name }));
      }));
      setResults(groups.flat().filter(item => item.title));
    } catch { setError('Search failed. Check the source configuration and try again.'); }
    finally { setLoading(false); }
  }

  async function watch(anime: Anime) {
    setSelected(anime); setStreams([]); setLoading(true); setError('');
    try {
      const data = await api<any>('/resolve', { method: 'POST', body: JSON.stringify({ title: anime.title, id: anime.id, type: anime.type || 'series', episode: 1, season: 1 }) });
      setStreams(data.sources || []);
      if (!data.sources?.length) setError('No playable Hindi stream was returned for this title.');
    } catch { setError('Playback lookup failed for this title.'); }
    finally { setLoading(false); }
  }

  return <div className="anidaku-shell">
    <header className="anidaku-nav"><a className="brand" href="/">ani<span>daku</span></a><div className="nav-links"><span>{sourceLabel}</span><a href="/admin">Server admin</a></div></header>
    <main>
      <section className="hero"><p className="eyebrow">Hindi anime test library</p><h1>Watch anime.<br /><em>Find your next story.</em></h1><p className="hero-copy">A small Anidaku preview powered by your Hindi source server.</p>
        <form className="search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search anime titles..." aria-label="Search anime" /><button disabled={loading}>{loading ? 'Searching…' : 'Search'}</button></form>
        <p className="hint">Only providers marked for Hindi audio or subtitles appear here.</p>
      </section>
      {error && <div className="notice">{error}</div>}
      {results.length > 0 && <section className="results"><div className="section-head"><h2>Search results</h2><span>{results.length} titles</span></div><div className="anime-grid">{results.map((anime, index) => <article className="anime-card" key={`${anime.sourceId}-${anime.id}-${index}`}><div className="poster">{anime.image || anime.poster ? <img src={anime.image || anime.poster} alt="" /> : <div className="poster-fallback">AN</div>}</div><div className="card-copy"><h3>{anime.title}</h3><p>{anime.sourceName}</p><button onClick={() => watch(anime)}>Play episode 1</button></div></article>)}</div></section>}
      {selected && <section className="player-section"><div className="section-head"><h2>{selected.title}</h2><span>Hindi playback</span></div>{streams.length > 0 ? <div className="player-wrap"><video controls poster={selected.image || selected.poster} src={streams[0].url} /><div className="stream-list">{streams.map((stream, index) => <a href={stream.url} target="_blank" rel="noreferrer" key={`${stream.url}-${index}`}>{stream.quality || 'Auto'} · {stream.source || 'Source'}</a>)}</div></div> : <div className="empty-player">{loading ? 'Finding a playable stream…' : 'Choose another result or configure more sources in Server admin.'}</div>}</section>}
      {!results.length && !error && <section className="empty-state"><div className="spark">✦</div><h2>Your next anime is waiting.</h2><p>Search above to test the Anidaku source connection.</p></section>}
    </main>
    <footer><span>ANIDAKU / TEST BUILD</span><span>Powered by your Hindi Anime Server</span></footer>
  </div>;
}

const Admin = React.lazy(() => import('./admin'));
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/admin') ? <React.Suspense fallback={<div className="admin-loading">Loading server admin…</div>}><Admin /></React.Suspense> : <App />);
