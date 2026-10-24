import React, { useState } from 'react';
import { Play, Loader2, Search, Volume2, Edit3, Check, Sparkles } from 'lucide-react';
import { Cue } from '../types/dubber';

interface CueInspectorProps {
  cues: Cue[];
  onUpdateCueText?: (index: number, newText: string) => void;
  onUpdateCueGender?: (index: number, gender: 'male' | 'female' | 'unknown') => void;
  selectedMaleVoice: string;
  selectedFemaleVoice: string;
}

export const CueInspector: React.FC<CueInspectorProps> = ({
  cues,
  onUpdateCueText,
  onUpdateCueGender,
  selectedMaleVoice,
  selectedFemaleVoice,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);

  const filteredCues = cues.filter((c) =>
    c.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.index.toString().includes(searchTerm)
  );

  const formatSec = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    return `${min}:${sec.padStart(5, '0')}`;
  };

  const handlePreviewCue = async (cue: Cue) => {
    try {
      setPreviewingIndex(cue.index);
      const voice = cue.gender === 'female' ? selectedFemaleVoice : selectedMaleVoice;
      
      const res = await fetch('/api/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cue.text,
          voice,
        }),
      });

      if (!res.ok) throw new Error('Voice preview failed');
      const data = await res.json();

      if (audioPlayer) {
        audioPlayer.pause();
      }
      const audio = new Audio(data.url);
      setAudioPlayer(audio);
      audio.onended = () => setPreviewingIndex(null);
      audio.onerror = () => setPreviewingIndex(null);
      await audio.play();
    } catch (err) {
      console.error('Preview error:', err);
      setPreviewingIndex(null);
    }
  };

  const startEdit = (cue: Cue) => {
    setEditingIndex(cue.index);
    setEditingText(cue.text);
  };

  const saveEdit = (cueIndex: number) => {
    if (onUpdateCueText && editingText.trim()) {
      onUpdateCueText(cueIndex, editingText.trim());
    }
    setEditingIndex(null);
  };

  if (cues.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center">
        <p className="text-slate-400 text-sm">Upload an SRT file or load demo project to inspect and customize subtitle cues.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
      {/* Top toolbar */}
      <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-sm">Subtitle Timeline & Cues</span>
          <span className="text-xs text-slate-500 font-mono">({cues.length} cues parsed)</span>
        </div>

        {/* Search filter */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search subtitle text..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-700 w-52"
          />
        </div>
      </div>

      {/* Cues List */}
      <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-800/60">
        {filteredCues.map((cue) => {
          const duration = (cue.end - cue.start).toFixed(2);
          const isPreviewing = previewingIndex === cue.index;
          const isEditing = editingIndex === cue.index;

          return (
            <div
              key={cue.index}
              className="p-3.5 hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
            >
              {/* Left: Timing & ID */}
              <div className="flex items-center gap-3 min-w-[170px]">
                <span className="w-6 h-6 rounded bg-slate-800 text-slate-300 font-mono flex items-center justify-center text-[11px] font-semibold">
                  #{cue.index}
                </span>
                <div className="font-mono text-slate-400">
                  <span className="text-slate-300 font-medium">{formatSec(cue.start)}</span>
                  <span className="text-slate-600 mx-1">→</span>
                  <span className="text-slate-300 font-medium">{formatSec(cue.end)}</span>
                  <span className="text-slate-500 text-[10px] block">({duration}s)</span>
                </div>
              </div>

              {/* Middle: Text / Edit Input */}
              <div className="flex-1 w-full sm:w-auto">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full bg-slate-950 border border-emerald-600 rounded px-2.5 py-1 text-slate-100 text-xs focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(cue.index)}
                      className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded cursor-pointer"
                      title="Save"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <p className="text-slate-200 text-sm leading-relaxed">{cue.text}</p>
                )}
              </div>

              {/* Right: Gender override & Voice Preview */}
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                {/* Gender toggle */}
                {onUpdateCueGender && (
                  <select
                    value={cue.gender || 'unknown'}
                    onChange={(e) => onUpdateCueGender(cue.index, e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 text-slate-300 rounded px-2 py-1 text-[11px] focus:outline-none"
                    title="Override speaker gender"
                  >
                    <option value="unknown">Auto (Detect)</option>
                    <option value="male">Male Voice</option>
                    <option value="female">Female Voice</option>
                  </select>
                )}

                {/* Edit text button */}
                {onUpdateCueText && !isEditing && (
                  <button
                    onClick={() => startEdit(cue)}
                    className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                    title="Edit subtitle text"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Single Cue TTS Preview */}
                <button
                  onClick={() => handlePreviewCue(cue)}
                  disabled={isPreviewing}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  title="Test neural TTS speech on this cue"
                >
                  {isPreviewing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                      <span>Speaking...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span>Preview</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
