# Pokésearch

A mobile-first Pokémon GO search page for Robert Gherman's GitHub Pages site. Plain HTML, CSS and JavaScript; no npm dependencies or build step. The existing Python monitor in the parent directory is separate and is not published.

## Features

- Pokémon and specific form/costume selection; include/exclude modes.
- Type a name or Pokédex number for suggestions on every keystroke. Add several Pokémon or forms to a removable list; suggestions use the downloaded catalogue and make no API requests. Keyboard arrows/Enter and touch selection are supported.
- Save named Pokémon lists as browser presets, then load, update or delete them. Presets retain species/forms and include/exclude mode while leaving other search filters unchanged. Up to 50 presets with 60-character names are supported. They stay on the current browser/device; clearing browser storage removes them.
- Shiny and background flags, location text or coordinates/radius, IV percentage/raw IV, CP, level, PvP, size, weather, form, gender, minimum time left, trainer ID and sorting.
- Every item in the API's `results` array is shown in one list. No ten-item pagination, extra pages, automatic searches, polling, or hidden retries. Provider account caps still apply; the UI cannot return results the provider omitted.
- **Find** reveals coordinates and immediately attempts to copy them. Revealed coordinates are reused when copying again; clipboard failures show selectable coordinates. Reveals run one at a time. A provider 429 pauses every unrevealed result for the supplied cooldown, including results from a new search, with no automatic retries. Previously revealed coordinates can still be copied.
- Guest searches may work while guest reveals are blocked, especially through a shared serverless connection. Connection settings can verify your own provider token before using it. Tokens stay in memory for the current tab and are never built into assets, persisted, logged, or read from the monitor's private files. Changing connections clears old encounters and cancels pending requests so a fresh search uses the current account.

## Local development

Use Node.js 22 or newer:

```sh
npm run dev
```

Open http://127.0.0.1:4173 in standalone Chromium. The local server serves only [site](./site/) and the API bridge; parent monitor credentials are never served. Search requests reach the real provider only when you click Search. Find consumes a provider reveal request. On localhost, the page defaults to its local bridge; the published site defaults to the deployed Cloudflare Worker. A URL saved in connection settings overrides either default.

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

The bridge allows only `POST search`, `GET reveal/<code>`, authenticated `GET account` (a sanitized check of the provider's `/users/me` route), and its own `GET health`. Account verification returns only whether the token was accepted and the free/VIP tier; profile and trainer data are discarded. The bridge never accepts arbitrary upstream URLs, refreshes authentication, changes account tiers, or retries calls. Authentication and provider limits remain enforced upstream. A serverless bridge shares provider-visible outbound IPs, so anonymous rate limits may be shared among visitors.

## Resolving provider reveal limits

HTTP 429 from the provider is separate from Cloudflare's free hosting quota. A guest may receive it on their first reveal through Cloudflare even when searches succeed. A diagnostic on 16 November 2026 returned coordinates through a direct connection from the development computer, while one search/reveal through the deployed Cloudflare Worker returned 429 with `retry_after: 179`. This isolates the observed failure to the Cloudflare request path, but does not establish how the provider counts or groups IPs. Repeating requests or waiting one cooldown did not establish reliable guest access through that path.

The original provider UI offers account login after a guest reveal limit. To use your own account here:

1. Sign in at https://pogocoordinates.com/search.
2. On desktop Chromium, open DevTools → Application → Local storage → `https://pogocoordinates.com` and copy your own `jwt` value. Never share it in chat or commit it.
3. Open this page's connection settings, retain your own bridge URL, paste the token, and save. The bridge verifies it without returning private profile data. Search again to obtain fresh encounters. Provider account limits still apply; successful account verification does not guarantee reveal availability.

Tokens are cleared on reload/closing the tab. A login on the provider's domain does not transfer automatically to GitHub Pages; this project is not registered as a provider OAuth application. The mobile alternative is to sign in and reveal directly on the provider's website, linked from the limit notice.

For personal use from a computer, the existing local server is also a direct connection option: run `npm run dev` and open http://127.0.0.1:4173. The local page defaults to `http://127.0.0.1:4173/api/bridge`; if you previously saved a different connection URL, update it in settings. It uses that computer's connection and still respects the provider's guest/account limits. It only listens on loopback and is available while running; this is not an always-on public backend. No IP rotation, forwarding-header spoofing, or shared credentials are implemented. Reliable public access may require provider-approved API access or a backend you control with suitable provider limits.

## Manual standalone Chromium checks

1. Test 320, 360, 375, 390, 430, 768 and 1280 CSS pixel widths, plus landscape and 200% zoom. Verify there is no horizontal page scroll, clipped control or overlapping result text. Inputs use at least 16px fonts to avoid mobile focus zoom.
2. Select Pokémon by name and ID, a species form, exclusions and several sizes; reopen the pickers and verify selection. Reset, switch IV/Stats/PvP/Area/Coordinates modes, and confirm hidden filters do not block submission.
3. Search zero, one and more than ten returned encounters; verify every returned encounter appears. A response with `total_matches: 0` and nonempty `results` must still display results.
4. Find an active encounter and paste into another app. Deny clipboard permission and verify the selectable coordinate fallback. Copy again and verify it reuses the already-revealed coordinates. Check expiry, provider 429 and authentication failures.
5. Disable the network during search; an error must appear without reporting zero matches or discarding previous results. Reset during a pending search; a late response must not replace the results.

Public Pokémon and form catalog snapshots are from the provider. Pokémon species thumbnails load from PokeAPI's public sprite collection (including shiny variants), with a Pokédex-number fallback on failure. Pokémon GO and Pokémon are trademarks of their respective owners; this project is unaffiliated.
