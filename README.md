# Transparent Classroom Image Downloader

Automated daily photo downloader for Transparent Classroom with email notifications.

## Features

- Downloads photos for multiple children from Transparent Classroom
- Tracks downloaded photos to avoid duplicates
- Desktop notifications via node-notifier
- Email notifications for:
  - New photos downloaded
  - Authentication errors (re-login required)
  - General errors

## Setup

### 1. Install Dependencies

```bash
npm install
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

Runs in headless mode using stored session. If the session expires, it will prompt for interactive login.

### Development

```bash
npm run dev
```

## Configuration

Edit `src/index.ts` to configure:

- `schoolId`: Your school's ID
- `children`: Child IDs and output directories

## Email Notifications

When configured, you'll receive emails for:

- **Success**: Summary of photos downloaded per child
- **Auth Error**: When re-authentication is required
- **Error**: When download fails with error details

Desktop notifications are always enabled as a fallback.
