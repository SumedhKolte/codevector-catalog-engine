# Deployment guide

Decoupled deploy: **Frontend → Vercel**, **Backend → Render**, **Database → Supabase**.

```
[ Vercel (React/Vite SPA) ]  ──HTTPS──▶  [ Render (Fastify API) ]  ──TLS──▶  [ Supabase (Postgres) ]
                                              ▲
                                   GitHub Actions cron pings /health every 10 min
```

---

## 1. Database — Supabase

1. Create a free Supabase project.
2. **Project Settings → Database → Connection string → URI.** Copy it. Use the
   **direct** connection (port 5432) for seeding; the **pooler** (port 6543) is
   fine for the API.
3. Apply the schema and seed (from your machine):
   ```bash
   cd backend
   cp .env.example .env        # paste your DATABASE_URL, keep PGSSL=true
   npm install
   npm run migrate
   npm run seed
   ```
   (Or paste `backend/scripts/schema.sql` into the Supabase SQL editor.)

---

## 2. Backend — Render

The repo includes [`render.yaml`](./render.yaml), so you can use a **Blueprint**:

- **New → Blueprint** in the Render dashboard → connect this GitHub repo → it
  reads `render.yaml` and creates the `product-catalog-api` Web Service
  (rootDir `backend`, build `npm install`, start `npm start`, health check `/health`).
- **Set the secret env vars** in **Render → your service → Environment**:
  - `DATABASE_URL` → your Supabase URI
  - `CORS_ORIGIN` → your Vercel URL (set after step 3, e.g. `https://your-app.vercel.app`)
  - `PGSSL`, `NODE_ENV`, `LOG_LEVEL`, `RATE_LIMIT_*` come from the Blueprint defaults.
  - **Do not set `PORT`** — Render injects it; the app reads `process.env.PORT`.

> Prefer clicking through manually? New → Web Service → root directory `backend`,
> build `npm install`, start `npm start`, and add the same env vars.

Your API will be live at `https://product-catalog-api.onrender.com` (note the URL).

---

## 3. Frontend — Vercel

- **Add New → Project** → import this GitHub repo.
- **Root Directory:** `frontend`
- Framework preset: **Vite** (Build `npm run build`, Output `dist` — auto-detected).
- **Environment Variables → add** `VITE_API_URL = https://product-catalog-api.onrender.com`
  (your Render URL, no trailing slash). Then **Deploy**.
- [`frontend/vercel.json`](./frontend/vercel.json) rewrites all paths to
  `index.html` so refreshing a client-side route doesn't 404.

After this, go back to Render and set `CORS_ORIGIN` to the Vercel URL, then
redeploy the backend.

---

## 4. Keep-alive (avoid Render cold starts)

Render free Web Services sleep after ~15 min idle (~60s cold start).
[`.github/workflows/keep-alive.yml`](./.github/workflows/keep-alive.yml) pings
`/health` every 10 minutes.

- In GitHub: **Settings → Secrets and variables → Actions → Variables → New**
  → name `RENDER_EXTERNAL_URL`, value `https://product-catalog-api.onrender.com`.
- You can trigger it manually from the **Actions** tab (`workflow_dispatch`).

---

## Checklist

- [ ] Supabase project created, schema applied, data seeded
- [ ] Render service deployed with `DATABASE_URL` + `CORS_ORIGIN` set
- [ ] `GET https://<render-url>/health` returns `{"status":"alive"}`
- [ ] Vercel project deployed with `VITE_API_URL` set to the Render URL
- [ ] `CORS_ORIGIN` on Render updated to the Vercel URL
- [ ] GitHub Actions variable `RENDER_EXTERNAL_URL` set
