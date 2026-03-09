# Task Plan

## Objective

Scope Puppeteer/Chrome to this app so browser resolution and installs do not depend on the global `~/.cache/puppeteer` state.

## Success Criteria

- Browser cache/install path is project-local.
- Runtime launch resolves Chrome from the app's scoped configuration.
- Setup and usage docs/scripts reflect the new browser install flow.
- Verification proves the app builds and the local browser path is recognized.

## Dependency Graph

- T1 -> T2
- T1 -> T3
- T2 -> T4
- T3 -> T4
- T8 -> T9
- T9 -> T10

## Tasks

- [x] `T1` Investigate current Puppeteer browser resolution and choose a project-scoped cache/install strategy
  - depends_on: []
- [x] `T2` Implement project-scoped Puppeteer configuration and runtime/browser-launch changes
  - depends_on: [`T1`]
- [x] `T3` Update repo scripts/docs so Chrome installation is local to this app
  - depends_on: [`T1`]
- [x] `T4` Verify build/browser setup and record review notes
  - depends_on: [`T2`, `T3`]
- [x] `T8` Inspect download and success-email flow for embedding fetched images
  - depends_on: []
- [x] `T9` Implement embedded success-email images via a separate worker
  - depends_on: [`T8`]
- [x] `T10` Review implementation, verify behavior, and update docs/review notes
  - depends_on: [`T9`]

## Review

- Root cause: Puppeteer was resolving Chrome from the default global cache at `~/.cache/puppeteer`; this app only scoped the profile directory, not the browser cache/install path.
- Implemented: repo-local Puppeteer cache config in `.puppeteerrc.cjs`, runtime `PUPPETEER_CACHE_DIR` initialization in `src/index.ts`, local browser install scripts in `package.json`, docs update in `README.md`, and `.cache/` ignore rule.
- Implemented: success emails now receive downloaded file metadata from `src/index.ts` and embed inline previews in `src/email.ts`, bounded to 4 images and 12 MB total.
- Verification:
  - `npm run build` succeeded.
  - `node - <<'NODE' ... require('puppeteer').default.configuration.cacheDirectory ... NODE` resolved `/Users/joemccann/dev/apps/home/transparent-classroom-image-downloader/.cache/puppeteer`.
  - `npm run browser:install` installed `chrome@127.0.6533.88` into the repo-local cache.
  - Headless smoke launch succeeded with `launch ok`.
  - `npm run build` succeeded again after the email preview changes.
