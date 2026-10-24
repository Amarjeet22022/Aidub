import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Terminal, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Cpu, Volume2, Mic } from 'lucide-react';
import { DubbingJobState } from '../types/dubber';

interface ProcessingViewProps {
  job: DubbingJobState;
  onCancel?: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({ job, onCancel }) => {
  const [showLogs, setShowLogs] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [job.logs]);

  const steps = [
    { key: 'reading_srt', label: 'Parse Subtitles', desc: 'Read timeline cues & timing' },
    { key: 'vad', label: 'Voice Activity Detection', desc: 'Isolate human speech zones' },
    { key: 'analyzing_voice', label: 'Acoustic Pitch & Gender', desc: 'Median F0 Hz and expression analysis' },
    { key: 'synthesis', label: 'Neural Dubbing Synthesis', desc: 'Generate synchronized multilingual voices' },
    { key: 'final_mixing', label: 'Ducking & Master Mix', desc: 'Limiter and audio balance export' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6">
      {/* Title & Overall Status */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
            <h3 className="font-semibold text-white text-base">Synthesizing Dubbed Audio</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {job.currentMessage || 'Processing audio and synchronizing neural voices...'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-2xl font-mono font-bold text-emerald-400">
            {Math.min(100, Math.round(job.progress))}%
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-xs text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-rose-900/40 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Main Animated Progress Bar */}
      <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-800">
        <div
          className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 h-full rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
          style={{ width: `${Math.max(5, job.progress)}%` }}
        />
      </div>

      {/* Step Pipeline Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {steps.map((s, idx) => {
          const isDone = job.progress >= (idx + 1) * 20;
          const isCurrent = job.currentStep.includes(s.key) || (!isDone && job.progress >= idx * 18);

          return (
            <div
              key={s.key}
              className={`p-3 rounded-lg border text-left transition-all ${
                isDone
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                  : isCurrent
                  ? 'bg-slate-800/70 border-emerald-500/50 text-white shadow-sm ring-1 ring-emerald-500/20'
                  : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono opacity-60">Step {idx + 1}</span>
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                ) : null}
              </div>
              <p className="text-xs font-semibold truncate">{s.label}</p>
              <p className="text-[10px] opacity-75 truncate mt-0.5">{s.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Live Engine Console Output */}
      <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full px-4 py-2 bg-slate-950 hover:bg-slate-900 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-slate-300">Live Engine Diagnostics & Event Log</span>
          </div>
          {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showLogs && (
          <div
            ref={logContainerRef}
            className="p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1 text-slate-400 select-text"
          >
            {job.logs.length === 0 ? (
              <p className="text-slate-600 italic">Waiting for engine response...</p>
            ) : (
              job.logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-slate-600 text-[10px] shrink-0">{log.timestamp}</span>
                  <span
                    className={
                      log.type === 'error'
                        ? 'text-rose-400 font-semibold'
                        : log.type === 'cue'
                        ? 'text-emerald-400'
                        : log.type === 'success'
                        ? 'text-teal-300 font-semibold'
                        : 'text-slate-300'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
