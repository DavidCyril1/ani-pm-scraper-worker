/**
 * ani.pm Scraper — Cloudflare Worker / edge version
 * Same endpoints as the Express API, runs on the edge with Hono.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const BASE = 'https://ani.pm';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://ani.pm/',
  Origin: 'https://ani.pm',
};

async function aniGet(path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: DEFAULT_HEADERS });
  const text = await res.text();
  if (res.status === 403 || text.includes('Just a moment')) {
    const err = new Error('Cloudflare challenge or blocked');
    err.status = 403;
    throw err;
  }
  if (!res.ok) {
    let msg = `Upstream ${res.status}`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function absUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return BASE + path;
}

function normalizeAnime(item) {
  if (!item) return null;
  return {
    id: item.id,
    source: item.source,
    slug: item.slug || null,
    routeId: item.routeId || null,
    title: item.title,
    nativeTitle: item.native || null,
    poster: absUrl(item.poster),
    banner: absUrl(item.banner),
    year: item.year,
    score: item.score,
    rating: item.rating,
    duration: item.duration,
    status: item.status,
    type: item.type,
    genres: item.genres || [],
    studios: item.studios || [],
    episodeCount: item.episodeCount,
    subCount: item.subCount,
    dubCount: item.dubCount,
    synopsis: item.synopsis,
    malId: item.malId,
    anilistId: item.anilistId,
    season: item.season,
    rank: item.rank,
    views: item.views,
    tags: item.tags || [],
    hasDub: item.hasDub,
  };
}

function normalizeEpisode(ep) {
  if (!ep) return null;
  return {
    number: ep.number,
    sourceNumber: ep.sourceNumber,
    title: ep.title,
    thumbnail: ep.thumbnail,
    description: ep.description,
    sub: !!ep.sub,
    dub: !!ep.dub,
    subExact: ep.subExact,
    dubExact: ep.dubExact,
    runtimeSeconds: ep.runtimeSeconds,
    routeId: ep.routeId,
  };
}

async function getEpisodeRouteId(id, episode) {
  const series = await aniGet(`/api/anime/series/${id}`, {
    phase: 'core',
    routes: 'e4',
  });
  const ep = (series.episodes || []).find((e) => e.number === episode);
  if (!ep?.routeId) {
    const err = new Error(`Episode ${episode} not found or missing routeId`);
    err.status = 404;
    throw err;
  }
  return { routeId: ep.routeId, source: series.source || 'settlar' };
}

async function getStream(id, episode, { lang = 'sub', source, routeId } = {}) {
  const epNum = Number(episode);
  if (!Number.isFinite(epNum) || epNum < 1) {
    const err = new Error('Invalid episode number');
    err.status = 400;
    throw err;
  }

  let resolvedRouteId = routeId;
  let resolvedSource = source || 'settlar';
  if (!resolvedRouteId) {
    const info = await getEpisodeRouteId(id, epNum);
    resolvedRouteId = info.routeId;
    resolvedSource = info.source;
  }

  const channel = lang === 'dub' ? 'dub' : 'sub';
  const bootstrap = await aniGet(
    `/api/anime/playback-bootstrap/${resolvedSource}/${id}`,
    { ep: resolvedRouteId, lang: channel }
  );

  const selection = bootstrap.settlarSelection;
  if (!selection) {
    const err = new Error('No settlarSelection — episode may be unavailable');
    err.status = 404;
    throw err;
  }

  const session = await aniGet('/api/anime/settlar/session', {
    selection,
    provider: 'anipm',
    ep: String(epNum),
    channel,
    telemetry: '0',
  });

  const now = Math.floor(Date.now() / 1000);
  return {
    id: Number(id),
    episode: epNum,
    lang: bootstrap.effectiveLanguage || channel,
    embedUrl: session.embedUrl,
    expiresAt: session.expiresAt,
    expiresInSeconds: session.expiresAt
      ? Math.max(0, session.expiresAt - now)
      : null,
    provider: session.provider || 'anipm',
    skip: bootstrap.skip || null,
    availability: bootstrap.availability,
    selection,
    routeId: resolvedRouteId,
    source: resolvedSource,
  };
}

const app = new Hono();

app.use('*', cors());

app.get('/', (c) =>
  c.json({
    name: 'ani.pm Scraper Worker',
    version: '1.0.0',
    runtime: 'edge',
    endpoints: {
      'GET /api/home': 'Homepage feed',
      'GET /api/search?q=': 'Search',
      'GET /api/browse': 'Catalog',
      'GET /api/anime/:id': 'Series + episodes',
      'GET /api/stream/:id/:episode?lang=sub|dub': '⭐ Stream embedUrl',
      'GET /api/stream/:id/:episode/bootstrap': 'Raw bootstrap',
      'GET /health': 'Health',
    },
  })
);

app.get('/health', (c) =>
  c.json({ ok: true, upstream: BASE, runtime: 'worker', ts: Date.now() })
);

app.get('/api/home', async (c) => {
  const data = await aniGet('/api/anime/home-feed', {
    content: c.req.query('content') || 3,
  });
  if (c.req.query('raw') === '1') return c.json(data);
  const feed = {};
  for (const [key, section] of Object.entries(data.feed || {})) {
    feed[key] = section?.items
      ? { items: section.items.map(normalizeAnime) }
      : section;
  }
  return c.json({ v: data.v, at: data.at, feed });
});

app.get('/api/new-episodes', async (c) => {
  const data = await aniGet('/api/anime/new-episodes');
  return c.json({
    items: (data.items || []).map((item) => ({
      ...normalizeAnime(item),
      newEpisode: item.newEpisode,
    })),
  });
});

app.get('/api/activity', async (c) => c.json(await aniGet('/api/site/activity')));

app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing q' }, 400);
  const data = await aniGet('/api/anime/search', { q });
  return c.json({
    items: (data.items || []).map(normalizeAnime),
    studios: data.studios,
    genres: data.genres,
    tags: data.tags,
    intent: data.intent,
    didYouMean: data.didYouMean,
  });
});

app.get('/api/browse', async (c) => {
  const params = {
    sort: c.req.query('sort') || 'trending',
    page: c.req.query('page') || 1,
    ...(c.req.query('genre') && { genre: c.req.query('genre') }),
    ...(c.req.query('year') && { year: c.req.query('year') }),
    ...(c.req.query('status') && { status: c.req.query('status') }),
    ...(c.req.query('format') && { format: c.req.query('format') }),
  };
  const data = await aniGet('/api/anime/browse', params);
  return c.json({
    items: (data.items || []).map(normalizeAnime),
    page: data.page,
    lastPage: data.lastPage,
    total: data.total,
    hasNextPage: data.hasNextPage,
  });
});

app.get('/api/catalog', async (c) => {
  const params = {
    sort: c.req.query('sort') || 'trending',
    page: c.req.query('page') || 1,
    ...(c.req.query('genre') && { genre: c.req.query('genre') }),
    ...(c.req.query('year') && { year: c.req.query('year') }),
    ...(c.req.query('status') && { status: c.req.query('status') }),
    ...(c.req.query('format') && { format: c.req.query('format') }),
  };
  const data = await aniGet('/api/anime/catalog', params);
  return c.json({
    items: (data.items || []).map(normalizeAnime),
    page: data.page,
    lastPage: data.lastPage,
    total: data.total,
    hasNextPage: data.hasNextPage,
  });
});

app.get('/api/anime/:id', async (c) => {
  const id = c.req.param('id');
  const params = { routes: 'e4' };
  if (c.req.query('phase')) params.phase = c.req.query('phase');
  const data = await aniGet(`/api/anime/series/${id}`, params);
  const normalized = normalizeAnime(data);
  normalized.episodes = (data.episodes || []).map(normalizeEpisode);
  normalized.relations = data.relations || [];
  normalized.recommendations = data.recommendations || [];
  normalized.nextAiring = data.nextAiring;
  normalized.airing = data.airing;
  normalized.routeId = data.routeId;
  normalized.logo = absUrl(data.logo);
  normalized.heroBackdrop = absUrl(data.heroBackdrop);
  return c.json(normalized);
});

app.get('/api/stream/:id/:episode', async (c) => {
  const result = await getStream(c.req.param('id'), c.req.param('episode'), {
    lang: c.req.query('lang'),
    source: c.req.query('source'),
    routeId: c.req.query('routeId'),
  });
  return c.json(result);
});

app.get('/api/stream/:id/:episode/bootstrap', async (c) => {
  const id = c.req.param('id');
  const episode = Number(c.req.param('episode'));
  const lang = c.req.query('lang') === 'dub' ? 'dub' : 'sub';
  let routeId = c.req.query('routeId');
  let source = c.req.query('source') || 'settlar';
  if (!routeId) {
    const info = await getEpisodeRouteId(id, episode);
    routeId = info.routeId;
    source = info.source;
  }
  const bootstrap = await aniGet(
    `/api/anime/playback-bootstrap/${source}/${id}`,
    { ep: routeId, lang }
  );
  return c.json({
    ...bootstrap,
    routeId,
    source,
    selection: bootstrap.settlarSelection,
  });
});

app.onError((err, c) => {
  const status = err.status || 500;
  return c.json({ error: err.message || 'Internal error', status }, status);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
