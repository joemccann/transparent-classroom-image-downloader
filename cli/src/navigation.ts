import type { Page } from 'puppeteer';

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000;
export const DEFAULT_READY_TIMEOUT_MS = 20_000;

export interface NavigateToPageOptions {
  readySelectors?: string[];
  readyUrlIncludes?: string[];
  readyUrlExcludes?: string[];
  navigationTimeoutMs?: number;
  readyTimeoutMs?: number;
  postReadyDelayMs?: number;
}

export async function navigateToPage(
  page: Page,
  url: string,
  options: NavigateToPageOptions = {},
): Promise<void> {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
  });

  await waitForPageReadiness(page, options);
}

export async function waitForPageReadiness(
  page: Page,
  options: NavigateToPageOptions = {},
): Promise<void> {
  const readySelectors = options.readySelectors ?? [];
  const readyUrlIncludes = options.readyUrlIncludes ?? [];
  const readyUrlExcludes = options.readyUrlExcludes ?? [];
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const hasSignals =
    readySelectors.length > 0 ||
    readyUrlIncludes.length > 0 ||
    readyUrlExcludes.length > 0;

  if (hasSignals) {
    await page.waitForFunction(
      ({ selectors, urlIncludes, urlExcludes }) => {
        const currentUrl = window.location.href;

        if (urlIncludes.some((fragment) => currentUrl.includes(fragment))) {
          return true;
        }

        if (urlExcludes.length > 0 && urlExcludes.every((fragment) => !currentUrl.includes(fragment))) {
          return true;
        }

        return selectors.some((selector) => Boolean(document.querySelector(selector)));
      },
      { timeout: readyTimeoutMs },
      {
        selectors: readySelectors,
        urlIncludes: readyUrlIncludes,
        urlExcludes: readyUrlExcludes,
      },
    );
  } else {
    await page.waitForFunction(
      () => document.readyState === 'interactive' || document.readyState === 'complete',
      { timeout: readyTimeoutMs },
    );
  }

  if (options.postReadyDelayMs && options.postReadyDelayMs > 0) {
    await delay(options.postReadyDelayMs);
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
