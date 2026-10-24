import React, { useState, useRef } from 'react';
import { Upload, FileAudio, FileText, Sparkles, CheckCircle2, X, Music, AlertCircle } from 'lucide-react';
import { Cue } from '../types/dubber';

interface UploadDropzonesProps {
  audioFile: File | null;
  onAudioFileChange: (file: File | null) => void;
  srtFile: File | null;
  onSrtFileChange: (file: File | null) => void;
  srtText: string;
  onSrtTextChange: (text: string) => void;
  parsedCues: Cue[];
  detectedLang?: string;
}

export const UploadDropzones: React.FC<UploadDropzonesProps> = ({
  audioFile,
  onAudioFileChange,
  srtFile,
  onSrtFileChange,
  srtText,
  onSrtTextChange,
  parsedCues,
  detectedLang,
}) => {
  const [srtInputMode, setSrtInputMode] = useState<'file' | 'text'>('file');
  const [isAudioDragOver, setIsAudioDragOver] = useState(false);
  const [isSrtDragOver, setIsSrtDragOver] = useState(false);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Main 2-Column Dropzones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Audio Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsAudioDragOver(true); }}
          onDragLeave={() => setIsAudioDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsAudioDragOver(false);
            if (e.dataTransfer.files?.[0]) {
              onAudioFileChange(e.dataTransfer.files[0]);
            }
          }}
          className={`border-2 border-dashed rounded-xl p-6 transition-all relative flex flex-col items-center justify-center min-h-[190px] text-center ${
            isAudioDragOver
              ? 'border-emerald-500 bg-emerald-950/20'
              : audioFile
              ? 'border-emerald-800/80 bg-slate-900/90'
              : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
          }`}
        >
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) onAudioFileChange(e.target.files[0]);
            }}
          />

          {audioFile ? (
            <div className="w-full space-y-3">
              <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center gap-3 truncate text-left">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                    <FileAudio className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-semibold text-white truncate max-w-[210px]">{audioFile.name}</p>
                    <span className="text-[11px] text-slate-400">{formatFileSize(audioFile.size)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onAudioFileChange(null)}
                  className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Native audio player preview */}
              <div className="w-full">
                <audio
                  controls
                  className="w-full h-8 opacity-80"
                  src={URL.createObjectURL(audioFile)}
                />
              </div>
            </div>
          ) : (
            <div
              onClick={() => audioInputRef.current?.click()}
              className="cursor-pointer space-y-2.5 w-full flex flex-col items-center"
            >
              <div className="w-12 h-12 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center group-hover:text-emerald-400 transition-colors">
                <FileAudio className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  Drop original audio file here, or <span className="text-emerald-400 underline underline-offset-2">browse</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Supports MP3, WAV, M4A, AAC, OGG, FLAC (up to 100 MB)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right: SRT Dropzone / Text Editor */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsSrtDragOver(true); }}
          onDragLeave={() => setIsSrtDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsSrtDragOver(false);
            if (e.dataTransfer.files?.[0]) {
              onSrtFileChange(e.dataTransfer.files[0]);
              setSrtInputMode('file');
            }
          }}
          className={`border-2 border-dashed rounded-xl p-5 transition-all relative flex flex-col justify-between min-h-[190px] ${
            isSrtDragOver
              ? 'border-emerald-500 bg-emerald-950/20'
              : srtFile || srtText
              ? 'border-emerald-800/80 bg-slate-900/90'
              : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
          }`}
        >
          <input
            ref={srtInputRef}
            type="file"
            accept=".srt,.vtt,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) onSrtFileChange(e.target.files[0]);
            }}
          />

          {/* Mode switch */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              Translated SRT Subtitles
            </span>
            <div className="flex items-center bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px]">
              <button
                type="button"
                onClick={() => setSrtInputMode('file')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  srtInputMode === 'file' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Upload File
              </button>
              <button
                type="button"
                onClick={() => setSrtInputMode('text')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  srtInputMode === 'text' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Paste Text
              </button>
            </div>
          </div>

          {srtInputMode === 'file' ? (
            srtFile ? (
              <div className="w-full my-auto space-y-2">
                <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-3 truncate text-left">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-semibold text-white truncate max-w-[200px]">{srtFile.name}</p>
                      <span className="text-[11px] text-slate-400">{formatFileSize(srtFile.size)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSrtFileChange(null)}
                    className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Remove SRT"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {parsedCues.length > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <span>{parsedCues.length} subtitle cues ready</span>
                    {detectedLang && (
                      <span className="text-emerald-400 font-mono uppercase">Lang: {detectedLang}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => srtInputRef.current?.click()}
                className="cursor-pointer space-y-2 w-full my-auto flex flex-col items-center text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">
                    Drop SRT subtitle file here, or <span className="text-emerald-400 underline underline-offset-2">browse</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Accepts standard .srt files with timeline cues
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-1.5 flex-1 flex flex-col">
              <textarea
                value={srtText}
                onChange={(e) => onSrtTextChange(e.target.value)}
                placeholder={"1\n00:00:01,000 --> 00:00:04,000\nYour translated subtitle text here..."}
                className="w-full flex-1 min-h-[95px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-slate-700 resize-none"
              />
              {parsedCues.length > 0 && (
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{parsedCues.length} cues parsed</span>
                  {detectedLang && (
                    <span className="text-emerald-400 font-mono uppercase">Detected: {detectedLang}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
