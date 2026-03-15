# Transparent Classroom Photo Downloader

Download all your children's photos from [Transparent Classroom](https://www.transparentclassroom.com) to your local machine. Tracks previously downloaded photos to avoid duplicates, so you can run it repeatedly to grab only new ones.

## Desktop App (Recommended)

A native desktop app — no terminal, Node.js, or setup required.

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [TC.Photo.Downloader.dmg (arm64)](https://github.com/joemccann/transparent-classroom-image-downloader/releases/latest/download/TC.Photo.Downloader_0.1.0_aarch64.dmg) |
| macOS (Intel) | [TC.Photo.Downloader.dmg (x64)](https://github.com/joemccann/transparent-classroom-image-downloader/releases/latest/download/TC.Photo.Downloader_0.1.0_x64.dmg) |
| Windows (exe) | [TC.Photo.Downloader.exe](https://github.com/joemccann/transparent-classroom-image-downloader/releases/latest/download/TC.Photo.Downloader_0.1.0_x64-setup.exe) |
| Windows (msi) | [TC.Photo.Downloader.msi](https://github.com/joemccann/transparent-classroom-image-downloader/releases/latest/download/TC.Photo.Downloader_0.1.0_x64_en-US.msi) |

> **Note**: On macOS you may need to right-click and select "Open" the first time, since the app is not notarized.

### How the Desktop App Works

1. Log in to Transparent Classroom through the in-app browser
2. The app auto-detects your school and children
3. Choose a download folder
4. Hit "Start Download" — photos are organized by child and year
5. Previously downloaded photos are skipped automatically

---

## CLI (Headless)

For automation, scheduling, or running on a server without a GUI.

### Quick Start

```bash
git clone https://github.com/joemccann/transparent-classroom-image-downloader.git
cd transparent-classroom-image-downloader/cli
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

### Configuration

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

### Usage

```bash
npm run login   # authenticate (opens browser)
npm start       # download all photos
```

Just `npm start` for subsequent runs. The tool tracks what's been downloaded in `state/download-state.json` and only fetches new photos.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run in headless mode |
| `npm run login` | Interactive login (opens browser) |
| `npm run dev` | Run via ts-node (no build needed) |
| `npm test` | Build and run regression tests |

---

## Project Structure

```
├── cli/          # Headless Node.js scraper (for automation/scheduling)
├── tauri-app/    # Native desktop app (Tauri 2 + React + Rust)
└── .github/      # CI/CD workflows for building releases
```

## License

MIT
