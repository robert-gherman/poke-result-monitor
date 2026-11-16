# Pokésearch

A mobile-first Pokémon GO search page for Robert Gherman's GitHub Pages site. Plain HTML, CSS and JavaScript; no npm dependencies or build step. The existing Python monitor in the parent directory is separate and is not published.

## Features

- Pokémon and specific form/costume selection; include/exclude modes.
- Type a name or Pokédex number for suggestions on every keystroke. Add several Pokémon or forms to a removable list; suggestions use the downloaded catalogue and make no API requests. Keyboard arrows/Enter and touch selection are supported.
- Save named Pokémon lists as browser presets, then load, update or delete them. Presets retain species/forms and include/exclude mode while leaving other search filters unchanged. Up to 50 presets with 60-character names are supported. They stay on the current browser/device; clearing browser storage removes them.
- Shiny and background flags, location text or coordinates/radius, IV percentage/raw IV, CP, level, PvP, size, weather, form, gender, minimum time left, trainer ID and sorting.
- Every item in the API's `results` array is shown in one list. No ten-item pagination, extra pages, automatic searches, polling, or hidden retries. Provider account caps still apply; the UI cannot return results the provider omitted.
- **Find** reveals coordinates and immediately attempts to copy them. Revealed coordinates are reused when copying again; clipboard failures show selectable coordinates. Expired encounters and reveal limits have explicit states.
- Tokens are optional (anonymous provider access is supported), stay in memory for the current tab, and are never built into assets, persisted, logged, or read from the monitor's private files.

## Local development

Use Node.js 22 or newer:

```sh
npm run dev
```

Open http://127.0.0.1:4173 in standalone Chromium. The local server serves only [site](./site/) and the API bridge; parent monitor credentials are never served. Search requests reach the real provider only when you click Search. Find consumes a provider reveal request. The public configuration uses the deployed Cloudflare Worker; to test the local bridge, set the connection URL to `http://127.0.0.1:4173/api/bridge`.

```sh
npm test
npm run check
```

## Free hosting

The provider rejects the GitHub Pages origin in its CORS policy. GitHub Pages serves static files and cannot execute the required API bridge. Host the page on GitHub Pages and deploy the small bridge on **one** of these free services. Hosting limits and provider account limits continue to apply.

### GitHub Pages

This repository is public under the personal `robert-gherman` account and uses free GitHub Pages at https://robert-gherman.github.io/poke-result-monitor/. Only static website assets are published; the API bridge must be deployed separately as described below.

The live site is connected to https://poke-result-monitor.gherman-robert01.workers.dev. Cloudflare's GitHub integration redeploys the Worker when `main` changes. Frontend changes still need the `gh-pages` publication below.

Push this directory as the repository root. Publish just [site](./site/) to a `gh-pages` branch and select that branch, path `/`, in Settings → Pages. All asset paths are relative, so both a root site and `/poke-result-monitor/` work. Do not copy the parent monitor's private files into this repository.

After changes, republish the static files:

```sh
git add site
git commit -m "Update search page"
git push origin main
git subtree push --prefix=site origin gh-pages
```

### Vercel

1. Import this repository into your Vercel account, use the **Other** framework preset, and leave the build command empty. [vercel.json](./vercel.json) selects the static output and API function.
2. Deploy. The same Vercel URL hosts a working preview and the bridge at `https://YOUR-PROJECT.vercel.app/api/bridge`.
3. Set `apiEndpoint` in [site/config.js](./site/config.js) to that bridge URL and republish the static files using the commands above. Alternatively, save that URL in the page's connection settings for your device.
4. The bridge permits `https://robert-gherman.github.io` by default. For a custom domain, set the Vercel environment variable `ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins and redeploy.

No shared provider token is required or supported in server configuration. If needed, enter your own provider token in the page's optional connection field. Use only a server you control; a supplied token is sent to that server.

### Cloudflare Workers alternative

Deploy [server/worker.mjs](./server/worker.mjs) using [wrangler.toml](./wrangler.toml), then set `apiEndpoint` to the resulting Worker URL. Update `ALLOWED_ORIGINS` for custom domains. No Cloudflare package is needed at runtime.

The ongoing [Workers Free plan](https://developers.cloudflare.com/workers/platform/pricing/) currently permits 100,000 requests per account/day, resetting at midnight UTC, with 10 ms of CPU time per invocation. Network waiting does not count as CPU time. Requests fail when the free daily quota is exhausted; paid usage requires a paid plan. Searches, reveals and CORS preflights count toward Worker usage. Typing suggestions and saving/loading presets run locally and do not call the Worker. Provider result/reveal limits apply separately.

The bridge allows only `POST search`, `GET reveal/<code>`, and its own `GET health`; it never accepts arbitrary upstream URLs, refreshes authentication, changes account tiers, or retries calls. Authentication and provider limits remain enforced upstream. A serverless bridge shares provider-visible outbound IPs, so anonymous rate limits may be shared among visitors.

## Manual standalone Chromium checks

1. Test 320, 360, 375, 390, 430, 768 and 1280 CSS pixel widths, plus landscape and 200% zoom. Verify there is no horizontal page scroll, clipped control or overlapping result text. Inputs use at least 16px fonts to avoid mobile focus zoom.
2. Select Pokémon by name and ID, a species form, exclusions and several sizes; reopen the pickers and verify selection. Reset, switch IV/Stats/PvP/Area/Coordinates modes, and confirm hidden filters do not block submission.
3. Search zero, one and more than ten returned encounters; verify every returned encounter appears. A response with `total_matches: 0` and nonempty `results` must still display results.
4. Find an active encounter and paste into another app. Deny clipboard permission and verify the selectable coordinate fallback. Copy again and verify it reuses the already-revealed coordinates. Check expiry, provider 429 and authentication failures.
5. Disable the network during search; an error must appear without reporting zero matches or discarding previous results. Reset during a pending search; a late response must not replace the results.

Public Pokémon and form catalog snapshots are from the provider. Pokémon species thumbnails load from PokeAPI's public sprite collection (including shiny variants), with a Pokédex-number fallback on failure. Pokémon GO and Pokémon are trademarks of their respective owners; this project is unaffiliated.
