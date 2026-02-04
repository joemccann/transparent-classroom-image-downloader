import 'dotenv/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import notifier from 'node-notifier';
import { initializeEmail, sendSuccessEmail, sendAuthErrorEmail, sendErrorEmail } from './email';

// Configuration
const CONFIG = {
  schoolId: '2521',
  children: {
    cole: { id: '322263', name: 'Cole', outputDir: '/Users/joemccann/Downloads/Photos/Cole' },
    isla: { id: '598458', name: 'Isla', outputDir: '/Users/joemccann/Downloads/Photos/Isla' },
  },
  baseUrl: 'https://www.transparentclassroom.com',
  stateFilePath: path.join(__dirname, '..', 'state', 'download-state.json'),
  puppeteerDataDir: path.join(__dirname, '..', 'puppeteer-data'),
};

interface ChildState {
  childId: string;
  downloadedHashes: string[];
  lastDownloadedAt: string | null;
}

interface DownloadState {
  lastRun: string | null;
  children: {
    cole: ChildState;
    isla: ChildState;
  };
}

interface PhotoInfo {
  url: string;
  hash: string;
  date: string | null;
  caption: string | null;
}

interface ScrapeResult {
  photos: PhotoInfo[];
  expectedTotal: number;
  scrapedTotal: number;
  isComplete: boolean;
}

function loadState(): DownloadState {
  try {
    const data = fs.readFileSync(CONFIG.stateFilePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      lastRun: null,
      children: {
        cole: { childId: CONFIG.children.cole.id, downloadedHashes: [], lastDownloadedAt: null },
        isla: { childId: CONFIG.children.isla.id, downloadedHashes: [], lastDownloadedAt: null },
      },
    };
  }
}

function saveState(state: DownloadState): void {
  const dir = path.dirname(CONFIG.stateFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG.stateFilePath, JSON.stringify(state, null, 2));
}

function sendNotification(title: string, message: string): void {
  notifier.notify({
    title,
    message,
    sound: true,
    wait: false,
  });
}

function extractHashFromUrl(url: string): string | null {
  // Extract hash from URLs like:
  // https://s3.amazonaws.com/transparentclassroom.com/schools/2521/2026/posts/c14c56c0e9a0560e66693c260f4afb63af4d9b3da03413b653cf05740a6fb28d.large.jpeg
  const match = url.match(/\/posts\/([a-f0-9]{64})\./);
  return match ? match[1] : null;
}

function extractDateFromUrl(url: string): string | null {
  // Extract year from URL path like /schools/2521/2026/posts/
  const match = url.match(/\/schools\/\d+\/(\d{4})\/posts\//);
  return match ? match[1] : null;
}

function sanitizeFilename(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          https.get(redirectUrl, (redirectResponse) => {
            redirectResponse.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }).on('error', reject);
        } else {
          reject(new Error('Redirect without location header'));
        }
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function checkAuthentication(page: Page): Promise<boolean> {
  await page.goto(`${CONFIG.baseUrl}/souls/sign_in`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait a moment for any redirects
  await new Promise(resolve => setTimeout(resolve, 2000));

  const currentUrl = page.url();

  // If we're still on the sign_in page, we're not authenticated
  if (currentUrl.includes('/sign_in')) {
    return false;
  }

  // If we were redirected to dashboard or another page, we're authenticated
  return true;
}

async function performInteractiveLogin(browser: Browser): Promise<boolean> {
  console.log('\n=== Interactive Login Required ===');
  console.log('A browser window will open. Please sign in to Transparent Classroom.');
  console.log('After signing in, the browser will close automatically.');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto(`${CONFIG.baseUrl}/souls/sign_in`, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for the user to complete login (check every 2 seconds)
  let attempts = 0;
  const maxAttempts = 150; // 5 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const currentUrl = page.url();

    if (!currentUrl.includes('/sign_in')) {
      console.log('Login successful!');
      await page.close();
      return true;
    }

    attempts++;
    if (attempts % 15 === 0) {
      console.log('Still waiting for login...');
    }
  }

  console.log('Login timed out after 5 minutes');
  await page.close();
  return false;
}

async function getPageMetadata(page: Page): Promise<{ totalPhotos: number; maxPage: number }> {
  return await page.evaluate(() => {
    // Get total photo count from .page_info element (e.g., "465 Photos")
    const pageInfo = document.querySelector('.page_info');
    const totalMatch = pageInfo?.textContent?.match(/(\d+)\s*Photos?/i);
    const totalPhotos = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    // Get max page number from pagination
    const paginationLinks = document.querySelectorAll('.pagination a, .pagination-container a');
    let maxPage = 1;
    paginationLinks.forEach(link => {
      const pageNum = parseInt(link.textContent || '0', 10);
      if (!isNaN(pageNum) && pageNum > maxPage) {
        maxPage = pageNum;
      }
    });

    return { totalPhotos, maxPage };
  });
}

async function scrapePhotosFromCurrentPage(page: Page): Promise<{ url: string; caption: string | null }[]> {
  // Wait for images to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  return await page.evaluate(() => {
    const results: { url: string; caption: string | null }[] = [];
    const seen = new Set<string>();

    // Primary approach: get anchor tags with data-original attribute (full-size images)
    const photoAnchors = document.querySelectorAll('.post.photo a.thumbnail[data-original], .post.photo a.fancybox[data-original]');

    photoAnchors.forEach((anchor) => {
      const a = anchor as HTMLAnchorElement;
      // Prefer data-original (full size), fallback to href (large), fallback to img src (thumbnail)
      const originalUrl = a.getAttribute('data-original') || a.href || '';

      if (originalUrl && originalUrl.includes('/posts/') && !seen.has(originalUrl)) {
        seen.add(originalUrl);

        // Get caption from sibling hidden div
        const parent = a.closest('.post.photo');
        let caption: string | null = null;
        if (parent) {
          const captionEl = parent.querySelector('.PostBody__content div, .caption, .description');
          caption = captionEl?.textContent?.trim() || null;
        }

        results.push({ url: originalUrl, caption });
      }
    });

    // Fallback: if no anchors found, try original img-based approach for backwards compatibility
    if (results.length === 0) {
      const selectors = [
        'img[src*="transparentclassroom.com"]',
        'img[src*="s3.amazonaws.com"]',
        'img[data-src*="transparentclassroom.com"]',
        'img[data-src*="s3.amazonaws.com"]',
        '.photo img',
        '.post img',
      ];

      for (const selector of selectors) {
        const photoElements = document.querySelectorAll(selector);
        photoElements.forEach((img) => {
          const src = (img as HTMLImageElement).src || img.getAttribute('data-src') || '';
          if (src && !seen.has(src) && src.includes('/posts/')) {
            seen.add(src);
            const parent = img.closest('.photo, .post, [class*="photo"]');
            let caption: string | null = null;
            if (parent) {
              const captionEl = parent.querySelector('.caption, .description, p');
              caption = captionEl?.textContent?.trim() || null;
            }
            results.push({ url: src, caption });
          }
        });
      }
    }

    return results;
  });
}

async function scrapePhotos(page: Page, childId: string, childName: string): Promise<ScrapeResult> {
  const basePhotosUrl = `${CONFIG.baseUrl}/s/${CONFIG.schoolId}/children/${childId}/photos?locale=en`;

  console.log(`\nNavigating to photos page for ${childName} (${childId})...`);
  await page.goto(basePhotosUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for page to fully load
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Check if redirected to login
  const currentUrl = page.url();
  if (currentUrl.includes('/sign_in') || currentUrl.includes('/login')) {
    console.log('ERROR: Redirected to login page - session may have expired');
    return { photos: [], expectedTotal: 0, scrapedTotal: 0, isComplete: false };
  }

  // Get metadata (total photos and max page)
  const { totalPhotos, maxPage } = await getPageMetadata(page);
  console.log(`Expected total: ${totalPhotos} photos across ${maxPage} pages`);

  if (totalPhotos === 0) {
    console.log('WARNING: Could not determine total photo count from page');
  }

  // Collect photos from all pages
  const allPhotos: { url: string; caption: string | null }[] = [];
  const seenUrls = new Set<string>();

  for (let pageNum = 1; pageNum <= maxPage; pageNum++) {
    if (pageNum > 1) {
      // Navigate to next page
      const pageUrl = `${basePhotosUrl}&page=${pageNum}`;
      console.log(`  Scraping page ${pageNum}/${maxPage}...`);
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } else {
      console.log(`  Scraping page ${pageNum}/${maxPage}...`);
    }

    // Scrape photos from current page
    const pagePhotos = await scrapePhotosFromCurrentPage(page);

    // Add unique photos
    for (const photo of pagePhotos) {
      if (!seenUrls.has(photo.url)) {
        seenUrls.add(photo.url);
        allPhotos.push(photo);
      }
    }

    console.log(`    Found ${pagePhotos.length} photos on page ${pageNum} (${allPhotos.length} total so far)`);

    // Small delay between pages to be nice to the server
    if (pageNum < maxPage) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\nFinished scraping all ${maxPage} pages`);
  console.log(`Total photos scraped: ${allPhotos.length}`);

  // Process photos to extract hashes and dates
  const processedPhotos: PhotoInfo[] = allPhotos
    .map(photo => {
      const hash = extractHashFromUrl(photo.url);
      const date = extractDateFromUrl(photo.url);
      if (hash) {
        return {
          url: photo.url,
          hash,
          date,
          caption: photo.caption,
        };
      }
      return null;
    })
    .filter((p): p is PhotoInfo => p !== null);

  // Remove duplicates by hash
  const uniquePhotos = Array.from(
    new Map(processedPhotos.map(p => [p.hash, p])).values()
  );

  const scrapedTotal = uniquePhotos.length;
  const isComplete = totalPhotos === 0 || scrapedTotal >= totalPhotos;

  // Validation check
  if (totalPhotos > 0 && scrapedTotal < totalPhotos) {
    const missing = totalPhotos - scrapedTotal;
    const pct = ((scrapedTotal / totalPhotos) * 100).toFixed(1);
    console.log(`\n⚠️  WARNING: Photo count mismatch for ${childName}!`);
    console.log(`   Expected: ${totalPhotos}, Scraped: ${scrapedTotal} (${pct}%)`);
    console.log(`   Missing: ${missing} photos`);
  } else if (totalPhotos > 0) {
    console.log(`✅ Validation passed: All ${totalPhotos} photos scraped for ${childName}`);
  }

  return {
    photos: uniquePhotos,
    expectedTotal: totalPhotos,
    scrapedTotal,
    isComplete,
  };
}

interface DownloadResult {
  downloaded: number;
  expectedTotal: number;
  scrapedTotal: number;
  isComplete: boolean;
}

async function downloadPhotosForChild(
  page: Page,
  childKey: 'cole' | 'isla',
  state: DownloadState
): Promise<DownloadResult> {
  const child = CONFIG.children[childKey];
  const childState = state.children[childKey];
  const downloadedSet = new Set(childState.downloadedHashes);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Processing photos for ${child.name}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Previously downloaded: ${downloadedSet.size} photos`);

  // Ensure output directory exists
  if (!fs.existsSync(child.outputDir)) {
    fs.mkdirSync(child.outputDir, { recursive: true });
  }

  // Scrape photos from all pages
  const scrapeResult = await scrapePhotos(page, child.id, child.name);

  // Filter to only new photos
  const newPhotos = scrapeResult.photos.filter(p => !downloadedSet.has(p.hash));
  console.log(`\nNew photos to download: ${newPhotos.length}`);

  if (newPhotos.length === 0) {
    console.log('No new photos to download');
    return {
      downloaded: 0,
      expectedTotal: scrapeResult.expectedTotal,
      scrapedTotal: scrapeResult.scrapedTotal,
      isComplete: scrapeResult.isComplete,
    };
  }

  let downloadedCount = 0;

  for (const photo of newPhotos) {
    try {
      // Generate filename: {year}_{hash_prefix}_{caption}.jpg
      const year = photo.date || 'unknown';
      const hashPrefix = photo.hash.substring(0, 8);
      const caption = photo.caption ? sanitizeFilename(photo.caption) : '';
      const filename = caption
        ? `${year}_${hashPrefix}_${caption}.jpg`
        : `${year}_${hashPrefix}.jpg`;

      const destPath = path.join(child.outputDir, filename);

      // Skip if file already exists (shouldn't happen but safety check)
      if (fs.existsSync(destPath)) {
        console.log(`File already exists: ${filename}`);
        childState.downloadedHashes.push(photo.hash);
        continue;
      }

      console.log(`Downloading: ${filename}`);
      await downloadFile(photo.url, destPath);

      // Update state
      childState.downloadedHashes.push(photo.hash);
      downloadedCount++;

      // Small delay between downloads to be nice to the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to download photo ${photo.hash}:`, error);
    }
  }

  // Update last downloaded timestamp
  if (downloadedCount > 0) {
    childState.lastDownloadedAt = new Date().toISOString();
  }

  console.log(`\nDownloaded ${downloadedCount} new photos for ${child.name}`);
  console.log(`Total in library: ${childState.downloadedHashes.length} photos`);

  return {
    downloaded: downloadedCount,
    expectedTotal: scrapeResult.expectedTotal,
    scrapedTotal: scrapeResult.scrapedTotal,
    isComplete: scrapeResult.isComplete,
  };
}

interface DownloadSummary {
  childName: string;
  count: number;
  expectedTotal: number;
  scrapedTotal: number;
  isComplete: boolean;
}

async function main(): Promise<void> {
  console.log('=== Transparent Classroom Photo Downloader ===');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Check for --login flag
  const forceLogin = process.argv.includes('--login');

  let browser: Browser | null = null;
  const downloadSummaries: DownloadSummary[] = [];

  // Initialize email notifications
  const emailEnabled = initializeEmail();

  try {
    // Load state
    const state = loadState();
    console.log(`Last run: ${state.lastRun || 'Never'}`);

    // Ensure puppeteer data directory exists
    if (!fs.existsSync(CONFIG.puppeteerDataDir)) {
      fs.mkdirSync(CONFIG.puppeteerDataDir, { recursive: true });
    }

    // Launch browser with persistent profile
    console.log('\nLaunching browser...');

    // If force login, go directly to headful mode
    if (forceLogin) {
      browser = await puppeteer.launch({
        headless: false,
        userDataDir: CONFIG.puppeteerDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });

      const loginSuccess = await performInteractiveLogin(browser);

      if (!loginSuccess) {
        console.log('Login failed or timed out');
        sendNotification(
          'TC Photo Downloader',
          'Login failed. Please try again with --login flag.'
        );
        await sendAuthErrorEmail();
        await browser.close();
        process.exit(1);
      }

      // Verify we're now authenticated
      const verifyPage = await browser.newPage();
      const isAuthenticated = await checkAuthentication(verifyPage);
      await verifyPage.close();

      if (!isAuthenticated) {
        console.log('Authentication verification failed after login');
        sendNotification(
          'TC Photo Downloader',
          'Authentication verification failed. Please try again.'
        );
        await sendAuthErrorEmail();
        await browser.close();
        process.exit(1);
      }

      // Re-open page for downloads
      const downloadPage = await browser.newPage();
      await downloadPage.setViewport({ width: 1920, height: 1080 });

      console.log('Authentication verified');

      // Download photos for each child
      let totalDownloaded = 0;
      let hasValidationWarnings = false;

      for (const childKey of ['cole', 'isla'] as const) {
        const result = await downloadPhotosForChild(downloadPage, childKey, state);
        totalDownloaded += result.downloaded;
        if (!result.isComplete) hasValidationWarnings = true;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: result.downloaded,
          expectedTotal: result.expectedTotal,
          scrapedTotal: result.scrapedTotal,
          isComplete: result.isComplete,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      // Print final summary
      console.log(`\n${'='.repeat(50)}`);
      console.log('FINAL SUMMARY');
      console.log(`${'='.repeat(50)}`);
      for (const summary of downloadSummaries) {
        const status = summary.isComplete ? '✅' : '⚠️';
        console.log(`${status} ${summary.childName}: ${summary.scrapedTotal}/${summary.expectedTotal} photos scraped, ${summary.count} new downloaded`);
      }
      console.log(`\nTotal photos downloaded this run: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

      if (hasValidationWarnings) {
        console.log('\n⚠️  Some children have incomplete photo counts. Check logs above for details.');
      }

      if (totalDownloaded > 0) {
        sendNotification(
          'TC Photo Downloader',
          `Downloaded ${totalDownloaded} new photo${totalDownloaded === 1 ? '' : 's'}`
        );
      }
      await sendSuccessEmail(downloadSummaries);

      return;
    }

    // Normal headless mode
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: CONFIG.puppeteerDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Check authentication
    console.log('\nChecking authentication...');
    let isAuthenticated = await checkAuthentication(page);

    if (!isAuthenticated) {
      console.log('Not authenticated. Launching interactive login...');

      // Close headless browser and relaunch in headful mode
      await browser.close();

      browser = await puppeteer.launch({
        headless: false,
        userDataDir: CONFIG.puppeteerDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
        ],
      });

      const loginSuccess = await performInteractiveLogin(browser);

      if (!loginSuccess) {
        console.log('Login failed or timed out');
        sendNotification(
          'TC Photo Downloader',
          'Login failed. Please try again with --login flag.'
        );
        await sendAuthErrorEmail();
        await browser.close();
        process.exit(1);
      }

      // Verify we're now authenticated
      const verifyPage = await browser.newPage();
      isAuthenticated = await checkAuthentication(verifyPage);
      await verifyPage.close();

      if (!isAuthenticated) {
        console.log('Authentication verification failed after login');
        sendNotification(
          'TC Photo Downloader',
          'Authentication verification failed. Please try again.'
        );
        await sendAuthErrorEmail();
        await browser.close();
        process.exit(1);
      }

      // Re-open page for downloads
      const downloadPage = await browser.newPage();
      await downloadPage.setViewport({ width: 1920, height: 1080 });

      console.log('Authentication verified');

      // Download photos for each child
      let totalDownloaded = 0;
      let hasValidationWarnings = false;

      for (const childKey of ['cole', 'isla'] as const) {
        const result = await downloadPhotosForChild(downloadPage, childKey, state);
        totalDownloaded += result.downloaded;
        if (!result.isComplete) hasValidationWarnings = true;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: result.downloaded,
          expectedTotal: result.expectedTotal,
          scrapedTotal: result.scrapedTotal,
          isComplete: result.isComplete,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      // Print final summary
      console.log(`\n${'='.repeat(50)}`);
      console.log('FINAL SUMMARY');
      console.log(`${'='.repeat(50)}`);
      for (const summary of downloadSummaries) {
        const status = summary.isComplete ? '✅' : '⚠️';
        console.log(`${status} ${summary.childName}: ${summary.scrapedTotal}/${summary.expectedTotal} photos scraped, ${summary.count} new downloaded`);
      }
      console.log(`\nTotal photos downloaded this run: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

      if (hasValidationWarnings) {
        console.log('\n⚠️  Some children have incomplete photo counts. Check logs above for details.');
      }

      if (totalDownloaded > 0) {
        sendNotification(
          'TC Photo Downloader',
          `Downloaded ${totalDownloaded} new photo${totalDownloaded === 1 ? '' : 's'}`
        );
      }
      await sendSuccessEmail(downloadSummaries);
    } else {
      console.log('Authentication verified');

      // Download photos for each child
      let totalDownloaded = 0;
      let hasValidationWarnings = false;

      for (const childKey of ['cole', 'isla'] as const) {
        const result = await downloadPhotosForChild(page, childKey, state);
        totalDownloaded += result.downloaded;
        if (!result.isComplete) hasValidationWarnings = true;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: result.downloaded,
          expectedTotal: result.expectedTotal,
          scrapedTotal: result.scrapedTotal,
          isComplete: result.isComplete,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      // Print final summary
      console.log(`\n${'='.repeat(50)}`);
      console.log('FINAL SUMMARY');
      console.log(`${'='.repeat(50)}`);
      for (const summary of downloadSummaries) {
        const status = summary.isComplete ? '✅' : '⚠️';
        console.log(`${status} ${summary.childName}: ${summary.scrapedTotal}/${summary.expectedTotal} photos scraped, ${summary.count} new downloaded`);
      }
      console.log(`\nTotal photos downloaded this run: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

      if (hasValidationWarnings) {
        console.log('\n⚠️  Some children have incomplete photo counts. Check logs above for details.');
      }

      if (totalDownloaded > 0) {
        sendNotification(
          'TC Photo Downloader',
          `Downloaded ${totalDownloaded} new photo${totalDownloaded === 1 ? '' : 's'}`
        );
      }
      await sendSuccessEmail(downloadSummaries);
    }

  } catch (error) {
    console.error('Error during execution:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    sendNotification(
      'TC Photo Downloader - Error',
      `Download failed: ${errorMessage}`
    );
    await sendErrorEmail(errorMessage);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
