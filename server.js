// server.js — AniRatio proxy (Gogo first; Jikan fallback)
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const LRU = require('lru-cache').LRU;

// Try to load gogo lib; keep app running if it fails
let gogo = null;
try {
  gogo = require('gogoanime-api-new'); // {search, recent, topAiring, ...} (apis vary)
} catch (e) {
  // continue with null gogo and rely on Jikan
}

const log = pino(process.env.NODE_ENV === 'production' ? {} : { transport: { target: 'pino-pretty' } });
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const cache = new LRU({ max: 300, ttl: 1000 * 60 * 5 }); // 5 min

const ok = (res, data) => res.json(data);
const err = (res, code, msg) => res.status(code).json({ error: msg });

// ---- Helpers ----
async function jikan(path) {
  const url = `https://api.jikan.moe/v4${path}`;
  const key = `jk:${url}`;
  if (cache.has(key)) return cache.get(key);
  const r = await fetch(url, { headers: { 'user-agent': 'AniRatioProxy/1.0' } });
  if (!r.ok) throw new Error(`Jikan ${r.status}`);
  const j = await r.json();
  cache.set(key, j, { ttl: 1000 * 60 * 3 });
  return j;
}

async function tryGogoRecent(page = 1) {
  if (!gogo) return [];
  try {
    // Many variants out there:
    // Some libs: gogo.recent(page), others: gogo.fetchRecentReleases(page)
    const list = (await (gogo.recent?.(page) ?? gogo.fetchRecentReleases?.(page))) || [];
    return Array.isArray(list) ? list : (list.results || []);
  } catch (e) {
    log.warn({ msg: 'gogo recent failed', e: String(e) });
    return [];
  }
}

async function tryGogoTop(page = 1) {
  if (!gogo) return [];
  try {
    const list = (await (gogo.topAiring?.(page) ?? gogo.trending?.(page))) || [];
    return Array.isArray(list) ? list : (list.results || []);
  } catch (e) {
    log.warn({ msg: 'gogo top failed', e: String(e) });
    return [];
  }
}

function mapGogo(items = []) {
  return items.map(x => ({
    title: x.title || x.name || 'Unknown',
    image_url: x.image || x.poster || x.image_url || '',
    anime_id: x.id || x.slug || x.animeId || x.anime_id || '',
    synopsis: x.description || x.synopsis || ''
  }));
}

function mapJikan(items = []) {
  return items.map(x => ({
    title: x.title || 'Unknown',
    image_url: x.images?.jpg?.image_url || x.images?.webp?.image_url || '',
    anime_id: `mal-${x.mal_id}`,
    synopsis: x.synopsis || ''
  }));
}

// ---- Routes ----
app.get('/ping', (req, res) => ok(res, { ok: true, time: new Date().toISOString() }));

// Recent releases (homepage “recent”)
app.get('/recent', async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    let data = await tryGogoRecent(page);
    if (!data.length) {
      // fallback: Jikan current season
      const jk = await jikan(`/seasons/now?limit=24&page=${page}`);
      data = mapJikan(jk.data);
      return ok(res, data);
    }
    return ok(res, mapGogo(data));
  } catch (e) {
    log.error({ route: 'recent', e: String(e) });
    return err(res, 500, 'recent_failed');
  }
});

// Top airing (homepage “trending”)
app.get('/top-airing', async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    let data = await tryGogoTop(page);
    if (!data.length) {
      const jk = await jikan(`/top/anime?filter=airing&limit=24&page=${page}`);
      data = mapJikan(jk.data);
      return ok(res, data);
    }
    return ok(res, mapGogo(data));
  } catch (e) {
    log.error({ route: 'top-airing', e: String(e) });
    return err(res, 500, 'top_failed');
  }
});

// Alias for your front-end
app.get('/trending', (req, res) => {
  req.url = req.url.replace('/trending', '/top-airing');
  app._router.handle(req, res);
});

// Search
app.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return ok(res, { results: [] });
  try {
    let results = [];
    if (gogo?.search) {
      const g = await gogo.search(q);
      results = Array.isArray(g) ? g : (g?.results || []);
      if (results.length) return ok(res, { results: mapGogo(results), provider: 'gogo' });
    }
    const jk = await jikan(`/anime?q=${encodeURIComponent(q)}&limit=24`);
    return ok(res, { results: mapJikan(jk.data), provider: 'jikan' });
  } catch (e) {
    log.error({ route: 'search', e: String(e) });
    return err(res, 500, 'search_failed');
  }
});

// Anime details (minimal; you can expand later)
app.get('/anime/:id', async (req, res) => {
  const id = req.params.id;
  try {
    if (id.startsWith('mal-')) {
      const malId = id.slice(4);
      const jk = await jikan(`/anime/${malId}`);
      const d = jk.data || {};
      return ok(res, {
        title: d.title,
        image_url: d.images?.jpg?.image_url || '',
        description: d.synopsis || '',
        episodes: (d.episodes ?? 0)
      });
    }
    // If gogo lib exposes detail method, use it:
    if (gogo?.animeDetails) {
      const d = await gogo.animeDetails(id);
      return ok(res, d);
    }
    return ok(res, { title: 'Unknown', image_url: '', description: '', episodes: 0 });
  } catch (e) {
    log.error({ route: 'anime', id, e: String(e) });
    return err(res, 500, 'anime_failed');
  }
});

// Stream / sources (placeholder; wire to your gogo lib if supported)
app.get('/stream', async (req, res) => {
  const ep = String(req.query.ep || '');
  if (!ep) return err(res, 400, 'missing_ep');
  try {
    // Example shape; adjust to your library
    if (gogo?.sources) {
      const s = await gogo.sources(ep);
      return ok(res, s);
    }
    return ok(res, { sources: [] });
  } catch (e) {
    log.error({ route: 'stream', ep, e: String(e) });
    return err(res, 500, 'stream_failed');
  }
});

app.listen(PORT, () => log.info(`[gogo-proxy] listening on ${PORT}`));
