# Progress

## Session: 2026-02-03

### Summary
Implemented the Transparent Classroom Photo Downloader - an automated tool that downloads photos of Cole and Isla from Transparent Classroom daily at 8AM.

### Changes Made

#### Core Implementation
- **`src/index.ts`** - Main downloader script with:
  - Puppeteer browser automation for authentication
  - Interactive login flow (opens browser for manual sign-in)
  - Photo scraping with multiple CSS selectors
  - S3 photo URL detection and downloading
  - State management to track downloaded photos (avoids duplicates)
  - macOS notifications for errors/success
  - Debug logging for troubleshooting

#### Configuration Files
- **`com.joemccann.tc-downloader.plist`** - launchd configuration for 8AM daily scheduling
- **`package.json`** - Added `login` script for interactive authentication
- **`tsconfig.json`** - TypeScript configuration with DOM lib support

#### Directory Structure
```
├── src/index.ts           # Main downloader
├── state/download-state.json  # Tracks downloaded photo hashes
├── puppeteer-data/        # Browser session persistence
├── logs/                  # stdout/stderr for launchd
└── com.joemccann.tc-downloader.plist
```

### Test Results
- Successfully authenticated via interactive login
- Downloaded 30 photos for Cole to `/Users/joemccann/Downloads/Photos/Cole`
- Downloaded 30 photos for Isla to `/Users/joemccann/Downloads/Photos/Isla`
- Total: 60 photos downloaded and verified

### Commands
```bash
npm run login    # Interactive login (opens browser)
npm start        # Run downloader (headless)
launchctl start com.joemccann.tc-downloader  # Trigger manually
```

### TODOs
- [ ] **Improve scrolling**: Currently loads ~30 photos per page. Need to enhance infinite scroll handling to load all historical photos
- [ ] **Session persistence**: Session occasionally expires between runs, requiring re-authentication
- [ ] **Email notifications**: Gmail credentials in `.env` need to be configured with App Password
- [ ] **Historical backfill**: Run multiple times or add pagination to download all ~995 photos for Cole

### Known Issues
1. Only 30 photos loaded per child on initial page load (lazy loading limitation)
2. Session may expire, requiring `npm run login` to re-authenticate
3. Email notification fails due to Gmail authentication (optional feature)

### Commits
- `095d7ee` - fix: improve photo scraping with multiple selectors and debug output
- `b3c3041` - feat: add email notifications for photo downloads and errors
- `f09af0d` - first commit

---

## Session: 2026-02-03 (Update 2)

### Summary
Refactored image downloader to fetch full-size original images instead of thumbnails.

### Changes Made

#### Image URL Extraction Refactor (`src/index.ts:205-265`)
- **Problem**: Was downloading `medium_square.jpeg` thumbnails (~KB) instead of `original.jpeg` full-size images (~MB)
- **Solution**: Modified `scrapePhotosFromCurrentPage` to:
  1. Select `.post.photo a.thumbnail[data-original]` anchor elements (instead of `img` elements)
  2. Extract `data-original` attribute which contains full-size `.original.jpeg` URLs
  3. Fall back to `href` (large) if `data-original` unavailable
  4. Fall back to original img-based approach if no anchors found (backwards compatibility)

#### HTML Structure Reference
```html
<div class="post photo Post">
  <a class="thumbnail fancybox" data-original="...original.jpeg">  <!-- ← Now using this -->
    <img src="...medium_square.jpeg">                              <!-- ← Was using this -->
  </a>
</div>
```

### Verification
- TypeScript build passes (`npm run build`)
- Fallback logic preserves backwards compatibility
- Hash extraction regex works with `.original.jpeg` URLs

### TODOs
- [x] Refactor to download full-size images
- [ ] Test with `--login` flag to verify larger file downloads
- [ ] Compare file sizes between old and new downloads
