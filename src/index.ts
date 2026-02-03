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

async function scrapePhotos(page: Page, childId: string): Promise<PhotoInfo[]> {
  const photosUrl = `${CONFIG.baseUrl}/s/${CONFIG.schoolId}/children/${childId}/photos?locale=en`;

  console.log(`Navigating to photos page for child ${childId}...`);
  await page.goto(photosUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for photos to load
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Scroll to load all photos (lazy loading)
  let previousHeight = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 50;

  while (scrollAttempts < maxScrollAttempts) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    if (currentHeight === previousHeight) {
      // Try scrolling one more time to be sure
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 2000));
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === currentHeight) {
        break;
      }
    }

    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(resolve => setTimeout(resolve, 1500));
    scrollAttempts++;
  }

  console.log(`Finished scrolling after ${scrollAttempts} attempts`);

  // Extract photo information from the page
  const photos = await page.evaluate(() => {
    const photoElements = document.querySelectorAll('img[src*="transparentclassroom.com"]');
    const results: { url: string; caption: string | null }[] = [];

    photoElements.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      // Only include actual photo URLs (from S3 with posts path)
      if (src.includes('/posts/') && src.includes('.large.')) {
        // Try to find a caption nearby
        const parent = img.closest('.photo, .post, [class*="photo"]');
        let caption: string | null = null;
        if (parent) {
          const captionEl = parent.querySelector('.caption, .description, p');
          caption = captionEl?.textContent?.trim() || null;
        }
        results.push({ url: src, caption });
      }
    });

    return results;
  });

  // Process photos to extract hashes and dates
  const processedPhotos: PhotoInfo[] = photos
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

  console.log(`Found ${uniquePhotos.length} unique photos for child ${childId}`);
  return uniquePhotos;
}

async function downloadPhotosForChild(
  page: Page,
  childKey: 'cole' | 'isla',
  state: DownloadState
): Promise<number> {
  const child = CONFIG.children[childKey];
  const childState = state.children[childKey];
  const downloadedSet = new Set(childState.downloadedHashes);

  console.log(`\n=== Processing photos for ${child.name} ===`);
  console.log(`Previously downloaded: ${downloadedSet.size} photos`);

  // Ensure output directory exists
  if (!fs.existsSync(child.outputDir)) {
    fs.mkdirSync(child.outputDir, { recursive: true });
  }

  // Scrape photos from the page
  const photos = await scrapePhotos(page, child.id);

  // Filter to only new photos
  const newPhotos = photos.filter(p => !downloadedSet.has(p.hash));
  console.log(`New photos to download: ${newPhotos.length}`);

  if (newPhotos.length === 0) {
    console.log('No new photos to download');
    return 0;
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

  console.log(`Downloaded ${downloadedCount} photos for ${child.name}`);
  return downloadedCount;
}

interface DownloadSummary {
  childName: string;
  count: number;
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

      for (const childKey of ['cole', 'isla'] as const) {
        const downloaded = await downloadPhotosForChild(downloadPage, childKey, state);
        totalDownloaded += downloaded;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: downloaded,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      console.log(`\n=== Complete ===`);
      console.log(`Total photos downloaded: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

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

      for (const childKey of ['cole', 'isla'] as const) {
        const downloaded = await downloadPhotosForChild(downloadPage, childKey, state);
        totalDownloaded += downloaded;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: downloaded,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      console.log(`\n=== Complete ===`);
      console.log(`Total photos downloaded: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

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

      for (const childKey of ['cole', 'isla'] as const) {
        const downloaded = await downloadPhotosForChild(page, childKey, state);
        totalDownloaded += downloaded;
        downloadSummaries.push({
          childName: CONFIG.children[childKey].name,
          count: downloaded,
        });
      }

      // Update last run time and save state
      state.lastRun = new Date().toISOString();
      saveState(state);

      console.log(`\n=== Complete ===`);
      console.log(`Total photos downloaded: ${totalDownloaded}`);
      console.log(`State saved to: ${CONFIG.stateFilePath}`);

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
