import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));

const PORT = process.env.PORT || 10000;

// Optional libs (will be tried dynamically if present)
let goLib = null;
async function tryLoadLibs(){
  if (goLib) return goLib;
  const candidates = ['gogoanime-api', 'gogoanime-api-new'];
  for (const name of candidates){
    try {
      const mod = await import(name);
      const GoGo = mod.GoGoAnime || mod.default?.GoGoAnime || mod.default;
      if (GoGo){
        goLib = new GoGo();
        console.log('[gogo] using optional lib:', name);
        return goLib;
      }
    } catch(e){
      // ignore; optional
    }
  }
  console.log('[gogo] no optional lib found; using public fallback only');
  goLib = null;
  return null;
}

// Public fallback (best-effort)
const FALLBACK_BASES = ['https://jaybeeanime.vercel.app'];
async function fb(path){
  for (const base of FALLBACK_BASES){
    try {
      const r = await fetch(base + path, { headers: { 'user-agent': 'AniRatio/1.0' } });
      if (r.ok) return await r.json();
    } catch(e){}
  }
  return null;
}

const mapItem = (a)=> ({
  id: a?.id || a?.animeId || a?.slug || a?.url || a?.alias || '',
  title: a?.title || a?.name || a?.animeTitle || '',
  cover: a?.cover || a?.image_url || a?.image || a?.img || a?.poster || a?.pic || '',
  tags: a?.genres || a?.genre || []
});

app.get('/ping', (req,res)=> res.json({ ok:true, provider:'gogo', time:new Date().toISOString() }));

app.get('/trending', async (req,res)=>{
  const lib = await tryLoadLibs();
  if (lib?.trending){
    try { const data = await lib.trending(); return res.json(data.map(mapItem)); } catch{}
  }
  const data = await fb('/trending'); return res.json((data?.data||data?.results||data)||[]);
});

app.get('/recent', async (req,res)=>{
  const lib = await tryLoadLibs();
  if (lib?.recentEpisodes){
    try { const data = await lib.recentEpisodes(); return res.json(data.map(mapItem)); } catch{}
  }
  const data = await fb('/recent'); return res.json((data?.data||data?.results||data)||[]);
});

app.get('/genres', async (req,res)=>{
  const lib = await tryLoadLibs();
  if (lib?.genres){
    try { const data = await lib.genres(); return res.json(Array.isArray(data)? data : (data?.genres||[])); } catch{}
  }
  const data = await fb('/genres'); return res.json(data?.genres || data || []);
});

app.get('/search', async (req,res)=>{
  const q = (req.query.q||'').toString().trim();
  if (!q) return res.json([]);
  const lib = await tryLoadLibs();
  if (lib?.search){
    try { const data = await lib.search(q); return res.json(data.map(mapItem)); } catch{}
  }
  const data = await fb('/search?q=' + encodeURIComponent(q)); return res.json((data?.data||data?.results||data)||[]);
});

app.get('/anime/:id', async (req,res)=>{
  const id = req.params.id;
  const lib = await tryLoadLibs();
  if (lib?.animeDetails){
    try { const d = await lib.animeDetails(id);
      return res.json({ title: d?.title||d?.name||d?.animeTitle||'', cover: d?.cover||d?.image||d?.poster||'', description: d?.description||d?.synopsis||d?.summary||'' });
    } catch{}
  }
  const d = await fb('/anime/' + encodeURIComponent(id));
  return res.json({ title: d?.title||d?.name||d?.animeTitle||'Unknown', cover: d?.cover||d?.image||d?.poster||'', description: d?.description||d?.synopsis||d?.summary||'' });
});

app.get('/anime/:id/episodes', async (req,res)=>{
  const id = req.params.id;
  const lib = await tryLoadLibs();
  if (lib?.episodes){
    try { const eps = await lib.episodes(id);
      return res.json((eps||[]).map(e => ({ id: e?.id||e?.episodeId||e?.url||'', number: e?.number||e?.epNum||e?.episode||'', title: e?.title || `Episode ${e?.number||''}` })));
    } catch{}
  }
  const data = await fb('/anime/' + encodeURIComponent(id) + '/episodes');
  return res.json((data?.data||data?.results||data)||[]);
});

app.get('/watch/:episode_id', async (req,res)=>{
  const eid = req.params.episode_id;
  const lib = await tryLoadLibs();
  if (lib?.sources){
    try {
      const w = await lib.sources(eid);
      const url = w?.url || w?.stream || (Array.isArray(w?.sources) ? (w.sources[0]?.file || '') : '');
      return res.json({ url: url || '' });
    } catch{}
  }
  const w = await fb('/watch/' + encodeURIComponent(eid));
  const url = w?.url || w?.stream || (Array.isArray(w?.sources) ? (w.sources[0]?.file || '') : '');
  return res.json({ url: url || '' });
});

app.listen(PORT, ()=> console.log(`[gogo-proxy] listening on ${PORT}`));
