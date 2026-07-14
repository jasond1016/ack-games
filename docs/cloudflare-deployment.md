# Cloudflare Pages + R2 deployment

The static game is deployed to Pages. Versioned full-resolution and preview GLBs are deployed to an R2 Standard bucket. Car-list thumbnails remain small immutable WebP files on Pages.

## One-time Cloudflare setup

1. Create an R2 Standard bucket, for example `ack-games-models`.
2. Connect a custom domain such as `assets.example.com` to the bucket. Do not use the rate-limited `r2.dev` URL for production.
3. Create a Cache Rule for `assets.example.com/cars/*`: cache eligible content, Edge TTL one year. Enable Smart Tiered Cache.
4. Copy `cloudflare/r2-cors.example.json`, replace `game.example.com`, and apply it:

   ```powershell
   pnpm exec wrangler r2 bucket cors set ack-games-models --file cloudflare/r2-cors.json
   ```

5. Create a Pages project, for example `ack-games`, and connect `game.example.com`.

Keep `r2-cors.json` out of source control if it contains private development origins. The example contains no credentials.

## Build assets

Generate WebP thumbnails when cars change. Start the local server in one terminal, then run:

```powershell
pnpm run serve
pnpm run assets:thumbnails
```

Optimize full race models and 35% geometry preview LODs:

```powershell
pnpm run assets:optimize
```

The optimized directories are reproducible build artifacts and are gitignored. Original GLBs remain untouched.

Build the split deployment. `MODEL_ASSET_BASE_URL` is the R2 custom-domain root because generated object keys already start with `cars/`:

```powershell
$env:MODEL_ASSET_BASE_URL = "https://assets.example.com/"
pnpm run assets:build
```

This produces:

- `_deploy/pages`: fail-closed Pages runtime files plus the free-drive environment assets; only the small free-drive scene GLBs are allowed, never racing-car GLBs or repository internals.
- `_deploy/r2/cars`: content-hashed full and preview GLBs.
- `_deploy/r2-manifest.json`: object keys, sizes, and checksums.

The build writes to a staging directory and only replaces the previous output
after asset-graph, file-size, hash, and target checks pass. Car thumbnails are
also emitted with content-hashed filenames and immutable cache headers.

## Deploy

Authenticate Wrangler with only the scopes required by this deployment. Wrangler
4.110.0 exposes R2 operations through `workers:write`; it does not expose a
separate `r2:write` OAuth scope:

```powershell
pnpm exec wrangler login --scopes account:read user:read workers:write pages:write
pnpm exec wrangler whoami
pnpm exec wrangler r2 bucket list
```

The permissions are used as follows:

- `account:read`: select the Cloudflare account.
- `user:read`: identify the user and account memberships.
- `workers:write`: manage R2 buckets, CORS, and objects.
- `pages:write`: deploy the Pages project.

Wrangler adds `offline_access` internally so it can refresh the login. It is not
another Cloudflare product permission. The other default Wrangler scopes are not
needed here. The R2 custom domain and cache rule are configured in the dashboard,
so this CLI flow does not need `zone:read`.

`r2 bucket list` must succeed. A `403 Authentication error` combined with a
`whoami` permission list containing only `pages:write`, `account:read`, and
`user:read` means the old OAuth token has not been refreshed with
`workers:write`. No
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, or `CF_*` environment variable
should override the OAuth login unless it intentionally has Workers R2 Storage
Read and Edit permission.

Then deploy:

```powershell
$env:R2_BUCKET = "ack-games-models"
pnpm run deploy:r2
pnpm exec wrangler pages deploy _deploy/pages --project-name ack-games
```

Upload R2 before Pages. The Pages build references content-hashed object names, so old cached assets remain valid and deployments are atomic from the browser's perspective. Periodically delete unreferenced old object hashes after confirming no live Pages deployment uses them.
Existing R2 keys are downloaded and hash-checked before upload: matching
immutable objects are skipped, while a same-key content mismatch stops the
deployment plan instead of overwriting the object.

## Runtime behavior

- The selection list downloads only lazy WebP thumbnails.
- The interactive selected-car display uses a reduced preview GLB.
- Starting a race loads only the full player and opponent GLBs.
- The finish cinematic reuses the selected full model URL through browser/CDN cache.
- Failed model requests retain the existing procedural-car fallback.

Before making the bucket public, confirm every third-party car model permits public redistribution.
