# Deployment audit — 2026-10-31

## Reported failure

Vercel rejected `api/**/*.js` because no matching API source files existed. The uploaded repository had been flattened: handlers such as `callback.js`, `config.js`, and `[id].js` were at the root, while their imports and `npm run dev` expected `api/`, `lib/`, `server/`, and `public/` directories.

## Repairs

- Restored all seven API entry points and the backend, server, data, and public-asset directories. File contents were matched against the included source archive before moving them.
- Made Vercel's static output (`public`), build command, and Node.js 22 runtime explicit.
- Included the fallback catalog in function bundles while keeping it and backend code out of public static output.
- Restored `.env.example` and strengthened environment-file ignores. No live credentials were added.
- Limited the Drive request's 45-second deadline to receiving response headers; it no longer aborts the audio body after 45 seconds. Client disconnects now cancel upstream streaming. Set the function duration limit to 300 seconds.
- Handled malformed session cookies and token-refresh network failures without unhandled errors.
- Updated service-worker caching so new app code is fetched when online; private API/audio responses remain uncached.
- Fixed mobile track information overlapping the heading and visualizer.
- Added build-integrity checks and 11 automated tests.

## Verification

- `npm ci`: passed; zero third-party runtime dependencies and zero reported vulnerabilities.
- `npm run build`: passed; seven handlers and all public references validated.
- `npm test`: 11/11 passed, including OAuth state validation, encrypted sessions, production catalog authorization, range responses, disconnect cancellation, refresh failures, local server isolation, and offline app-shell behavior.
- Vercel CLI 65.4.0's configuration validator and official static/Node builders: passed locally; all seven functions compiled for Node.js 22 with the server-only catalog included. Static output contained 11 public files.
- Chromium: nine catalog rows rendered, search and the connection dialog worked, no browser console/runtime errors, and layouts passed at 320, 390, 768, and 1440 pixels.

## Deployment status and remaining checks

The repair is delivered on `arena/0ec2a638-webplayerr` in [pull request #1](https://github.com/BLGofficial/webplayerr/pull/1), targeting `main`. The existing Vercel Git integration successfully deployed the repair commit (`ef5484d`) as a preview; GitHub reports `Vercel – webplayerr: Deployment has completed`.

Preview: https://webplayerr-git-arena-0ec2-2fefc8-trajannthegreat-1646s-projects.vercel.app

The Vercel app connector is not connected to this session, so no manual production promotion was performed and `main` remains unchanged. The authenticated Vercel CLI could not reach Vercel from the sandbox; verification used the official builders locally and the successful Git-triggered deployment reported by GitHub. The preview URL itself was not accessed from the sandbox.

Merge the PR to trigger the normal production deployment. Then verify the production environment variables and exact Google OAuth callback URL, sign in, and test real Drive playback and seeking. Live Google/Supabase requests were not tested with production credentials. See `README.md` for the deployment settings and checklist.
