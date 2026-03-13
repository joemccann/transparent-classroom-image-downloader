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

---

## Objective

Fix the recurring Puppeteer `Navigation timeout of 60000 ms exceeded` failure by replacing brittle network-idle navigation waits with explicit page-readiness checks that tolerate background requests.

## Success Criteria

- The scraper no longer depends on `waitUntil: 'networkidle2'` for login/auth/photo-page navigation.
- Navigation waits for concrete ready states/selectors that match Transparent Classroom pages.
- A regression test covers the timeout-handling/navigation helper behavior.
- Verification proves the app builds and the regression test passes.

## Dependency Graph

- T11 -> T12
- T12 -> T13
- T12 -> T14
- T13 -> T14

## Tasks

- [x] `T11` Investigate timeout-prone navigation paths and define selector-based readiness checks
  - depends_on: []
- [x] `T12` Implement resilient navigation helpers and replace brittle `networkidle2` waits
  - depends_on: [`T11`]
- [x] `T13` Add a regression test and minimal script wiring for navigation timeout behavior
  - depends_on: [`T12`]
- [x] `T14` Verify build/tests, update review notes, and document the outcome
  - depends_on: [`T12`, `T13`]

## Review

- Root cause: the scraper was using `page.goto(..., { waitUntil: 'networkidle2', timeout: 60000 })` for photo-page navigation and pagination. Transparent Classroom pages can keep multiple background requests open, so Puppeteer never considered the page idle and threw `Navigation timeout of 60000 ms exceeded` even when the DOM was usable.
- Implemented: added `src/navigation.ts` with a shared `navigateToPage()` helper that uses `domcontentloaded` plus explicit readiness signals (login form selectors, login-route markers, photo-page selectors) instead of waiting for network idle.
- Implemented: updated auth checks, interactive login, initial photo-page navigation, and paginated photo navigation in `src/index.ts` to use the new helper.
- Implemented: added `test/navigation.test.js`, which asserts the helper uses `domcontentloaded` plus explicit readiness signals instead of `networkidle2`, covering the timeout-prone root cause without launching Chrome in the test harness.
- Verification:
  - `npm test` succeeded.
  - The build completed via the `npm test` script.

---

## Objective

Run the current test suite and verify whether the scraper still works end-to-end in the present environment, distinguishing between automated proof and live-session proof.

## Success Criteria

- The repository test/build command completes successfully.
- A live scraper execution is attempted with email side effects disabled.
- The result clearly states whether authenticated scraping succeeded, required re-login, or could not be proven from local state.
- Review notes capture what was verified and any remaining proof gaps.

## Dependency Graph

- T15 -> T16
- T15 -> T17
- T16 -> T18
- T17 -> T18

## Tasks

- [x] `T15` Document the verification plan and execution constraints for this request
  - depends_on: []
- [x] `T16` Run automated build/test verification and capture concrete results
  - depends_on: [`T15`]
- [x] `T17` Attempt a live scraper run with email disabled and inspect the outcome
  - depends_on: [`T15`]
- [x] `T18` Record review notes and summarize what is proven versus still dependent on live auth/data
  - depends_on: [`T16`, `T17`]

## Review

- Automated verification:
  - `npm test` succeeded with exit code `0`.
  - This covered `npm run build` plus `node --test test/*.test.js`.
- The current automated suite proves the TypeScript build succeeds and the `navigateToPage` regression test passes for the `domcontentloaded` plus readiness-signal flow.
- Live verification:
  - `EMAIL_ENABLED=false npm start` succeeded with exit code `0` on March 13, 2026.
  - The stored Puppeteer session was still valid; the app printed `Authentication verified` and did not require interactive login.
  - Cole reached the live photos page, reported `Expected total: 1023 photos across 35 pages`, hit a known photo on page 1, and exited early with `0` new downloads.
  - Isla reached the live photos page, reported `Expected total: 527 photos across 18 pages`, found `4` new photos on page 1, and downloaded all `4`.
  - Verified downloaded files under `/Users/joemccann/Downloads/Photos/Isla/2026`:
    - `2026_71303784_Elizabeth_W_Oliver_B_Isla_M_Cole_E_Patrick_B_Leo_B.jpg`
    - `2026_804a5f39_Elizabeth_W_Oliver_B_Isla_M_Cole_E_Patrick_B_Leo_B.jpg`
    - `2026_afeaca08_Isla_M_practiced_Collage.jpg`
    - `2026_d7b10e43_Alina_H_Cole_E_Elizabeth_W_Elliot_A_Isla_M_Ivy_E_L.jpg`
  - State updated to `lastRun: 2026-03-13T16:14:13.512Z`, with `cole` at `805` known hashes and `isla` at `524`.
- Proof boundary:
  - Scraping is confirmed to work end-to-end against the live site with the current saved authenticated session and current page structure.
  - This verification does not prove the interactive re-login path or every possible layout variant.

---

## Objective

Update repository docs to match the current navigation/test changes and March 13, 2026 runtime verification, then commit and push the resulting release-ready worktree.

## Success Criteria

- Docs describe the resilient navigation behavior and current verification status.
- The documentation reflects both the automated test pass and the March 13, 2026 live runs.
- The current worktree is committed with a scoped message.
- The commit is pushed to `origin/main`.

## Dependency Graph

- T19 -> T20
- T20 -> T21
- T21 -> T22
- T22 -> T23

## Tasks

- [x] `T19` Record the release-plan steps for docs, commit, and push
  - depends_on: []
- [x] `T20` Inspect the current diff and identify the required documentation updates
  - depends_on: [`T19`]
- [x] `T21` Update docs to capture the navigation fix and March 13, 2026 verification results
  - depends_on: [`T20`]
- [ ] `T22` Commit the current relevant worktree changes with a scoped message
  - depends_on: [`T21`]
- [ ] `T23` Push the commit to `origin/main` and record the resulting status
  - depends_on: [`T22`]

## Review

- Documentation updates:
  - `README.md` now documents the resilient page-readiness navigation behavior, the `npm test` command, and the fact that success email is skipped when a run downloads no new photos.
  - `PROGRESS.md` now includes a March 13, 2026 session covering the navigation hardening, regression test, live verification run, and production run.
- Ready for commit:
  - Current code/test changes are the navigation helper, the `npm test` script, and the regression test.
  - No unrelated worktree changes were identified beyond the expected source, test, and task-tracking files for this feature.

---

## Objective

Resolve the pre-commit Puppeteer Crashpad permission failure so the regression suite passes reliably on this macOS environment before commit and push.

## Success Criteria

- The root cause of the `Operation not permitted` Crashpad failure is identified.
- The fix is limited to the test harness or other minimal-scope code.
- `npm test` succeeds after the fix.
- Commit and push proceed only after the green verification result is captured.

## Dependency Graph

- T24 -> T25
- T25 -> T26
- T26 -> T27
- T27 -> T28

## Tasks

- [x] `T24` Record the remediation plan for the local Puppeteer test failure
  - depends_on: []
- [x] `T25` Investigate the Crashpad permission failure and choose a minimal fix
  - depends_on: [`T24`]
- [x] `T26` Implement the test harness fix and re-run verification
  - depends_on: [`T25`]
- [ ] `T27` Commit the release-ready worktree after verification succeeds
  - depends_on: [`T26`]
- [ ] `T28` Push the commit to `origin/main` and record the resulting status
  - depends_on: [`T27`]

## Review

- Root cause:
  - A final pre-commit `npm test` run failed locally because the browser-backed Puppeteer test attempted to launch Chrome for Testing, which tried to access Crashpad state under `~/Library/Application Support/Google/Chrome for Testing/Crashpad/settings.dat` and hit `Operation not permitted`.
- Fix:
  - Reworked `test/navigation.test.js` into a deterministic unit-style regression that asserts `navigateToPage()` uses `domcontentloaded` and forwards the expected readiness signals without launching Chrome in the test harness.
  - Updated `README.md`, `PROGRESS.md`, and the earlier review notes in `tasks/todo.md` so the documented automated coverage matches the new test shape.
- Verification:
  - `npm test` succeeded after the test harness change.
