use std::sync::Arc;
use std::time::Duration;

use reqwest::{cookie::Jar, header, Client, Response};
use url::Url;

use crate::core::errors::{AppError, AppResult};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE_URL: &str = "https://www.transparentclassroom.com";

/// Wrapper around reqwest::Client with cookie jar and TC-specific defaults.
#[derive(Clone)]
pub struct TcHttpClient {
    client: Client,
    cookie_jar: Arc<Jar>,
    base_url: String,
    safe_mode: bool,
}

impl TcHttpClient {
    pub fn new(safe_mode: bool) -> AppResult<Self> {
        let cookie_jar = Arc::new(Jar::default());

        let client = Client::builder()
            .cookie_provider(cookie_jar.clone())
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(5))
            .default_headers({
                let mut headers = header::HeaderMap::new();
                headers.insert(
                    header::ACCEPT,
                    header::HeaderValue::from_static(
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    ),
                );
                headers.insert(
                    header::ACCEPT_LANGUAGE,
                    header::HeaderValue::from_static("en-US,en;q=0.9"),
                );
                headers
            })
            .build()
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        Ok(Self {
            client,
            cookie_jar,
            base_url: BASE_URL.to_string(),
            safe_mode,
        })
    }

    /// Load session cookies from a serialized cookie string.
    /// Format: "name=value; name2=value2" (from WebView document.cookie or Set-Cookie headers).
    pub fn load_cookies(&self, cookie_header: &str) -> AppResult<()> {
        let url: Url = self
            .base_url
            .parse()
            .map_err(|e: url::ParseError| AppError::ConfigError(e.to_string()))?;

        for cookie_str in cookie_header.split(';') {
            let trimmed = cookie_str.trim();
            if !trimmed.is_empty() {
                self.cookie_jar.add_cookie_str(trimmed, &url);
            }
        }
        Ok(())
    }

    /// Fetch a page and return the response.
    pub async fn get(&self, url: &str) -> AppResult<Response> {
        if self.safe_mode {
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(60);
            return Err(AppError::RateLimited {
                retry_after_secs: retry_after,
            });
        }

        Ok(response)
    }

    /// Fetch a page as text HTML.
    pub async fn get_html(&self, url: &str) -> AppResult<String> {
        let response = self.get(url).await?;
        let status = response.status();

        if !status.is_success() {
            return Err(AppError::NetworkError(format!(
                "HTTP {} for {}",
                status, url
            )));
        }

        response
            .text()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))
    }

    /// Download a file, returning the bytes and optional content-length.
    pub async fn download_bytes(&self, url: &str) -> AppResult<(Vec<u8>, Option<u64>)> {
        if self.safe_mode {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let status = response.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(60);
            return Err(AppError::RateLimited {
                retry_after_secs: retry_after,
            });
        }

        // Handle redirects (S3 pre-signed URLs)
        if !status.is_success() && !status.is_redirection() {
            return Err(AppError::DownloadError(format!(
                "HTTP {} downloading {}",
                status, url
            )));
        }

        let content_length = response.content_length();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::DownloadError(e.to_string()))?;

        Ok((bytes.to_vec(), content_length))
    }

    /// Check if we have a valid authenticated session by visiting sign_in
    /// and seeing if we get redirected away (= authenticated).
    pub async fn check_session(&self, _school_id: &str) -> AppResult<bool> {
        let url = format!("{}/souls/sign_in", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let final_url = response.url().to_string();

        // If we're still on sign_in, not authenticated
        let is_login_page =
            final_url.contains("/sign_in") || final_url.contains("/login");

        Ok(!is_login_page)
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn photos_url(&self, school_id: &str, child_id: &str, page: u32) -> String {
        if page <= 1 {
            format!(
                "{}/s/{}/children/{}/photos?locale=en",
                self.base_url, school_id, child_id
            )
        } else {
            format!(
                "{}/s/{}/children/{}/photos?locale=en&page={}",
                self.base_url, school_id, child_id, page
            )
        }
    }
}
