# Transparent Classroom Photo Downloader

Download all your children's photos from [Transparent Classroom](https://www.transparentclassroom.com) to your local machine. Tracks previously downloaded photos to avoid duplicates, so you can run it repeatedly to grab only new ones.

## Quick Start

```bash
git clone https://github.com/joemccann/transparent-classroom-image-downloader.git
cd transparent-classroom-image-downloader
npm install
cp .env.example .env
```

Edit `.env` with your school and children info (see [Configuration](#configuration)), then:

```bash
npm run build
npm run login   # opens a browser — sign in to Transparent Classroom
npm start       # downloads all photos
```

That's it. Photos are saved to `OUTPUT_DIR/<ChildName>/<year>/`.

## Configuration

Copy `.env.example` to `.env` and fill in the required values:

```env
# Required
SCHOOL_ID=12345
CHILDREN=Cole:322263,Isla:598458
OUTPUT_DIR=~/Downloads/Photos
```

| Variable | Required | Description |
|----------|----------|-------------|
| `SCHOOL_ID` | Yes | Your school's numeric ID (visible in TC URLs) |
| `CHILDREN` | Yes | `Name:ChildID` pairs, comma-separated. Child IDs are in the TC URL when viewing a child's profile. |
| `OUTPUT_DIR` | Yes | Base directory for downloaded photos. A subfolder is created per child. |
| `EMAIL_ENABLED` | No | Set to `true` to receive email notifications |
| `EMAIL_TO` | No | Recipient email address |
| `EMAIL_FROM` | No | Sender Gmail address |
| `SMTP_HOST` | No | SMTP server (default: `smtp.gmail.com`) |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | Gmail App Password ([how to generate](https://myaccount.google.com/apppasswords)) |

### Finding Your School ID and Child IDs

1. Log in to Transparent Classroom
2. **School ID**: Look at the URL — e.g., `transparentclassroom.com/s/2521/...` → school ID is `2521`
3. **Child ID**: Navigate to a child's profile — e.g., `.../children/322263/...` → child ID is `322263`

## Usage

### One-Time Download

```bash
npm run login   # authenticate (opens browser)
npm start       # download all photos
```

### Subsequent Runs

Just `npm start`. The tool tracks what's been downloaded in `state/download-state.json` and only fetches new photos. If your session expired, it will prompt for login automatically.

### Optional: Schedule Daily Runs (macOS)

Create a LaunchAgent plist at `~/Library/LaunchAgents/com.yourname.tc-downloader.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yourname.tc-downloader</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/node</string>
        <string>/path/to/transparent-classroom-image-downloader/dist/index.js</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/path/to/transparent-classroom-image-downloader</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/path/to/transparent-classroom-image-downloader/logs/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/transparent-classroom-image-downloader/logs/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/path/to/node/bin</string>
    </dict>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.tc-downloader.plist
```

**Tip**: Run `which node` to find your Node.js path, and `pwd` in the repo to get the working directory.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run in headless mode |
| `npm run login` | Interactive login (opens browser) |
| `npm run dev` | Run via ts-node (no build needed) |
| `npm test` | Build and run regression tests |

## How It Works

1. Launches a headless Chromium browser with a persistent session
2. Checks if you're authenticated; prompts for login if not
3. For each configured child, navigates to their photos page
4. Scrapes photo URLs across all pages (newest first, stops early when hitting already-downloaded photos)
5. Downloads new photos into `OUTPUT_DIR/<ChildName>/<year>/`
6. Saves state so the next run only grabs new photos
7. Sends desktop/email notifications

## License

MIT
