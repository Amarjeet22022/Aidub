import React, { useState, useEffect } from 'react';
import {
  Mic,
  Sliders,
  Sparkles,
  Download,
  RotateCcw,
  Volume2,
  FileAudio,
  FileText,
  Play,
  ArrowRight,
  Headphones,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

import { Cue, DubbingSettings, DubbingJobState, LanguageOption } from './types/dubber';
import { UploadDropzones } from './components/UploadDropzones';
import { SettingsDrawer } from './components/SettingsDrawer';
import { CueInspector } from './components/CueInspector';
import { ProcessingView } from './components/ProcessingView';
import { AudioPlayerStudio } from './components/AudioPlayerStudio';
import { AcousticReportCard } from './components/AcousticReportCard';

const DEFAULT_SETTINGS: DubbingSettings = {
  lang: 'hi',
  voiceMale: 'hi-IN-MadhurNeural',
  voiceFemale: 'hi-IN-SwaraNeural',
  duckDb: -18,
  mute: false,
  vadMode: 'cue',
  vadGateDb: 6.0,
  noVad: false,
  matchPitch: true,
  maxSpeed: 1.6,
  dubGainDb: 0.0,
  outputFormat: 'mp3',
};

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [srtText, setSrtText] = useState<string>('');
  const [bedFile, setBedFile] = useState<File | null>(null);
  const [parsedCues, setParsedCues] = useState<Cue[]>([]);
  const [detectedLang, setDetectedLang] = useState<string>('');
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [settings, setSettings] = useState<DubbingSettings>(DEFAULT_SETTINGS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [job, setJob] = useState<DubbingJobState>({
    id: '',
    status: 'idle',
    progress: 0,
    currentStep: 'idle',
    currentMessage: '',
    cues: [],
    segments: [],
    logs: [],
  });

  // Fetch supported languages on mount
  useEffect(() => {
    fetch('/api/languages')
      .then((res) => res.json())
      .then((data) => {
        if (data.languages && data.languages.length > 0) {
          setLanguages(data.languages);
        }
      })
      .catch((err) => console.error('Failed to fetch languages:', err));
  }, []);

  // Parse SRT file or text whenever changed
  useEffect(() => {
    if (!srtFile && !srtText.trim()) {
      setParsedCues([]);
      return;
    }

    const formData = new FormData();
    if (srtFile) {
      formData.append('srt', srtFile);
    } else {
      formData.append('srtText', srtText);
    }

    fetch('/api/parse-srt', {
      method: 'POST',
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.cues) {
          setParsedCues(data.cues);
          if (data.language) {
            setDetectedLang(data.language);
            const found = languages.find((l) => l.code === data.language);
            if (found) {
              setSettings((prev) => ({
                ...prev,
                lang: found.code,
                voiceMale: found.maleVoice,
                voiceFemale: found.femaleVoice,
              }));
            }
          }
        }
      })
      .catch((err) => console.error('Failed to parse SRT:', err));
  }, [srtFile, srtText, languages]);

  // Start Neural Dubbing Job
  const handleStartDubbing = async () => {
    if (!audioFile) {
      setErrorMsg('Please upload or select an audio file.');
      return;
    }
    if (!srtFile && !srtText.trim()) {
      setErrorMsg('Please upload or paste translated SRT subtitles.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const formData = new FormData();
      formData.append('audio', audioFile);
      if (srtFile) {
        formData.append('srt', srtFile);
      } else {
        formData.append('srtText', srtText);
      }
      if (bedFile) {
        formData.append('bed', bedFile);
      }

      formData.append('lang', settings.lang);
      formData.append('voiceMale', settings.voiceMale);
      formData.append('voiceFemale', settings.voiceFemale);
      formData.append('duckDb', String(settings.duckDb));
      formData.append('mute', String(settings.mute));
      formData.append('vadMode', settings.vadMode);
      formData.append('vadGateDb', String(settings.vadGateDb));
      formData.append('matchPitch', String(settings.matchPitch));
      formData.append('maxSpeed', String(settings.maxSpeed));
      formData.append('dubGainDb', String(settings.dubGainDb));
      formData.append('outputFormat', settings.outputFormat);

      const res = await fetch('/api/dub', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start dubbing job');
      }

      const { jobId } = await res.json();

      setJob({
        id: jobId,
        status: 'processing',
        progress: 10,
        currentStep: 'starting',
        currentMessage: 'Starting neural voice engine...',
        cues: parsedCues,
        segments: [],
        logs: [{ timestamp: new Date().toLocaleTimeString(), message: 'Job initialized on server', type: 'info' }],
        audioFilename: audioFile.name,
      });

      // Connect SSE Stream
      connectJobStream(jobId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while submitting job');
      setIsSubmitting(false);
    }
  };

  const connectJobStream = (jobId: string) => {
    const sse = new EventSource(`/api/jobs/${jobId}/events`);

    sse.addEventListener('snapshot', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          currentStep: data.currentStep ?? prev.currentStep,
          currentMessage: data.currentMessage ?? prev.currentMessage,
          cues: data.cues?.length ? data.cues : prev.cues,
          segments: data.segments?.length ? data.segments : prev.segments,
          logs: data.logs ?? prev.logs,
          duration: data.duration ?? prev.duration,
        }));
      } catch {}
    });

    sse.addEventListener('step', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          currentStep: data.step ?? prev.currentStep,
          currentMessage: data.message ?? prev.currentMessage,
          logs: [...prev.logs, { timestamp: new Date().toLocaleTimeString(), message: data.message, type: 'info' }],
        }));
      } catch {}
    });

    sse.addEventListener('cue_progress', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          currentMessage: data.message ?? prev.currentMessage,
          logs: [...prev.logs, { timestamp: new Date().toLocaleTimeString(), message: data.message, type: 'cue' }],
        }));
      } catch {}
    });

    sse.addEventListener('segments', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (data.segments) {
          setJob((prev) => ({ ...prev, segments: data.segments }));
        }
      } catch {}
    });

    sse.addEventListener('cues', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        if (data.cues) {
          setJob((prev) => ({ ...prev, cues: data.cues }));
        }
      } catch {}
    });

    sse.addEventListener('log', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          logs: [...prev.logs, { timestamp: new Date().toLocaleTimeString(), message: data.message, type: data.type }],
        }));
      } catch {}
    });

    sse.addEventListener('completed', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100,
          currentStep: 'done',
          currentMessage: 'Dubbed audio ready for download!',
          duration: data.duration,
          cues: data.cues || prev.cues,
          segments: data.segments || prev.segments,
        }));
      } catch {}
      setIsSubmitting(false);
      sse.close();
    });

    sse.addEventListener('failed', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setJob((prev) => ({
          ...prev,
          status: 'failed',
          error: data.error,
          currentStep: 'error',
          currentMessage: `Processing error: ${data.error}`,
        }));
        setErrorMsg(data.error);
      } catch {}
      setIsSubmitting(false);
      sse.close();
    });

    sse.onerror = () => {
      // Fallback: poll job status once if SSE drops
      fetch(`/api/jobs/${jobId}/status`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status === 'completed') {
            setJob((prev) => ({ ...prev, status: 'completed', progress: 100 }));
            setIsSubmitting(false);
            sse.close();
          }
        })
        .catch(() => {});
    };
  };

  const handleDownloadReport = () => {
    if (!job.id) return;
    const link = document.createElement('a');
    link.href = `/api/jobs/${job.id}/report`;
    link.download = `voice_report_${job.id.slice(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    setJob({
      id: '',
      status: 'idle',
      progress: 0,
      currentStep: 'idle',
      currentMessage: '',
      cues: [],
      segments: [],
      logs: [],
    });
    setErrorMsg(null);
    setIsSubmitting(false);
  };

  const handleUpdateCueText = (index: number, newText: string) => {
    setParsedCues((prev) =>
      prev.map((c) => (c.index === index ? { ...c, text: newText } : c))
    );
  };

  const handleUpdateCueGender = (index: number, gender: 'male' | 'female' | 'unknown') => {
    setParsedCues((prev) =>
      prev.map((c) => (c.index === index ? { ...c, gender } : c))
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 space-y-6">
        {/* Error Alert */}
        {errorMsg && (
          <div className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-xl flex items-start justify-between gap-3 text-rose-200 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-white font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* COMPLETED STATE: Interactive Studio Player & Report */}
        {job.status === 'completed' ? (
          <div className="space-y-6">
            <div className="flex justify-end">
              <button
                onClick={handleReset}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start New Dubbing Project</span>
              </button>
            </div>
            <AudioPlayerStudio
              jobId={job.id}
              originalAudioUrl={`/api/jobs/${job.id}/original-audio`}
              dubbedAudioUrl={`/api/jobs/${job.id}/audio`}
              cues={job.cues}
              duration={job.duration}
              outputFormat={settings.outputFormat}
              filename={audioFile?.name || 'audio'}
              onDownloadReport={handleDownloadReport}
            />

            <AcousticReportCard
              segments={job.segments}
              onDownloadReport={handleDownloadReport}
            />

            {/* Cue inspector for review */}
            <CueInspector
              cues={job.cues}
              selectedMaleVoice={settings.voiceMale}
              selectedFemaleVoice={settings.voiceFemale}
            />
          </div>
        ) : job.status === 'processing' ? (
          /* PROCESSING STATE: Live Progress and Logs */
          <ProcessingView job={job} onCancel={handleReset} />
        ) : (
          /* IDLE / SETUP STATE: Uploads, Settings, Cues & Action */
          <div className="space-y-6">
            {/* Step 1: Upload Dropzones */}
            <UploadDropzones
              audioFile={audioFile}
              onAudioFileChange={setAudioFile}
              srtFile={srtFile}
              onSrtFileChange={setSrtFile}
              srtText={srtText}
              onSrtTextChange={setSrtText}
              parsedCues={parsedCues}
              detectedLang={detectedLang}
            />

            {/* Step 2: Settings Drawer */}
            <SettingsDrawer
              settings={settings}
              onChange={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
              languages={languages}
              bedFile={bedFile}
              onBedFileChange={setBedFile}
            />

            {/* Step 3: Subtitle Cues Inspector */}
            {parsedCues.length > 0 && (
              <CueInspector
                cues={parsedCues}
                onUpdateCueText={handleUpdateCueText}
                onUpdateCueGender={handleUpdateCueGender}
                selectedMaleVoice={settings.voiceMale}
                selectedFemaleVoice={settings.voiceFemale}
              />
            )}

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleStartDubbing}
                disabled={!audioFile || (!srtFile && !srtText.trim()) || isSubmitting}
                className="w-full py-4 px-6 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 hover:from-emerald-300 hover:to-teal-200 transition-all shadow-xl shadow-emerald-950/40 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-5 h-5 fill-current" />
                <span>
                  {isSubmitting
                    ? 'Preparing Dubbing Engine...'
                    : parsedCues.length > 0
                    ? `Generate Dubbed Audio (${parsedCues.length} Cues · ${settings.outputFormat.toUpperCase()})`
                    : 'Generate Dubbed Audio'}
                </span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </button>

              <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-500">
                <span>✓ Pitch-Preserving Neural Voice Fitting</span>
                <span aria-hidden="true">·</span>
                <span>✓ Preserves Background Ambience & Music</span>
                <span aria-hidden="true">·</span>
                <span>✓ Exact Length Sync to Input</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-5 text-center text-xs text-slate-500">
        <p>SRT Voice Dubber Studio · Powered by Voice Activity Detection, F0 Pitch Analysis & Multilingual Neural TTS</p>
      </footer>
    </div>
  );
}
