import React, { useState } from 'react';
import { Sliders, Volume2, ShieldCheck, Music, Mic2, Sparkles, ChevronDown, ChevronUp, Play, Loader2 } from 'lucide-react';
import { DubbingSettings, LanguageOption } from '../types/dubber';

interface SettingsDrawerProps {
  settings: DubbingSettings;
  onChange: (updated: Partial<DubbingSettings>) => void;
  languages: LanguageOption[];
  bedFile: File | null;
  onBedFileChange: (file: File | null) => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  settings,
  onChange,
  languages,
  bedFile,
  onBedFileChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [testingVoice, setTestingVoice] = useState<string | null>(null);

  const selectedLang = languages.find((l) => l.code === settings.lang) || languages[0];

  const handleTestVoice = async (voice: string) => {
    try {
      setTestingVoice(voice);
      const sampleText = settings.lang === 'hi' 
        ? 'नमस्ते, यह एक प्राकृतिक आवाज़ का परीक्षण है।'
        : 'Hello, this is a natural neural speech sample.';
      
      const res = await fetch('/api/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleText, voice }),
      });
      if (!res.ok) throw new Error('Preview failed');
      const data = await res.json();
      const audio = new Audio(data.url);
      audio.onended = () => setTestingVoice(null);
      audio.onerror = () => setTestingVoice(null);
      await audio.play();
    } catch {
      setTestingVoice(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
      {/* Header bar / Toggle */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">Dubbing Configuration & Audio Engine</h3>
            <p className="text-xs text-slate-400">
              Language: {selectedLang?.name || 'Auto'} · Ducking: {settings.mute ? 'Muted' : `${settings.duckDb} dB`} · Speed Limit: {settings.maxSpeed}x
            </p>
          </div>
        </div>

        <button className="text-slate-400 hover:text-white p-1">
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="p-5 border-t border-slate-800/80 space-y-6 bg-slate-950/40">
          {/* Row 1: Target Language & Voice Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Language Selection */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Target Language
              </label>
              <select
                value={settings.lang}
                onChange={(e) => {
                  const newLangCode = e.target.value;
                  const found = languages.find((l) => l.code === newLangCode);
                  onChange({
                    lang: newLangCode,
                    voiceMale: found?.maleVoice || settings.voiceMale,
                    voiceFemale: found?.femaleVoice || settings.voiceFemale,
                  });
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.name} ({l.nativeName})
                  </option>
                ))}
              </select>
            </div>

            {/* Male Voice Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Male Neural Voice
                </label>
                <button
                  type="button"
                  onClick={() => handleTestVoice(settings.voiceMale)}
                  disabled={testingVoice === settings.voiceMale}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {testingVoice === settings.voiceMale ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3 fill-current" />
                  )}
                  <span>Test Sample</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.voiceMale}
                onChange={(e) => onChange({ voiceMale: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                placeholder="e.g. hi-IN-MadhurNeural"
              />
            </div>

            {/* Female Voice Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Female Neural Voice
                </label>
                <button
                  type="button"
                  onClick={() => handleTestVoice(settings.voiceFemale)}
                  disabled={testingVoice === settings.voiceFemale}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {testingVoice === settings.voiceFemale ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3 fill-current" />
                  )}
                  <span>Test Sample</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.voiceFemale}
                onChange={(e) => onChange({ voiceFemale: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                placeholder="e.g. hi-IN-SwaraNeural"
              />
            </div>
          </div>

          {/* Row 2: Original Voice Ducking & Level Controls */}
          <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Ducking Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Original Speech Ducking
                </label>
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  {settings.mute ? 'MUTE (0%)' : `${settings.duckDb} dB`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Lowers original speaker volume inside speech zones
              </p>
              <input
                type="range"
                min={-60}
                max={0}
                step={1}
                disabled={settings.mute}
                value={settings.duckDb}
                onChange={(e) => onChange({ duckDb: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40"
              />
              <div className="flex items-center gap-2 mt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={settings.mute}
                    onChange={(e) => onChange({ mute: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>Fully Mute Original Voice in Speech Zones</span>
                </label>
              </div>
            </div>

            {/* Vocal Dub Gain */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Dubbed Voice Gain Boost
                </label>
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  {settings.dubGainDb > 0 ? `+${settings.dubGainDb}` : settings.dubGainDb} dB
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Adjust the volume balance of the newly synthesized vocals
              </p>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.5}
                value={settings.dubGainDb}
                onChange={(e) => onChange({ dubGainDb: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            {/* Time-stretch speed limit */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  Max Speed-Up Factor
                </label>
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  {settings.maxSpeed}x
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-2">
                Pitch-preserving stretch so speech fits inside each subtitle cue
              </p>
              <input
                type="range"
                min={1.0}
                max={2.5}
                step={0.1}
                value={settings.maxSpeed}
                onChange={(e) => onChange({ maxSpeed: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>
          </div>

          {/* Row 3: Acoustic Matching & Optional Instrumental Bed */}
          <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Pitch Matching Toggle */}
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="matchPitch"
                checked={settings.matchPitch}
                onChange={(e) => onChange({ matchPitch: e.target.checked })}
                className="mt-0.5 rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0"
              />
              <label htmlFor="matchPitch" className="cursor-pointer">
                <span className="block text-xs font-medium text-slate-200">
                  Acoustic Pitch Matching
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Nudges neural voice pitch toward the original speaker's median F0 Hz
                </span>
              </label>
            </div>

            {/* VAD Mode selector */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                VAD Speech Alignment Mode
              </label>
              <select
                value={settings.vadMode}
                onChange={(e) => onChange({ vadMode: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="cue">Smart Cue + VAD (Recommended)</option>
                <option value="intersect">VAD Clamped to Cues (Strict)</option>
                <option value="pure">Pure Audio VAD</option>
              </select>
            </div>

            {/* Output Format */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Output Audio Format
              </label>
              <div className="flex items-center gap-2">
                {(['mp3', 'wav', 'm4a'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => onChange({ outputFormat: fmt })}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg uppercase transition-colors cursor-pointer ${
                      settings.outputFormat === fmt
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 4: Optional Instrumental Track Upload */}
          <div className="pt-4 border-t border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-emerald-400" />
                  Optional: Background / Instrumental Track (Bed)
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  If you have an isolated instrumental stem, uploading it provides 100% clean voice replacement with zero original vocal residue.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {bedFile ? (
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs">
                    <span className="text-emerald-400 font-medium truncate max-w-[160px]">{bedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => onBedFileChange(null)}
                      className="text-slate-500 hover:text-rose-400 text-xs ml-1"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:text-white cursor-pointer transition-colors">
                    <span>Upload Bed Audio</span>
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) onBedFileChange(e.target.files[0]);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
