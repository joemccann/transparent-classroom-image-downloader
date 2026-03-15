use chrono::Utc;
use tracing::{info, warn};

use crate::core::errors::{AppError, AppResult};
use crate::core::http::TcHttpClient;
use crate::core::models::AuthSession;

const KEYCHAIN_SERVICE: &str = "com.tc-downloader.session";
const KEYCHAIN_ACCOUNT: &str = "tc-cookies";

/// Store session cookies in the OS keychain.
pub fn store_session_in_keychain(cookies: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| AppError::KeychainError(e.to_string()))?;
    entry
        .set_password(cookies)
        .map_err(|e| AppError::KeychainError(e.to_string()))?;
    info!("Session stored in OS keychain");
    Ok(())
}

/// Retrieve session cookies from the OS keychain.
pub fn load_session_from_keychain() -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| AppError::KeychainError(e.to_string()))?;
    match entry.get_password() {
        Ok(cookies) => {
            info!("Session loaded from OS keychain");
            Ok(Some(cookies))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::KeychainError(e.to_string())),
    }
}

/// Delete session from the OS keychain.
pub fn clear_session_from_keychain() -> AppResult<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| AppError::KeychainError(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => {
            info!("Session cleared from OS keychain");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()), // already cleared
        Err(e) => Err(AppError::KeychainError(e.to_string())),
    }
}

/// Validate a session by loading cookies and checking authentication.
pub async fn validate_session(client: &TcHttpClient, school_id: &str) -> AppResult<bool> {
    // Try to load cookies from keychain
    let cookies = match load_session_from_keychain()? {
        Some(c) => c,
        None => {
            info!("No session found in keychain");
            return Ok(false);
        }
    };

    // Load cookies into the HTTP client
    client.load_cookies(&cookies)?;

    // Check if the session is valid
    let is_valid = client.check_session(school_id).await?;

    if !is_valid {
        warn!("Stored session is expired or invalid");
        clear_session_from_keychain()?;
    } else {
        info!("Session is valid");
    }

    Ok(is_valid)
}

/// Create an AuthSession from raw cookie string after WebView login.
pub fn create_session(cookies: String, school_id: String) -> AppResult<AuthSession> {
    // Store in keychain
    store_session_in_keychain(&cookies)?;

    Ok(AuthSession {
        cookies,
        validated_at: Utc::now(),
        school_id,
    })
}
