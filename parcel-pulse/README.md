# Parcel Pulse

Ask one question on a map. Share a link. People click parcels to answer, and each
parcel shades by the **share of participants** who picked it.

This is the "strongest + simplest" rebuild of the original 13-step manual — with
the over-engineering removed: no PostGIS, no realtime subscriptions, no accounts,
no analytics dashboard. One question, one map, one growing table (`votes`).

## How it works

- **Create** — type a question, upload a GeoJSON of parcels. You get back two links:
  a public voting link and a private admin link.
- **Vote** — anyone with the public link clicks parcels to toggle their vote.
  A parcel's fill = the percent of voters who chose it ("28 of 40 chose this").
- **Results** — the admin link shows the live tally and exports GeoJSON or CSV.
  Close the map to stop new votes; reopen anytime.

Voter identity is a server-set httpOnly cookie — one vote per parcel per browser.
No login, no captcha, no friction.

## Stack

Next.js 14 (App Router) · Supabase Postgres · React Leaflet + OpenStreetMap ·
Tailwind CSS · deploy on Vercel.

## Setup

1. `npm install`
2. Create a Supabase project. In the SQL editor, run `supabase/schema.sql`.
3. Copy `.env.local.example` to `.env.local` and fill in:
   - `SUPABASE_URL` — your project URL (Project Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` — the service role key. **Server-only — never expose it to the browser.**
4. `npm run dev` and open http://localhost:3000
5. Create a map. Upload `public/sample-parcels.geojson` to try it instantly.

## Deploy

Push to GitHub, import the repo into Vercel, set the two environment variables,
and deploy.

## Data model

```
maps(id, question, parcels jsonb, admin_token, is_open, created_at)
votes(id, map_id, parcel_id, voter_id, created_at)   unique(map_id, parcel_id, voter_id)
```

Parcels are stored as GeoJSON on the map row, so the only table that grows is
`votes`. The "visualization" is just `count(*) group by parcel_id`, done in
`src/lib/votes.ts`.

All database access is server-side via the service role key. RLS is enabled with
no public policies, so the anon/public key cannot touch the tables directly.

## API

| Method | Route | Purpose |
| ------ | ----- | ------- |
| POST | `/api/maps` | Create a map (`{ question, parcels }`). Returns `{ id, admin_token }`. |
| GET | `/api/maps/:id` | Map + live tally + the caller's own votes. |
| POST | `/api/maps/:id/vote` | Toggle a vote (`{ parcel_id }`). Sets the voter cookie. |
| POST | `/api/maps/:id/close?token=` | Open/close the map (`{ is_open }`). Admin only. |
| GET | `/api/maps/:id/export?token=&format=geojson\|csv` | Download results. Admin only. |

## Where to grow (deliberately left out)

- **Huge maps (10k+ parcels):** serve parcels as vector tiles (PMTiles) instead of
  inline GeoJSON, and replace the per-request JS tally with a SQL `group by` view.
- **Live updates across users:** add a Supabase realtime subscription on `votes`
  and refetch the tally on change. (Today, your own votes update instantly; others'
  appear on reload.)
- **Stronger anti-fraud:** the cookie stops casual double-voting. If you ever need
  results you can defend, add rate limiting and/or a verification step.
```
