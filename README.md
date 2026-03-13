# Transparent Classroom Image Downloader

Automated daily photo downloader for Transparent Classroom with email notifications.

## Features

- Downloads photos for multiple children from Transparent Classroom
- Tracks downloaded photos to avoid duplicates
- Desktop notifications via node-notifier
- Email notifications for:
  - New photos downloaded
  - Inline previews for up to 4 newly downloaded photos per run
  - Authentication errors (re-login required)
  - General errors

## Setup

### 1. Install Dependencies

```bash
npm install
```

This app installs Chrome into a repo-local Puppeteer cache at `.cache/puppeteer`, so it does not depend on the global `~/.cache/puppeteer` state.

If you need to repair or re-install the app-local browser manually, run:

```bash
npm run browser:install
```

### 2. Configure Email Notifications (Optional)

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your Gmail settings:

```env
EMAIL_ENABLED=true
EMAIL_TO=your-email@example.com
EMAIL_FROM=your-gmail@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password
```

**Gmail App Password Setup:**

Gmail requires an App Password (not your regular password) when 2FA is enabled:

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already enabled
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Click **Select app** → choose "Mail"
5. Click **Select device** → choose "Other" and enter "TC Downloader"
6. Click **Generate**
7. Copy the 16-character password (looks like `abcd efgh ijkl mnop`)
8. Paste it as `SMTP_PASS` in your `.env` file (without spaces)

**Important:** App Passwords are 16 lowercase letters only - no numbers or special characters. If your password has `@`, `/`, or numbers, it's not an App Password.

### 3. Build

```bash
npm run build
```

## Usage

### First Run (Login)

On first run, you'll need to authenticate:

```bash
npm run login
```

A browser window will open. Sign in to Transparent Classroom, then the browser will close automatically.

### Normal Run

```bash
npm start
```

Runs a manual sync/fetch in headless mode using the stored session and prints status in the terminal. Page navigation waits for concrete ready selectors instead of browser network-idle heuristics, which avoids hangs caused by Transparent Classroom background requests. If the session expires, it will prompt for interactive login.

### Development

```bash
npm run dev
```

### Testing

```bash
npm test
```

Builds `dist/` and runs the regression tests under `test/`. The current automated coverage asserts that the navigation helper uses `domcontentloaded` plus explicit readiness signals instead of brittle network-idle waits.

## Configuration

Edit `src/index.ts` to configure:

- `schoolId`: Your school's ID
- `children`: Child IDs and output directories

## Email Notifications

When configured, you'll receive emails for:

- **Success**: Summary of photos downloaded per child plus inline previews for up to 4 new photos from the current run (bounded to keep email size manageable)
- **Auth Error**: When re-authentication is required
- **Error**: When download fails with error details

If a run finds no new photos, the success email is skipped.

Desktop notifications are always enabled as a fallback.
