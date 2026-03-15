mod selectors;

use std::collections::HashSet;

use scraper::{Html, Selector};
use tracing::{debug, info};

use crate::core::errors::{AppError, AppResult};
use crate::core::http::TcHttpClient;
use crate::core::models::Photo;

pub use selectors::*;

/// Page metadata extracted from the photos listing page.
#[derive(Debug)]
struct PageMetadata {
    total_photos: u32,
    max_page: u32,
}

/// Extract total photo count and max page from a photos listing page.
fn parse_page_metadata(html: &Html) -> PageMetadata {
    let page_info_sel = Selector::parse(PAGE_INFO_SELECTOR).unwrap();
    let pagination_sel = Selector::parse(PAGINATION_LINK_SELECTOR).unwrap();

    // Extract total photo count from ".page_info" text like "465 Photos"
    let total_photos = html
        .select(&page_info_sel)
        .next()
        .and_then(|el| {
            let text = el.text().collect::<String>();
            let re = regex_lite::Regex::new(r"(\d+)\s*Photos?").ok()?;
            re.captures(&text)?
                .get(1)?
                .as_str()
                .parse::<u32>()
                .ok()
        })
        .unwrap_or(0);

    // Extract max page from pagination links
    let max_page = html
        .select(&pagination_sel)
        .filter_map(|el| {
            let text = el.text().collect::<String>();
            text.trim().parse::<u32>().ok()
        })
        .max()
        .unwrap_or(1);

    PageMetadata {
        total_photos,
        max_page,
    }
}

/// Extract photo URLs from a single page of the photos listing.
fn parse_photos_from_page(html: &Html, child_id: &str) -> Vec<Photo> {
    let mut photos = Vec::new();
    let mut seen_urls = HashSet::new();

    // Primary: anchor tags with data-original attribute
    for selector_str in PHOTO_ANCHOR_SELECTORS {
        let sel = Selector::parse(selector_str).unwrap();
        for element in html.select(&sel) {
            // Prefer data-original (full size), fallback to href
            let url = element
                .value()
                .attr("data-original")
                .or_else(|| element.value().attr("href"))
                .unwrap_or("")
                .to_string();

            if url.is_empty() || !url.contains("/posts/") || seen_urls.contains(&url) {
                continue;
            }
            seen_urls.insert(url.clone());

            let hash = match extract_hash_from_url(&url) {
                Some(h) => h,
                None => continue,
            };

            let year = extract_year_from_url(&url);

            // Try to find caption in parent .post.photo container
            let caption = element
                .parent()
                .and_then(|p| p.parent())
                .and_then(|grandparent| {
                    let caption_sel =
                        Selector::parse(".PostBody__content div, .caption, .description").ok()?;
                    let grandparent_ref = scraper::ElementRef::wrap(grandparent)?;
                    grandparent_ref
                        .select(&caption_sel)
                        .next()
                        .map(|el| el.text().collect::<String>().trim().to_string())
                })
                .filter(|s| !s.is_empty());

            photos.push(Photo {
                url,
                hash,
                year,
                caption,
                child_id: child_id.to_string(),
            });
        }
    }

    // Fallback: image-based approach if no anchors found
    if photos.is_empty() {
        for selector_str in PHOTO_IMG_FALLBACK_SELECTORS {
            let sel = match Selector::parse(selector_str) {
                Ok(s) => s,
                Err(_) => continue,
            };
            for element in html.select(&sel) {
                let url = element
                    .value()
                    .attr("src")
                    .or_else(|| element.value().attr("data-src"))
                    .unwrap_or("")
                    .to_string();

                if url.is_empty() || !url.contains("/posts/") || seen_urls.contains(&url) {
                    continue;
                }
                seen_urls.insert(url.clone());

                let hash = match extract_hash_from_url(&url) {
                    Some(h) => h,
                    None => continue,
                };

                let year = extract_year_from_url(&url);

                photos.push(Photo {
                    url,
                    hash,
                    year,
                    caption: None,
                    child_id: child_id.to_string(),
                });
            }
        }
    }

    photos
}

/// Extract 64-char hex hash from URL like /posts/{hash}.large.jpeg
fn extract_hash_from_url(url: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r"/posts/([a-f0-9]{64})\.").ok()?;
    re.captures(url)?.get(1).map(|m| m.as_str().to_string())
}

/// Extract year from URL path like /schools/2521/2026/posts/
fn extract_year_from_url(url: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r"/schools/\d+/(\d{4})/posts/").ok()?;
    re.captures(url)?.get(1).map(|m| m.as_str().to_string())
}

/// Result of scraping all pages for a child.
#[derive(Debug)]
pub struct ScrapeResult {
    pub photos: Vec<Photo>,
    pub total_expected: u32,
    pub pages_scraped: u32,
    pub total_pages: u32,
    pub early_exit: bool,
}

/// Scrape all photos for a child, with early-exit when hitting known hashes.
/// Returns only new photos not in `known_hashes`.
pub async fn scrape_child_photos(
    client: &TcHttpClient,
    school_id: &str,
    child_id: &str,
    child_name: &str,
    known_hashes: &HashSet<String>,
    on_progress: impl Fn(u32, u32, u32), // (page, total_pages, photos_found_so_far)
) -> AppResult<ScrapeResult> {
    info!("Scraping photos for {} ({})", child_name, child_id);

    // Fetch first page
    let first_url = client.photos_url(school_id, child_id, 1);
    let first_html_text = client.get_html(&first_url).await?;

    // Check if we got redirected to login
    if first_html_text.contains("sign_in") && first_html_text.contains("input[type=\"password\"]")
    {
        return Err(AppError::SessionExpired);
    }

    // Parse first page in a sync block (scraper::Html is !Send)
    let (metadata, first_page_photos) = {
        let html = Html::parse_document(&first_html_text);
        let meta = parse_page_metadata(&html);
        let photos = parse_photos_from_page(&html, child_id);
        (meta, photos)
    };

    info!(
        "{}: {} total photos across {} pages",
        child_name, metadata.total_photos, metadata.max_page
    );

    let mut all_photos: Vec<Photo> = Vec::new();
    let mut seen_hashes = HashSet::new();
    let mut early_exit = false;
    let mut pages_scraped = 0u32;

    // Process page 1 results
    pages_scraped += 1;
    for photo in first_page_photos {
        if seen_hashes.contains(&photo.hash) {
            continue;
        }
        if known_hashes.contains(&photo.hash) {
            info!(
                "  Found known photo on page 1, stopping pagination (all subsequent are older)"
            );
            early_exit = true;
            break;
        }
        seen_hashes.insert(photo.hash.clone());
        all_photos.push(photo);
    }

    on_progress(1, metadata.max_page, all_photos.len() as u32);

    // Scrape remaining pages
    if !early_exit {
        for page_num in 2..=metadata.max_page {
            let page_url = client.photos_url(school_id, child_id, page_num);
            debug!("  Scraping page {}/{}", page_num, metadata.max_page);

            let page_html_text = client.get_html(&page_url).await?;

            // Parse in sync block (scraper::Html is !Send)
            let page_photos = {
                let html = Html::parse_document(&page_html_text);
                parse_photos_from_page(&html, child_id)
            };
            pages_scraped += 1;

            for photo in page_photos {
                if seen_hashes.contains(&photo.hash) {
                    continue;
                }
                if known_hashes.contains(&photo.hash) {
                    info!(
                        "  Found known photo on page {}, stopping pagination",
                        page_num
                    );
                    early_exit = true;
                    break;
                }
                seen_hashes.insert(photo.hash.clone());
                all_photos.push(photo);
            }

            on_progress(page_num, metadata.max_page, all_photos.len() as u32);

            if early_exit {
                break;
            }

            // Polite delay between pages
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }
    }

    info!(
        "{}: Found {} new photos ({}/{} pages scraped, early_exit={})",
        child_name,
        all_photos.len(),
        pages_scraped,
        metadata.max_page,
        early_exit
    );

    Ok(ScrapeResult {
        photos: all_photos,
        total_expected: metadata.total_photos,
        pages_scraped,
        total_pages: metadata.max_page,
        early_exit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_hash_from_url() {
        let url = "https://s3.amazonaws.com/transparentclassroom.com/schools/2521/2026/posts/c14c56c0e9a0560e66693c260f4afb63af4d9b3da03413b653cf05740a6fb28d.large.jpeg";
        let hash = extract_hash_from_url(url).unwrap();
        assert_eq!(
            hash,
            "c14c56c0e9a0560e66693c260f4afb63af4d9b3da03413b653cf05740a6fb28d"
        );
    }

    #[test]
    fn test_extract_hash_no_match() {
        assert!(extract_hash_from_url("https://example.com/image.jpg").is_none());
    }

    #[test]
    fn test_extract_year_from_url() {
        let url = "https://s3.amazonaws.com/transparentclassroom.com/schools/2521/2026/posts/abc.jpg";
        assert_eq!(extract_year_from_url(url), Some("2026".to_string()));
    }

    #[test]
    fn test_extract_year_no_match() {
        assert!(extract_year_from_url("https://example.com/image.jpg").is_none());
    }

    #[test]
    fn test_parse_page_metadata_zero() {
        let html = Html::parse_document("<html><body></body></html>");
        let meta = parse_page_metadata(&html);
        assert_eq!(meta.total_photos, 0);
        assert_eq!(meta.max_page, 1);
    }

    #[test]
    fn test_parse_photos_from_fixture() {
        let html_str = r#"
        <html><body>
            <div class="post photo">
                <a class="thumbnail" data-original="https://s3.amazonaws.com/transparentclassroom.com/schools/2521/2026/posts/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789.large.jpeg" href="/photo/1">
                    <img src="thumb.jpg"/>
                </a>
                <div class="PostBody__content"><div>Playing outside</div></div>
            </div>
        </body></html>"#;

        let html = Html::parse_document(html_str);
        let photos = parse_photos_from_page(&html, "12345");

        assert_eq!(photos.len(), 1);
        assert_eq!(
            photos[0].hash,
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        );
        assert_eq!(photos[0].year.as_deref(), Some("2026"));
        assert_eq!(photos[0].child_id, "12345");
    }
}
