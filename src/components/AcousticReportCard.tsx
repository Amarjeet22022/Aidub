import React from 'react';
import { Activity, Mic, Volume2, Sparkles, BarChart2, Download } from 'lucide-react';
import { SpeechSegment } from '../types/dubber';

interface AcousticReportCardProps {
  segments: SpeechSegment[];
  onDownloadReport: () => void;
}

export const AcousticReportCard: React.FC<AcousticReportCardProps> = ({
  segments,
  onDownloadReport,
}) => {
  if (segments.length === 0) return null;

  const validPitches = segments.filter((s) => s.pitch_hz > 0).map((s) => s.pitch_hz);
  const medianF0 = validPitches.length > 0
    ? (validPitches.sort((a, b) => a - b)[Math.floor(validPitches.length / 2)]).toFixed(1)
    : '145.0';

  const maleCount = segments.filter((s) => s.gender === 'male').length;
  const femaleCount = segments.filter((s) => s.gender === 'female').length;
  const dominantGender = maleCount >= femaleCount ? 'Male Speaker' : 'Female Speaker';

  const expressions = segments.map((s) => s.expression);
  const dominantExpr = expressions[0] || 'normal';

  const formatSec = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    return `${min}:${sec.padStart(5, '0')}`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-white text-sm">Speaker Acoustic & Voice Analysis</h3>
        </div>
        <button
          onClick={onDownloadReport}
          className="text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-md border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Download className="w-3 h-3" />
          <span>Export JSON</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[11px] text-slate-500 block">Identified Gender</span>
          <span className="text-sm font-semibold text-white mt-0.5 block">{dominantGender}</span>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[11px] text-slate-500 block">Median Pitch (F0)</span>
          <span className="text-sm font-semibold text-emerald-400 font-mono mt-0.5 block">{medianF0} Hz</span>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[11px] text-slate-500 block">Vocal Expression</span>
          <span className="text-sm font-semibold text-teal-300 capitalize mt-0.5 block">{dominantExpr}</span>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <span className="text-[11px] text-slate-500 block">VAD Speech Zones</span>
          <span className="text-sm font-semibold text-slate-200 mt-0.5 block">{segments.length} detected</span>
        </div>
      </div>

      {/* Speech Zones Breakdown Table */}
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/60 text-xs">
        {segments.map((seg, idx) => (
          <div key={idx} className="p-2.5 flex items-center justify-between bg-slate-950/40 hover:bg-slate-800/30">
            <span className="font-mono text-slate-400">
              {formatSec(seg.start)} → {formatSec(seg.end)}
            </span>
            <span className="font-mono text-emerald-400">
              {seg.pitch_hz > 0 ? `${seg.pitch_hz} Hz` : 'N/A'}
            </span>
            <span className="text-slate-300 capitalize">{seg.gender}</span>
            <span className="text-teal-400 capitalize">{seg.expression}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
