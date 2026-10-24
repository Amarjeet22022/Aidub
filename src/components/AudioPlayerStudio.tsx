import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Download, FileText, Check, Sparkles } from 'lucide-react';
import { Cue } from '../types/dubber';

interface AudioPlayerStudioProps {
  jobId: string;
  originalAudioUrl?: string;
  dubbedAudioUrl: string;
  cues: Cue[];
  duration?: number;
  outputFormat?: string;
  filename?: string;
  onDownloadReport: () => void;
}

export const AudioPlayerStudio: React.FC<AudioPlayerStudioProps> = ({
  jobId,
  originalAudioUrl,
  dubbedAudioUrl,
  cues,
  duration = 0,
  outputFormat = 'mp3',
  filename = 'dubbed_audio',
  onDownloadReport,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [activeTrack, setActiveTrack] = useState<'dubbed' | 'original'>('dubbed');
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Switch source seamlessly while keeping playback time
  const currentSrc = activeTrack === 'dubbed' ? dubbedAudioUrl : (originalAudioUrl || dubbedAudioUrl);

  useEffect(() => {
    if (audioRef.current) {
      const prevTime = currentTime;
      const wasPlaying = isPlaying;
      audioRef.current.src = currentSrc;
      audioRef.current.currentTime = prevTime;
      if (wasPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }
  }, [activeTrack, currentSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setTotalDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
      setIsMuted(newVol === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 0.8;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Find active cue at current playback time
  const currentCue = cues.find(c => currentTime >= c.start && currentTime <= c.end);

  const handleDownload = () => {
    const downloadUrl = `/api/jobs/${jobId}/download`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `dubbed_${filename}.${outputFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl">
      <audio ref={audioRef} src={currentSrc} preload="metadata" />

      {/* Header bar: title & A/B Track Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <h3 className="font-semibold text-white text-base">Dubbed Audio Studio Player</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Compare original speech vs synchronized neural dubbing in real-time
          </p>
        </div>

        {/* A/B Switcher */}
        {originalAudioUrl && (
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTrack('dubbed')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTrack === 'dubbed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dubbed Track
            </button>
            <button
              onClick={() => setActiveTrack('original')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTrack === 'original'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Original Track
            </button>
          </div>
        )}
      </div>

      {/* Active Subtitle Display */}
      <div className="my-5 p-4 bg-slate-950/70 border border-slate-800/80 rounded-lg min-h-[72px] flex items-center justify-center text-center">
        {currentCue ? (
          <div>
            <div className="text-xs text-emerald-400 font-mono mb-1">
              Cue #{currentCue.index} ({formatTime(currentCue.start)} - {formatTime(currentCue.end)})
            </div>
            <p className="text-white font-medium text-base sm:text-lg leading-relaxed">
              "{currentCue.text}"
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">
            Background / Non-dialogue audio (music and ambience preserved)
          </p>
        )}
      </div>

      {/* Progress timeline scrubber */}
      <div className="space-y-1.5">
        <div className="relative flex items-center group">
          <input
            type="range"
            min={0}
            max={totalDuration || 1}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
          />
        </div>

        {/* Timestamp indicators */}
        <div className="flex justify-between text-xs font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Main Transport & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-5 pt-4 border-t border-slate-800/80">
        <div className="flex items-center gap-3">
          {/* Play/Pause Button */}
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
          </button>

          {/* Reset button */}
          <button
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
            }}
            className="p-2.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Rewind to start"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 pl-2">
            <button
              onClick={toggleMute}
              className="text-slate-400 hover:text-white p-1"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Speed Selectors */}
          <div className="hidden sm:flex items-center gap-1 pl-3 border-l border-slate-800">
            {[1, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                onClick={() => handleRateChange(rate)}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  playbackRate === rate
                    ? 'bg-slate-800 text-emerald-400 font-semibold'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Download Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDownloadReport}
            className="px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Download Voice Report JSON"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Voice Report</span>
          </button>

          <button
            onClick={handleDownload}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
          >
            {downloadSuccess ? (
              <>
                <Check className="w-4 h-4 text-emerald-950 stroke-[2.5]" />
                <span>Downloaded!</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>Download Dubbed Audio ({outputFormat.toUpperCase()})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
