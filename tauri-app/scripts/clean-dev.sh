#!/bin/bash
# Wipe ALL app state and WebView data before dev builds
APP="tc-downloader"
BUNDLE="com.tc-downloader.app"

for ID in "$APP" "$BUNDLE"; do
  rm -rf "$HOME/Library/Application Support/$ID" 2>/dev/null
  rm -rf "$HOME/Library/WebKit/$ID" 2>/dev/null
  rm -rf "$HOME/Library/Caches/$ID" 2>/dev/null
  rm -rf "$HOME/Library/HTTPStorages/$ID" 2>/dev/null
  rm -f  "$HOME/Library/HTTPStorages/$ID.binarycookies" 2>/dev/null
  rm -f  "$HOME/Library/Preferences/$ID.plist" 2>/dev/null
done

# WKWebView also stores under com.apple.WebKit prefixed paths
rm -rf "$HOME/Library/WebKit/com.apple.WebKit"*"$BUNDLE"* 2>/dev/null

# Cookies directory
rm -rf "$HOME/Library/Cookies/$APP"* 2>/dev/null
rm -rf "$HOME/Library/Cookies/$BUNDLE"* 2>/dev/null

# Keychain
security delete-generic-password -s "com.tc-downloader.session" -a "tc-cookies" 2>/dev/null || true

echo "[clean-dev] Wiped app data, WebView cookies, cache, and keychain"
