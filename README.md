# ani.pm Scraper Worker

Edge-deployable scraper API for [ani.pm](https://ani.pm).

Same features as the Express version (`ani-pm-scraper-api`), but built with **Hono** so it runs on:

- **Cloudflare Workers**
- Vercel Edge
- Other fetch-compatible runtimes

Includes **streaming embed resolution** (`/api/stream/:id/:episode`).

## Deploy to Cloudflare Workers

```bash
git clone https://github.com/DavidCyril1/ani-pm-scraper-worker.git
cd ani-pm-scraper-worker
npm install
npx wrangler login   # once
npm run deploy
```

Local dev:

```bash
npm run dev
# → http://localhost:8787
```

## Streaming

```bash
curl "https://<your-worker>.workers.dev/api/stream/1642/1?lang=sub"
```

Returns:

```json
{
  "id": 1642,
  "episode": 1,
  "lang": "sub",
  "embedUrl": "https://embed.settlar.io/embed/v1?t=...",
  "expiresAt": 1795014592,
  "expiresInSeconds": 3600,
  "provider": "anipm",
  "skip": { "op": {...}, "ed": {...}, "dur": 1477.98 },
  "routeId": "e1...."
}
```

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Overview |
| `GET /health` | Health |
| `GET /api/home` | Homepage feed |
| `GET /api/new-episodes` | New episodes |
| `GET /api/activity` | Live stats |
| `GET /api/search?q=` | Search |
| `GET /api/browse` / `/api/catalog` | Catalog |
| `GET /api/anime/:id` | Series + episodes |
| `GET /api/stream/:id/:episode` | **Stream embed** |
| `GET /api/stream/:id/:episode/bootstrap` | Raw bootstrap |

## How streaming works

1. Series → episode `routeId`
2. `playback-bootstrap` → `settlarSelection`
3. `settlar/session` → `embedUrl` + `expiresAt`

## Companion repo

Node/Express long-running version: **[ani-pm-scraper-api](https://github.com/DavidCyril1/ani-pm-scraper-api)**

## Disclaimer

Educational / personal use. Respect ani.pm ToS and content rights. Cloudflare may challenge heavy automated traffic.

## License

MIT
