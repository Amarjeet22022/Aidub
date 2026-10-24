# 🎙️ SRT Voice Dubber Studio

> **Voice-aware, neural audio dubbing web application.**  
> Automatically detects speaker pitch ($F_0$ in Hz), gender, and vocal emotion; ducks original dialogue while keeping background music and ambience untouched; and synthesizes synchronized neural voices aligned with translated SRT subtitles.

---

## 🌟 Key Features

- **SRT Timeline Synchronization**: Parses subtitle cues and time-stretches dubbed neural speech to fit exact cue durations while preserving pitch.
- **Voice Activity Detection (VAD)**: Accurately isolates speech zones using `webrtcvad` with energy floor gating.
- **Acoustic Speaker Analysis**: Analyzes median pitch (Hz), classifies gender, and maps emotional expressions (joy, excited, angry, sad, normal).
- **Intelligent Dialogue Ducking**: Automatically attenuates the original speaker's voice in speech zones (default -18 dB or full mute) while preserving background soundtrack/SFX.
- **Instrumental Bed Support**: Mix onto a separate instrumental/bed track for 100% clean voice replacement.
- **Multilingual Neural TTS**: Built-in neural voices for 22+ languages (Hindi, English, Spanish, French, German, Japanese, Chinese, Bengali, Tamil, Telugu, and more).
- **Interactive Dual-Track Studio Player**: A/B switch between original audio and dubbed audio in real time with synchronized subtitle captions.
- **Live Event Stream (SSE)**: Real-time progress bar, cue-by-cue status, and diagnostic terminal log.
- **One-Click Demo**: Preloaded demo speech clip and translated Hindi subtitles to test instantly.

---

## 🚀 Quick Start (Local Setup)

### 1. Prerequisites
- **Node.js**: v18+ or v20+
- **Python**: 3.10+
- **FFmpeg**: Must be installed on your system PATH (`ffmpeg -version`)

#### Installing FFmpeg:
- **Ubuntu/Debian**:
  ```bash
  sudo apt update && sudo apt install -y ffmpeg
  ```
- **macOS (Homebrew)**:
  ```bash
  brew install ffmpeg
  ```
- **Windows**:
  Download from [ffmpeg.org](https://ffmpeg.org/download.html) or `winget install Gyan.FFmpeg`.

---

### 2. Install Python Dependencies
```bash
pip install -r requirements.txt
```

---

### 3. Install Node.js Dependencies
```bash
npm install
```

---

### 4. Run the Development Server
```bash
npm run dev
```

The application will launch at:
👉 **`http://localhost:3000`**

---

### 5. Production Build & Deployment
```bash
# Build the Vite frontend
npm run build

# Start the full-stack Express server
npm start
```

---

## 📁 Project Structure

```
├── engine/
│   └── dubber.py             # Core Python voice analysis & neural dubbing engine
├── public/
│   └── sample/               # Demo sample audio & translated SRT assets
├── src/
│   ├── components/
│   │   ├── AcousticReportCard.tsx   # Speaker pitch & emotion analytics card
│   │   ├── AudioPlayerStudio.tsx    # A/B player with synchronized subtitles
│   │   ├── CueInspector.tsx         # Subtitle timeline editor & voice previewer
│   │   ├── ProcessingView.tsx       # Live SSE progress & console terminal
│   │   ├── SettingsDrawer.tsx       # Language, voices, ducking & pitch controls
│   │   └── UploadDropzones.tsx      # Audio & SRT upload dropzones
│   ├── types/
│   │   └── dubber.ts                # TypeScript interfaces
│   ├── App.tsx                      # Primary studio layout & state machine
│   ├── main.tsx                     # React 19 entry point
│   └── index.css                    # Tailwind CSS v4 styles
├── server.ts                 # Full-stack Express server (SSE, uploads & static)
├── requirements.txt          # Python package requirements
├── package.json              # NPM package scripts & dependencies
├── tsconfig.json             # TypeScript configuration
├── vite.config.ts            # Vite bundler configuration
└── README.md                 # Documentation
```

---

## 🛠️ CLI Usage (Standalone Python Engine)

You can also use the dubber engine directly via command line without the web server:

```bash
python3 engine/dubber.py \
  --audio original.mp3 \
  --srt subtitles.srt \
  --output dubbed_output.mp3 \
  --lang hi \
  --duck-db -18 \
  --match-pitch
```

### CLI Options:
| Flag | Description | Default |
|------|-------------|---------|
| `--audio` | Input audio file (MP3/WAV/M4A/OGG) | Required |
| `--srt` | Input translated SRT file | Required |
| `--output` | Output audio destination | `dubbed.mp3` |
| `--lang` | Target language code | Auto-detected |
| `--voice-male` | Custom male neural TTS voice | Language default |
| `--voice-female` | Custom female neural TTS voice | Language default |
| `--duck-db` | Dialogue ducking level in dB | `-18.0` |
| `--mute` | Fully mute original dialogue | `false` |
| `--bed` | Optional instrumental background stem | None |
| `--max-speed` | Max speed-up factor to fit cue timeline | `1.6` |
| `--match-pitch` | Nudge TTS pitch toward speaker median $F_0$ | `true` |
| `--vad-mode` | `cue` \| `intersect` \| `pure` | `cue` |
| `--report` | Save voice analysis JSON report to path | None |

---

## 📜 License
MIT License. Built for seamless voice dubbing & translation.
