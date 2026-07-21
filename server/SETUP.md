# Backend setup

The Claude Split backend is a small Node/Express API backed by Postgres. The
default path uses [Neon](https://neon.tech)'s free tier, but any Postgres 14+
works (local, Docker, RDS, Supabase, …).

## 1. Get a database

1. Sign up at https://neon.tech (free tier is plenty — this stores numbers,
   not content).
2. Create a project (any region close to you), e.g. `claude-split`.
3. Copy the **connection string** from the dashboard. It looks like:
   `postgres://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`

## 2. Configure

```bash
cd server
cp .env.example .env
# edit .env: paste your DATABASE_URL, leave the rest as defaults for now
```

## 3. Install, migrate, run

```bash
npm install          # from the repo root (installs all workspaces)
cd server
npm run migrate      # applies SQL migrations to your database
npm run build
npm start            # listens on PORT (default 8080)
```

Migrations also run automatically at startup, so `npm start` alone is enough
after the first setup.

Check it's alive:

```bash
curl http://localhost:8080/healthz
# {"ok":true}
```

## 4. Create your account

From the extension popup (Settings → Account) — or by hand:

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a long password"}'
```

The returned `token` is what the extension and CLI agent use as
`Authorization: Bearer <token>`.

## 5. CORS for the extension

After installing the extension, copy its ID (from `chrome://extensions` with
Developer mode on, or `about:debugging` in Firefox) into `.env`:

```
CORS_ORIGINS=chrome-extension://abcdefghijklmnop,moz-extension://<uuid>
```

Restart the server afterwards. Requests from the extension's background
worker and popup carry that origin.

## 6. Production: HTTPS

Run the API behind a TLS-terminating reverse proxy — the extension will
refuse to talk to plain HTTP on a public network, and you should too.
Any of these work:

- **Caddy** (easiest): `caddy reverse-proxy --from api.example.com --to localhost:8080`
- **nginx + certbot**: standard `proxy_pass http://127.0.0.1:8080;` block
- A PaaS that gives you TLS for free (Railway, Render, Fly.io)

The server sets `trust proxy`, so client IPs for rate limiting come from
`X-Forwarded-For` — only expose it behind a proxy you control.

## Environment reference

| Var              | Default      | Meaning                                                  |
| ---------------- | ------------ | -------------------------------------------------------- |
| `DATABASE_URL`   | — (required) | Postgres connection string                               |
| `PORT`           | `8080`       | Listen port                                              |
| `CORS_ORIGINS`   | empty        | Comma-separated allowed origins                          |
| `TOKEN_TTL_DAYS` | `30`         | Sliding token lifetime                                   |
| `RETENTION_DAYS` | `90`         | Default event retention (per-user override via settings) |

## Operational notes

- **Backups:** the data is low-value by design (attribution estimates); Neon
  keeps point-in-time restore on paid tiers, but losing this DB only loses
  history, never access to Claude.
- **Deleting an account:** `DELETE /api/v1/me` with the user's token wipes
  user, sessions, devices, events, settings via cascading deletes.
- **Retention:** a daily job prunes `usage_events` older than each user's
  `retentionDays`.
