//! Centralized CSS selectors for TC page parsing.
//! All selectors are defined here so markup drift is contained to a single file.

/// Selector for the page info element (e.g., "465 Photos")
pub const PAGE_INFO_SELECTOR: &str = ".page_info";

/// Selector for pagination links
pub const PAGINATION_LINK_SELECTOR: &str = ".pagination a, .pagination-container a";

/// Primary photo anchor selectors (full-size image links with data-original)
pub const PHOTO_ANCHOR_SELECTORS: &[&str] = &[
    ".post.photo a.thumbnail[data-original]",
    ".post.photo a.fancybox[data-original]",
];

/// Fallback image selectors when anchors aren't found
pub const PHOTO_IMG_FALLBACK_SELECTORS: &[&str] = &[
    "img[src*=\"transparentclassroom.com\"]",
    "img[src*=\"s3.amazonaws.com\"]",
    "img[data-src*=\"transparentclassroom.com\"]",
    "img[data-src*=\"s3.amazonaws.com\"]",
    ".photo img",
    ".post img",
];

/// Photo page readiness indicators — at least one of these should be present
/// on a successfully loaded photos page.
pub const PHOTO_PAGE_MARKERS: &[&str] = &[
    ".page_info",
    ".post.photo",
    ".pagination",
    ".pagination-container",
    ".empty_state",
    ".blank-state",
];

/// Login page indicators
pub const LOGIN_FORM_SELECTORS: &[&str] = &[
    "form[action*=\"sign_in\"]",
    "input[name=\"user[email]\"]",
    "input[type=\"password\"]",
];

/// URL fragments that indicate a login/sign-in page
pub const LOGIN_URL_MARKERS: &[&str] = &["/sign_in", "/login"];
