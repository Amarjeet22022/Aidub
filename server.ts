import express, { Request, Response } from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Ensure storage directories exist
const UPLOADS_DIR = path.resolve('uploads');
const OUTPUTS_DIR = path.resolve('outputs');
const PREVIEWS_DIR = path.resolve('outputs/previews');

for (const dir of [UPLOADS_DIR, OUTPUTS_DIR, PREVIEWS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

// Supported Languages & Voices catalog
export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  maleVoice: string;
  femaleVoice: string;
}

const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', maleVoice: 'hi-IN-MadhurNeural', femaleVoice: 'hi-IN-SwaraNeural' },
  { code: 'en', name: 'English (US)', nativeName: 'English (US)', flag: '🇺🇸', maleVoice: 'en-US-GuyNeural', femaleVoice: 'en-US-JennyNeural' },
  { code: 'en-IN', name: 'English (India)', nativeName: 'Indian English', flag: '🇮🇳', maleVoice: 'en-IN-PrabhatNeural', femaleVoice: 'en-IN-NeerjaNeural' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', maleVoice: 'es-ES-AlvaroNeural', femaleVoice: 'es-ES-ElviraNeural' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', maleVoice: 'fr-FR-HenriNeural', femaleVoice: 'fr-FR-DeniseNeural' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', maleVoice: 'de-DE-ConradNeural', femaleVoice: 'de-DE-KatjaNeural' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', maleVoice: 'ja-JP-KeitaNeural', femaleVoice: 'ja-JP-NanamiNeural' },
  { code: 'zh', name: 'Chinese (Mandarin)', nativeName: '中文', flag: '🇨🇳', maleVoice: 'zh-CN-YunxiNeural', femaleVoice: 'zh-CN-XiaoxiaoNeural' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇮🇳', maleVoice: 'bn-IN-BashkarNeural', femaleVoice: 'bn-IN-TanishaaNeural' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳', maleVoice: 'ta-IN-ValluvarNeural', femaleVoice: 'ta-IN-PallaviNeural' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳', maleVoice: 'te-IN-MohanNeural', femaleVoice: 'te-IN-ShrutiNeural' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳', maleVoice: 'mr-IN-ManoharNeural', femaleVoice: 'mr-IN-AarohiNeural' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳', maleVoice: 'gu-IN-NiranjanNeural', femaleVoice: 'gu-IN-DhwaniNeural' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳', maleVoice: 'kn-IN-GaganNeural', femaleVoice: 'kn-IN-SapnaNeural' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳', maleVoice: 'ml-IN-MidhunNeural', femaleVoice: 'ml-IN-SobhanaNeural' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰', maleVoice: 'ur-IN-SalmanNeural', femaleVoice: 'ur-IN-GulNeural' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', maleVoice: 'ar-SA-HamedNeural', femaleVoice: 'ar-SA-ZariyahNeural' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', maleVoice: 'pt-BR-AntonioNeural', femaleVoice: 'pt-BR-FranciscaNeural' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', maleVoice: 'it-IT-DiegoNeural', femaleVoice: 'it-IT-ElsaNeural' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', maleVoice: 'ru-RU-DmitryNeural', femaleVoice: 'ru-RU-SvetlanaNeural' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', maleVoice: 'ko-KR-InJoonNeural', femaleVoice: 'ko-KR-SunHiNeural' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', maleVoice: 'tr-TR-AhmetNeural', femaleVoice: 'tr-TR-EmelNeural' },
];

export interface DubbingJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  currentMessage: string;
  error?: string;
  audioPath: string;
  audioFilename: string;
  srtPath: string;
  bedPath?: string;
  outputPath?: string;
  outputFormat: string;
  targetLang: string;
  cues: any[];
  segments: any[];
  logs: Array<{ timestamp: string; message: string; type?: string }>;
  duration?: number;
  createdAt: number;
  completedAt?: number;
  sseClients: Response[];
}

const jobs = new Map<string, DubbingJob>();

// Broadcast event to connected SSE listeners
function broadcastJobEvent(job: DubbingJob, eventType: string, data: any) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  job.sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      // client disconnected
    }
  });
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// Languages & presets
app.get('/api/languages', (req: Request, res: Response) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

// Parse SRT on the fly
app.post('/api/parse-srt', upload.single('srt'), (req: Request, res: Response) => {
  let srtPath: string | null = null;
  let isTemp = false;

  if (req.file) {
    srtPath = req.file.path;
  } else if (req.body.srtText) {
    srtPath = path.join(UPLOADS_DIR, `temp-${randomUUID().slice(0, 8)}.srt`);
    fs.writeFileSync(srtPath, req.body.srtText, 'utf-8');
    isTemp = true;
  }

  if (!srtPath) {
    res.status(400).json({ error: 'No SRT file or text provided' });
    return;
  }

  const py = spawn('python3', [
    path.resolve('engine/dubber.py'),
    '--action', 'parse-srt',
    '--srt', srtPath,
  ]);

  let stdout = '';
  let stderr = '';

  py.stdout.on('data', (d) => (stdout += d.toString()));
  py.stderr.on('data', (d) => (stderr += d.toString()));

  py.on('close', (code) => {
    if (isTemp && srtPath && fs.existsSync(srtPath)) {
      try { fs.unlinkSync(srtPath); } catch {}
    }
    if (code !== 0) {
      res.status(500).json({ error: stderr || 'Failed to parse SRT' });
      return;
    }
    try {
      const data = JSON.parse(stdout);
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: 'Invalid response from parser', raw: stdout });
    }
  });
});

// Single voice preview generator
app.post('/api/preview-voice', async (req: Request, res: Response) => {
  const { text = 'Hello, this is a neural voice preview.', voice = 'hi-IN-MadhurNeural' } = req.body;
  const previewFilename = `preview-${randomUUID().slice(0, 8)}.mp3`;
  const previewPath = path.join(PREVIEWS_DIR, previewFilename);

  const py = spawn('python3', [
    path.resolve('engine/dubber.py'),
    '--action', 'preview',
    '--text', text,
    '--voice', voice,
    '--output', previewPath,
  ]);

  py.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(previewPath)) {
      res.status(500).json({ error: 'Failed to synthesize voice preview' });
      return;
    }
    res.json({
      url: `/api/previews/${previewFilename}`,
      voice,
      text,
    });
  });
});

app.use('/api/previews', express.static(PREVIEWS_DIR));

// Start Dubbing Job (Multipart upload)
app.post(
  '/api/dub',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'srt', maxCount: 1 },
    { name: 'bed', maxCount: 1 },
  ]),
  (req: Request, res: Response) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    let audioPath = files?.audio?.[0]?.path;
    let srtPath = files?.srt?.[0]?.path;
    const bedPath = files?.bed?.[0]?.path;

    // Support pasted SRT text
    if (!srtPath && req.body.srtText) {
      srtPath = path.join(UPLOADS_DIR, `srt-${randomUUID().slice(0, 8)}.srt`);
      fs.writeFileSync(srtPath, req.body.srtText, 'utf-8');
    }

    if (!audioPath) {
      res.status(400).json({ error: 'Original audio file is required' });
      return;
    }
    if (!srtPath) {
      res.status(400).json({ error: 'SRT subtitle file or text is required' });
      return;
    }

    const jobId = randomUUID();
    const format = req.body.outputFormat || 'mp3';
    const outputPath = path.join(OUTPUTS_DIR, `dubbed-${jobId}.${format}`);
    const reportPath = path.join(OUTPUTS_DIR, `report-${jobId}.json`);

    const job: DubbingJob = {
      id: jobId,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      currentMessage: 'Job queued for processing',
      audioPath,
      audioFilename: files?.audio?.[0]?.originalname || 'original_audio.mp3',
      srtPath,
      bedPath,
      outputPath,
      outputFormat: format,
      targetLang: req.body.lang || '',
      cues: [],
      segments: [],
      logs: [{ timestamp: new Date().toLocaleTimeString(), message: 'Dubbing job initialized', type: 'info' }],
      createdAt: Date.now(),
      sseClients: [],
    };

    jobs.set(jobId, job);

    startDubbingProcess(job, {
      voiceMale: req.body.voiceMale,
      voiceFemale: req.body.voiceFemale,
      defaultVoice: req.body.defaultVoice,
      duckDb: req.body.duckDb ? parseFloat(req.body.duckDb) : -18.0,
      mute: req.body.mute === 'true' || req.body.mute === true,
      vadMode: req.body.vadMode || 'cue',
      vadGateDb: req.body.vadGateDb ? parseFloat(req.body.vadGateDb) : 6.0,
      noVad: req.body.noVad === 'true' || req.body.noVad === true,
      matchPitch: req.body.matchPitch !== 'false' && req.body.matchPitch !== false,
      maxSpeed: req.body.maxSpeed ? parseFloat(req.body.maxSpeed) : 1.6,
      dubGainDb: req.body.dubGainDb ? parseFloat(req.body.dubGainDb) : 0.0,
      reportPath,
    });

    res.json({ jobId, message: 'Job accepted and processing started' });
  }
);

// Worker process spawner
function startDubbingProcess(job: DubbingJob, options: Record<string, any>) {
  job.status = 'processing';
  job.progress = 5;
  job.currentStep = 'starting';
  job.currentMessage = 'Launching Python audio processing engine...';

  const pyArgs = [
    path.resolve('engine/dubber.py'),
    '--audio', job.audioPath,
    '--srt', job.srtPath,
    '--output', job.outputPath!,
    '--json-stream',
  ];

  if (job.targetLang) pyArgs.push('--lang', job.targetLang);
  if (options.voiceMale) pyArgs.push('--voice-male', options.voiceMale);
  if (options.voiceFemale) pyArgs.push('--voice-female', options.voiceFemale);
  if (options.defaultVoice) pyArgs.push('--default-voice', options.defaultVoice);
  if (options.duckDb !== undefined) pyArgs.push('--duck-db', String(options.duckDb));
  if (options.mute) pyArgs.push('--mute');
  if (job.bedPath) pyArgs.push('--bed', job.bedPath);
  if (options.vadMode) pyArgs.push('--vad-mode', options.vadMode);
  if (options.vadGateDb) pyArgs.push('--vad-gate-db', String(options.vadGateDb));
  if (options.noVad) pyArgs.push('--no-vad');
  if (options.matchPitch) pyArgs.push('--match-pitch'); else pyArgs.push('--no-match-pitch');
  if (options.maxSpeed) pyArgs.push('--max-speed', String(options.maxSpeed));
  if (options.dubGainDb) pyArgs.push('--dub-gain-db', String(options.dubGainDb));
  if (options.reportPath) pyArgs.push('--report', options.reportPath);

  const py = spawn('python3', pyArgs);

  let buffer = '';

  py.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('__DUBBER_EVENT__:')) {
        try {
          const raw = line.slice('__DUBBER_EVENT__:'.length);
          const ev = JSON.parse(raw);
          handleEngineEvent(job, ev);
        } catch {
          // parse error
        }
      } else if (line.trim()) {
        job.logs.push({
          timestamp: new Date().toLocaleTimeString(),
          message: line.trim(),
          type: 'info',
        });
        broadcastJobEvent(job, 'log', { message: line.trim() });
      }
    }
  });

  py.stderr.on('data', (chunk) => {
    const errText = chunk.toString().trim();
    if (errText) {
      job.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        message: errText,
        type: 'error',
      });
      broadcastJobEvent(job, 'log', { message: errText, type: 'error' });
    }
  });

  py.on('close', (code) => {
    if (code === 0 && job.outputPath && fs.existsSync(job.outputPath)) {
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = Date.now();
      job.currentStep = 'done';
      job.currentMessage = 'Dubbing completed successfully!';
      job.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        message: 'Master audio exported and ready for download',
        type: 'success',
      });
      broadcastJobEvent(job, 'completed', {
        id: job.id,
        duration: job.duration,
        outputPath: `/api/jobs/${job.id}/audio`,
        cues: job.cues,
        segments: job.segments,
      });
    } else {
      job.status = 'failed';
      job.error = job.error || `Process exited with code ${code}`;
      job.currentStep = 'error';
      job.currentMessage = `Dubbing failed: ${job.error}`;
      broadcastJobEvent(job, 'failed', { error: job.error });
    }
  });

  py.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
    job.currentMessage = err.message;
    broadcastJobEvent(job, 'failed', { error: err.message });
  });
}

function handleEngineEvent(job: DubbingJob, ev: any) {
  if (ev.type === 'step') {
    job.currentStep = ev.step;
    job.currentMessage = ev.message;
    if (ev.progress !== undefined) job.progress = ev.progress;
    job.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      message: ev.message,
      type: 'info',
    });
    broadcastJobEvent(job, 'step', ev);
  } else if (ev.type === 'cues_parsed') {
    job.cues = ev.cues;
    broadcastJobEvent(job, 'cues', ev);
  } else if (ev.type === 'lang_detected') {
    job.targetLang = ev.lang;
    broadcastJobEvent(job, 'lang', ev);
  } else if (ev.type === 'analysis_completed') {
    job.segments = ev.segments;
    broadcastJobEvent(job, 'segments', ev);
  } else if (ev.type === 'cue_progress') {
    job.progress = ev.progress || job.progress;
    job.currentMessage = ev.message;
    job.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      message: ev.message,
      type: 'cue',
    });
    broadcastJobEvent(job, 'cue_progress', ev);
  } else if (ev.type === 'complete') {
    job.progress = 100;
    job.duration = ev.duration;
    broadcastJobEvent(job, 'progress', { progress: 100 });
  }
}

// Job SSE Stream
app.get('/api/jobs/:id/events', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  job.sseClients.push(res);

  // Send initial snapshot
  const initial = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    currentMessage: job.currentMessage,
    cues: job.cues,
    segments: job.segments,
    logs: job.logs,
    error: job.error,
    duration: job.duration,
  };
  res.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);

  req.on('close', () => {
    job.sseClients = job.sseClients.filter((c) => c !== res);
  });
});

// Job Status Poll Fallback
app.get('/api/jobs/:id/status', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    currentMessage: job.currentMessage,
    logs: job.logs,
    cues: job.cues,
    segments: job.segments,
    duration: job.duration,
    error: job.error,
  });
});

// Stream Dubbed Audio
app.get('/api/jobs/:id/audio', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: 'Output audio not found or job still processing' });
    return;
  }

  const stat = fs.statSync(job.outputPath);
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
  };
  const mimeType = mimeMap[job.outputFormat] || 'audio/mpeg';

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(job.outputPath).pipe(res);
});

// Stream Original Audio (for A/B compare)
app.get('/api/jobs/:id/original-audio', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.audioPath || !fs.existsSync(job.audioPath)) {
    res.status(404).json({ error: 'Original audio not found' });
    return;
  }
  const stat = fs.statSync(job.audioPath);
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(job.audioPath).pipe(res);
});

// Direct Download Dubbed Audio
app.get('/api/jobs/:id/download', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    res.status(404).send('Audio not found');
    return;
  }
  const filename = `dubbed_${path.basename(job.audioFilename, path.extname(job.audioFilename))}.${job.outputFormat}`;
  res.download(job.outputPath, filename);
});

// Download Voice Analysis Report
app.get('/api/jobs/:id/report', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    jobId: job.id,
    targetLanguage: job.targetLang,
    totalCues: job.cues.length,
    speechSegments: job.segments,
    logs: job.logs,
  });
});

// Download Project Repository ZIP
app.get(['/srt-voice-dubber-studio.zip', '/api/download-project-zip'], (req: Request, res: Response) => {
  const zipPath = path.resolve('public/srt-voice-dubber-studio.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'srt-voice-dubber-studio.zip');
  } else {
    res.status(404).send('ZIP file not found');
  }
});

// -------------------------------------------------------------
// Vite Dev Server / Static Hosting
// -------------------------------------------------------------
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dubber Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
