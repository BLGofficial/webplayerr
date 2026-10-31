# XYP3RN Music Webapp

A private, mobile-first music PWA for the nine tracks in the XYP3RN Drive library. The gold orb is the idle/loading identity; the supplied violet orb animation plays as a looping motion-graphics layer during playback, with audio-reactive scale, glow, and speed.

## Project layout

The directory structure is required for both local development and Vercel:

```text
api/                  Vercel Node function entry points
  auth/               Google OAuth, session status, logout
  drive/[id].js       Authenticated, range-aware Drive streaming
  config.js           Non-secret runtime configuration
  tracks.js           Private catalog
lib/api.mjs           Shared API implementation
server/index.mjs      Local static + API server
public/               Only the browser-facing files; Vercel output directory
  assets/             Images, video, font, and font license
data/                 Server-only fallback catalog (bundled with functions)
scripts/              Deployment integrity checks
tests/                Node test suite
```

Do not flatten these directories or move `data/` into `public/`. The checked-in source ZIP is an archival copy, not the deployment source.

## Run locally

Requires Node.js 22, matching the pinned Vercel runtime. No third-party runtime packages are required.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`.
3. Generate a session encryption secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and set `APP_SESSION_SECRET`.
4. In Google Cloud Console, enable the Google Drive API and create an OAuth client of type **Web application**. Add `http://localhost:3000/api/auth/callback` as an authorized redirect URI. Set the client ID and secret in `.env`.
5. Set the Supabase project URL and **service role** key. Keep the service role key server-side; never put it in `public/` or browser JavaScript. The app reads `public.audio_assets`; it does not change RLS policies.
6. Start the app with `npm run dev`, then open `http://localhost:3000`.
7. Connect the Google account with access to the XYP3RN Audio Library and play a track.

Google OAuth requests read-only Drive access. Configure the OAuth consent screen for your account during development; a public multi-user release may require Google verification.

## Checks

```bash
npm ci
npm test
npm run build
```

The build is intentionally a validation step, not a frontend bundler: it checks all seven API entry points, public asset references, the private catalog location, and the Vercel output configuration. Vercel serves the existing `public/` files and compiles `api/` using its Node runtime.

## Environment variables

| Variable | Use |
|---|---|
| `APP_BASE_URL` | Canonical public app origin; use the deployed HTTPS origin in production |
| `APP_SESSION_SECRET` | At least 32 characters; encrypts Google tokens in an HttpOnly cookie |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Server-only Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | Exact authorized callback URL: `https://YOUR_DOMAIN/api/auth/callback` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only catalog read key |
| `SUPABASE_AUDIO_TABLE` | Defaults to `audio_assets` |
| `PORT` | Local server port; defaults to `3000` |

## Deploy to Vercel

1. Import `BLGofficial/webplayerr` and select the branch containing this repair (or merge it into the production branch).
2. Use **Root Directory `./`**, **Framework Preset: Other**, **Build Command: `npm run build`**, and **Output Directory: `public`**. The repository's `vercel.json` declares these settings; remove conflicting dashboard overrides if necessary.
3. Add the environment variables above in Vercel. Set `APP_BASE_URL` and `GOOGLE_REDIRECT_URI` for the actual production domain, and add that callback URL to the Google OAuth client.
4. Deploy. Vercel must discover seven functions under `api/`; an `unused_function` error for `api/**/*.js` means the uploaded source still has a flattened or incorrect root directory.
5. Check `/`, `/api/config`, and `/api/auth/status`, then complete Google sign-in and test playback and seeking.

The configuration pins Node.js 22, bundles the server-only fallback catalog, and allows up to 300 seconds for media transfers. It also prevents the service worker and unversioned app shell from being cached indefinitely. Runtime credentials are not needed to compile the static frontend, but Google and Supabase must be configured for live catalog/playback.

No Google or Supabase credentials are embedded in the repair. The connected Vercel Git integration deploys branch previews automatically; merging pull request #1 into `main` triggers the normal production deployment. See `AUDIT.md` for the verified preview and remaining live-credential checks.

## Violet motion graphic

The active violet orb uses the supplied `IMG_6576.gif` animation, transcoded to a four-second, 800×600, 25 fps loop:

- `public/assets/active-orb.webm` — VP9, preferred by supporting browsers (~0.47 MB).
- `public/assets/active-orb.mp4` — H.264 fallback (~1.43 MB).
- `public/assets/active-orb-poster.jpg` — first-frame poster and error/offline fallback (~0.08 MB).

The original 14 MB GIF is not shipped. The videos are muted, inline, and loop only while music is playing; the Web Audio analyser adds subtle scale, glow, brightness, saturation, and playback-rate modulation. Pausing returns to the gold idle loop, stopping resets the violet loop, and hidden tabs, reduced-motion preferences, or video failure pause/replace the decorative motion. The service worker caches the poster but leaves video range requests to the browser.

## Data and access model

- Supabase is the catalog source of truth when configured. Production catalog access requires a Drive session.
- The table has RLS enabled and no browser-facing read policy; the API reads it server-side.
- Drive stores the audio bytes. The server forwards the connected user's OAuth token and range headers. Drive permissions still apply, and audio is not cached by the service worker.
- The server-only seed catalog keeps local development usable before Supabase setup. It is not a public static file.
- This is a private personal-library implementation, not a public audio CDN. For sustained public streaming, use object storage/CDN delivery.
- The Unbounded variable font is included under the SIL Open Font License in `public/assets/fonts/OFL.txt`.
