# XYP3RN Music Webapp

A private, mobile-first music PWA for the nine tracks in the XYP3RN Drive library. The gold orb clip is the idle/loading identity; the supplied violet orb reference becomes the active visualizer. The active orb breathes with the Web Audio analyser while a track is playing and returns to the gold XYP3RN orb when paused, stopped, or ended.

## Included

- Responsive listening room with search, WAV/MP3 filtering, queue, favorites, seek, volume, pause, stop, previous, and next.
- PWA manifest and offline app-shell cache. Audio files are not cached offline.
- Supabase catalog route reading `public.audio_assets` with a server-only service role key; a local catalog keeps the UI browsable before setup.
- Google OAuth read-only Drive connection and a same-origin range-forwarding stream endpoint. Drive files remain private.
- Unbounded variable font under its SIL Open Font License.
- Brand colors from the supplied palette PDF: `#080808`, `#0D0D0D`, `#111111`, `#FACD68`, `#C9A03E`, `#F0B942`, `#E8E8E8`, `#888888`.

## Run locally

Requires Node.js 20 or newer. No npm packages are required.

1. Copy `.env.example` to `.env`.
2. Generate a session encryption secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and place it in `APP_SESSION_SECRET`.
3. In Google Cloud Console, enable the Google Drive API and create an OAuth client of type **Web application**. Add `http://localhost:3000/api/auth/callback` as an authorized redirect URI. Put its client ID and client secret in `.env`.
4. Add the Supabase project URL and **service role** key to `.env`. Keep the service role key server-side; never add it to `public/` or browser JavaScript. This app reads `public.audio_assets` and does not change its RLS policies.
5. Start the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`, connect the Google account that owns the XYP3RN Audio Library, then play a track.

Google OAuth asks for Drive read-only access. Use an OAuth consent screen configured for your account during development. A public multi-user release may require Google verification for this scope.

## Environment variables

| Variable | Use |
|---|---|
| `APP_BASE_URL` | Public app origin; used for OAuth redirect construction and secure cookies |
| `APP_SESSION_SECRET` | Encrypts Google tokens in an HttpOnly, Secure-in-production cookie |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Server-only Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | Must exactly match the Google Cloud Console redirect URI |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only catalog read key |
| `SUPABASE_AUDIO_TABLE` | Defaults to `audio_assets` |
| `PORT` | Local server port; defaults to `3000` |

## Deploy

The project includes Vercel function entry points under `api/` and static assets under `public/`. Add the environment variables above to the deployment. Set `APP_BASE_URL` and `GOOGLE_REDIRECT_URI` to the deployed HTTPS origin, then add the same callback URL to the Google OAuth client. Keep the function region close to the Drive and Supabase services. For sustained public streaming, use an object-storage/CDN delivery layer; this implementation is designed for a private personal library.

## Data and access model

- Supabase is the catalog source of truth when the server credentials are configured.
- The table has RLS enabled and no browser-facing read policy. The API reads it server-side.
- Google Drive stores the audio bytes. The browser requests a same-origin stream route; the server forwards the user's Google OAuth token to Drive and forwards range headers for seeking.
- Titles are file-name stems. Artist and album were not embedded in the supplied audio files, so those values remain empty.
- In local development, a server-side fallback catalog keeps the interface browsable before Supabase setup. It is not served as a public static file.
