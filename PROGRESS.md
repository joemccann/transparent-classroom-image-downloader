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
- [x] **Improve scrolling**: ~~Currently loads ~30 photos per page~~ → Fixed with pagination (b27af06)
- [ ] **Session persistence**: Session occasionally expires between runs, requiring re-authentication
- [x] **Email notifications**: Gmail App Password configured and working
- [x] **Historical backfill**: ~~Run multiple times~~ → Pagination now downloads all photos automatically

### Known Issues
1. ~~Only 30 photos loaded per child on initial page load~~ → Fixed with pagination
2. Session may expire, requiring `npm run login` to re-authenticate

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

### Test Results
- **Cole**: 205 new photos downloaded (984 total in library)
- **Isla**: 170 new photos downloaded (635 total in library)
- **Total this run**: 375 full-size photos

### File Size Comparison
| Version | File Size | Example Files |
|---------|-----------|---------------|
| Old thumbnails | 11-14 KB | `2024_*.jpg` |
| New originals | 2.5-2.9 MB | `2025_*.jpg` |

**~200x increase** in file size confirms full-size originals are now being downloaded.

### TODOs
- [x] Refactor to download full-size images
- [x] Test with `--login` flag to verify larger file downloads
- [x] Compare file sizes between old and new downloads

### Commits
- `0c269c7` - refactor: download full-size original images instead of thumbnails
- `6865d3f` - chore: bump version to 1.0.1
- `5d6afd3` - docs: update progress with test results and file size comparison

### Automation Status
- ✅ launchd service installed at `~/Library/LaunchAgents/com.joemccann.tc-downloader.plist`
- ✅ Service loaded and active
- ✅ Scheduled to run daily at **8:00 AM**
- Will send email notification if session expires

---

## Session: 2026-02-03 (Update 3)

### Summary
Added year-based folder organization for downloaded photos and cleaned up old thumbnails.

### Changes Made

#### Year Subdirectory Organization (`src/index.ts:428-432`)
- Photos now save to year-based subdirectories: `Photos/Cole/2025/`, `Photos/Isla/2024/`, etc.
- Year extracted from existing `photo.date` field (already used in filename prefix)
- Creates directory automatically if it doesn't exist

```typescript
// New code
const yearDir = path.join(child.outputDir, year);
if (!fs.existsSync(yearDir)) {
  fs.mkdirSync(yearDir, { recursive: true });
}
const destPath = path.join(yearDir, filename);
```

#### Existing Photo Migration
- Organized 1,622 existing photos into year folders via bash script
- Deleted 711 old thumbnail images (<50KB) from before full-size refactor
- Removed empty year directories

### Final Photo Library

**Cole** (206 full-size photos)
- 2025: 195 photos
- 2026: 11 photos

**Isla** (179 full-size photos)
- 2024: 2 photos
- 2025: 150 photos
- 2026: 27 photos

### Commits
- `00288ef` - feat: organize downloaded photos into year subdirectories
- `c475fe9` - chore: bump version to 1.0.2
