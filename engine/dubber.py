#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dubber_engine.py - High Performance Voice-Aware Neural SRT Dubber Engine
Based on dubber_4323bf43.py with streaming JSON progress and optimized pitch analysis.
"""

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple, Dict, Any

import numpy as np

# Audio libraries
try:
    import soundfile as sf
except Exception as e:
    sf = None

try:
    import librosa
except Exception as e:
    librosa = None

try:
    import webrtcvad
except Exception as e:
    webrtcvad = None

try:
    import edge_tts
except Exception as e:
    edge_tts = None


# ============================================================================
#  FFmpeg Discovery and Helpers
# ============================================================================
FFMPEG = None

def find_ffmpeg() -> str:
    global FFMPEG
    if FFMPEG:
        return FFMPEG
    exe = shutil.which("ffmpeg")
    if exe:
        FFMPEG = exe
        return exe
    try:
        import imageio_ffmpeg
        FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
        return FFMPEG
    except Exception:
        pass
    sys.exit("ERROR: ffmpeg not found.")

def run_ffmpeg(args: List[str]) -> None:
    cmd = [find_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y"] + args
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(
            "ffmpeg failed:\n" + " ".join(cmd) + "\n" + proc.stderr.decode("utf-8", "ignore")
        )

def decode_audio(path: str, sr: int, mono: bool = True) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    try:
        run_ffmpeg(["-i", path, "-ac", "1" if mono else "2",
                    "-ar", str(sr), "-f", "wav", wav_path])
        data, _ = sf.read(wav_path, dtype="float32", always_2d=False)
        return data
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass

def probe_audio_info(path: str) -> Dict[str, Any]:
    """Get sample rate and duration in seconds."""
    info = {"sample_rate": 44100, "duration": 0.0}
    try:
        cmd = [find_ffmpeg(), "-hide_banner", "-i", path]
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stderr.decode("utf-8", "ignore")
        for line in out.splitlines():
            if "Audio:" in line and "Hz" in line:
                token = line.split("Hz")[0].strip().split(",")[-1].strip()
                info["sample_rate"] = int(float(token))
            if "Duration:" in line:
                m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", line)
                if m:
                    h, mm, s = m.groups()
                    info["duration"] = int(h) * 3600 + int(mm) * 60 + float(s)
    except Exception:
        pass
    return info


# ============================================================================
#  SRT Parsing
# ============================================================================
@dataclass
class Cue:
    index: int
    start: float
    end: float
    text: str
    gender: Optional[str] = None
    voice: Optional[str] = None

def _srt_time_to_seconds(t: str) -> float:
    t = t.strip().replace(",", ".")
    parts = t.split(":")
    if len(parts) == 3:
        hh, mm, ss = parts
        return int(hh) * 3600 + int(mm) * 60 + float(ss)
    elif len(parts) == 2:
        mm, ss = parts
        return int(mm) * 60 + float(ss)
    return float(t)

def _strip_srt_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\{\\[^}]*\}", "", s)
    s = s.replace("\u200b", "").strip()
    return s

def parse_srt(path: str) -> List[Cue]:
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw = f.read()

    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    blocks = [b for b in raw.split("\n\n") if b.strip()]
    cues: List[Cue] = []
    for b in blocks:
        lines = [ln for ln in b.split("\n") if ln.strip() != ""]
        if not lines:
            continue
        idx = len(cues) + 1
        if lines[0].strip().isdigit():
            idx = int(lines[0].strip())
            lines = lines[1:]
        if not lines or "-->" not in lines[0]:
            continue
        a, bb = lines[0].split("-->")
        start = _srt_time_to_seconds(a)
        end = _srt_time_to_seconds(bb.split()[0])
        text = " ".join(ln.strip() for ln in lines[1:])
        text = _strip_srt_tags(text)
        if text:
            cues.append(Cue(idx, start, end, text))
    return cues


# ============================================================================
#  Voice Activity Detection + Segment Analysis
# ============================================================================
@dataclass
class SpeechSeg:
    start: float
    end: float
    pitch_hz: float = 0.0
    gender: str = "unknown"
    expression: str = "normal"
    rms_db: float = -60.0
    voiced: bool = True

def vad_segments(audio_16k: np.ndarray, sr: int = 16000,
                 aggressiveness: int = 3,
                 frame_ms: int = 30,
                 min_speech: float = 0.20,
                 min_gap: float = 0.20,
                 pad: float = 0.05,
                 energy_gate_db: float = 6.0) -> List[Tuple[float, float]]:
    if webrtcvad is None:
        return []

    vad = webrtcvad.Vad(aggressiveness)
    pcm = (np.clip(audio_16k, -1.0, 1.0) * 32767.0).astype(np.int16)
    frame_len = int(sr * frame_ms / 1000)
    n_frames = len(pcm) // frame_len
    if n_frames == 0:
        return []

    fr = pcm[:n_frames * frame_len].astype(np.float32).reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(fr ** 2, axis=1) + 1e-9)
    rms_db = 20.0 * np.log10(rms / 32768.0 + 1e-9)
    floor = float(np.percentile(rms_db, 15))
    gate = floor + energy_gate_db

    flags = []
    raw = pcm.tobytes()
    for i in range(n_frames):
        chunk = raw[i * frame_len * 2:(i + 1) * frame_len * 2]
        is_sp = False
        if rms_db[i] >= gate:
            try:
                is_sp = vad.is_speech(chunk, sr)
            except Exception:
                is_sp = False
        flags.append(is_sp)

    segs: List[List[float]] = []
    gap_frames = int(min_gap * 1000 / frame_ms)
    run_start = None
    silence = 0
    for i, f in enumerate(flags):
        t = i * frame_ms / 1000.0
        if f:
            if run_start is None:
                run_start = t
            silence = 0
        else:
            if run_start is not None:
                silence += 1
                if silence > gap_frames:
                    segs.append([run_start, t - silence * frame_ms / 1000.0])
                    run_start = None
                    silence = 0
    if run_start is not None:
        segs.append([run_start, n_frames * frame_ms / 1000.0])

    out = []
    for s, e in segs:
        if e - s < min_speech:
            continue
        out.append((max(0.0, s - pad), e + pad))
    return out

def _merge(spans: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if not spans:
        return []
    spans = sorted(spans)
    out = [list(spans[0])]
    for s, e in spans[1:]:
        if s <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]

def speech_zones(cues: List[Cue], raw_vad: List[Tuple[float, float]],
                 mode: str = "cue") -> List[Tuple[float, float]]:
    cue_spans = [(c.start, c.end) for c in cues]
    if mode == "pure":
        return _merge(raw_vad)

    zones = []
    for cs, ce in cue_spans:
        zs, ze = cs, ce
        for vs, ve in raw_vad:
            if ve > cs and vs < ce:
                zs, ze = min(zs, vs), max(ze, ve)
        zones.append((zs, ze))

    if mode == "intersect":
        zones = []
        for cs, ce in cue_spans:
            for vs, ve in raw_vad:
                s, e = max(cs, vs), min(ce, ve)
                if e - s > 0.05:
                    zones.append((s, e))
    return _merge(zones)

def _speech_band(x: np.ndarray, sr: int, f_lo: float = 70.0, f_hi: float = 4000.0) -> np.ndarray:
    try:
        from scipy.signal import butter, sosfilt
        sos = butter(4, [f_lo / (sr / 2), min(0.99, f_hi / (sr / 2))],
                     btype="band", output="sos")
        return sosfilt(sos, x).astype(np.float32)
    except Exception:
        return x.astype(np.float32)

def _yin_f0(seg_audio: np.ndarray, sr: int) -> np.ndarray:
    """Robust F0 estimation using YIN algorithm."""
    if len(seg_audio) < 256:
        return np.array([])
    if sr > 16000:
        try:
            seg_audio = librosa.resample(seg_audio, orig_sr=sr, target_sr=16000)
            sr = 16000
        except Exception:
            pass

    y = _speech_band(seg_audio, sr)
    frame_len = min(1024, len(y))
    if frame_len < 256:
        return np.array([])
    hop = max(128, frame_len // 4)
    
    try:
        f0 = librosa.yin(y, fmin=65, fmax=380, sr=sr, frame_length=frame_len, hop_length=hop)
        f0 = f0[(f0 >= 70) & (f0 <= 350)]
        return f0
    except Exception:
        return np.array([])

def _drop_background(vals: np.ndarray, exclude: Tuple[float, ...]) -> np.ndarray:
    if not exclude or len(vals) == 0:
        return vals
    keep = np.array([v for v in vals if all(abs(v - ex) / ex > 0.06 for ex in exclude)])
    if len(keep) >= max(3, int(0.15 * len(vals))):
        return keep
    return vals

def _median_pitch(seg_audio: np.ndarray, sr: int, exclude: Tuple[float, ...] = ()) -> float:
    if librosa is None or len(seg_audio) < sr * 0.05:
        return 0.0
    try:
        f0 = _yin_f0(seg_audio, sr)
        if len(f0) == 0:
            return 0.0
        vals = _drop_background(f0, exclude)
        if len(vals) == 0:
            return 0.0
        return float(np.median(vals))
    except Exception:
        return 0.0

def _pitch_std_semitones(seg_audio: np.ndarray, sr: int, exclude: Tuple[float, ...] = ()) -> float:
    if librosa is None or len(seg_audio) < sr * 0.05:
        return 0.0
    try:
        f0 = _yin_f0(seg_audio, sr)
        vals = _drop_background(f0, exclude)
        vals = vals[vals > 0]
        if len(vals) < 3:
            return 0.0
        med = float(np.median(vals))
        if med <= 0:
            return 0.0
        st = 12.0 * np.log2(vals / med)
        return float(np.std(st))
    except Exception:
        return 0.0

def _rms_db(x: np.ndarray) -> float:
    if len(x) == 0:
        return -60.0
    r = float(np.sqrt(np.mean(np.square(x)) + 1e-12))
    return 20.0 * np.log10(r + 1e-12)

def classify_gender(pitch_hz: float) -> str:
    if pitch_hz <= 0:
        return "unknown"
    return "male" if pitch_hz < 165.0 else "female"

def classify_expression(rms_db: float, f0_std_st: float,
                        pitch_hz: float, baseline_hz: float) -> str:
    loud = rms_db > -20.0
    soft = rms_db < -30.0
    high_var = f0_std_st > 2.5
    low_var = f0_std_st < 1.2
    high_pitch = pitch_hz > baseline_hz + 20.0

    if loud and high_var:
        return "angry"
    if loud and high_pitch:
        return "joy"
    if loud:
        return "excited"
    if soft and low_var:
        return "sad"
    return "normal"

def _background_pitches(audio: np.ndarray, sr: int,
                        zones: List[Tuple[float, float]],
                        max_seconds: float = 3.0) -> Tuple[float, ...]:
    if librosa is None or len(audio) == 0:
        return ()
    n = len(audio)
    mask = np.ones(n, dtype=bool)
    for s, e in zones:
        mask[max(0, int(s * sr)):min(n, int(e * sr))] = False

    runs = []
    i = 0
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)

    vals = []
    used = 0
    for i, j in runs:
        if used >= max_seconds * sr:
            break
        seg = audio[i:j]
        if len(seg) < int(0.2 * sr):
            continue
        try:
            f0 = _yin_f0(seg, sr)
            vals.extend(f0.tolist())
        except Exception:
            pass
        used += len(seg)

    if not vals:
        return ()
    vals = np.asarray(vals)
    q = np.round(vals / 8.0) * 8.0
    uniq, counts = np.unique(q, return_counts=True)
    cands = [float(u) for u, c in zip(uniq, counts) if c > 0.08 * len(vals)]
    return tuple(cands)

def analyze_segments(audio_native: np.ndarray, sr_native: int,
                     segs: List[Tuple[float, float]]) -> List[SpeechSeg]:
    exclude = _background_pitches(audio_native, sr_native, segs)
    result: List[SpeechSeg] = []
    pitches = []
    raw = []
    for s, e in segs:
        i0 = int(s * sr_native)
        i1 = int(e * sr_native)
        chunk = audio_native[i0:i1]
        p = _median_pitch(chunk, sr_native, exclude)
        st = _pitch_std_semitones(chunk, sr_native, exclude)
        rms = _rms_db(chunk)
        raw.append((s, e, p, st, rms))
        if p > 0:
            pitches.append(p)

    baseline = float(np.median(pitches)) if pitches else 150.0

    for s, e, p, st, rms in raw:
        gender = classify_gender(p)
        expr = classify_expression(rms, st, p if p > 0 else baseline, baseline)
        result.append(SpeechSeg(start=round(s, 3), end=round(e, 3),
                                pitch_hz=round(p, 1), gender=gender,
                                expression=expr, rms_db=round(rms, 1)))
    return result


# ============================================================================
#  TTS Voices Catalog & Synthesis
# ============================================================================
VOICE_MAP: Dict[str, Tuple[str, str]] = {
    "hi": ("hi-IN-MadhurNeural", "hi-IN-SwaraNeural"),
    "en": ("en-US-GuyNeural", "en-US-JennyNeural"),
    "en-IN": ("en-IN-PrabhatNeural", "en-IN-NeerjaNeural"),
    "es": ("es-ES-AlvaroNeural", "es-ES-ElviraNeural"),
    "fr": ("fr-FR-HenriNeural", "fr-FR-DeniseNeural"),
    "de": ("de-DE-ConradNeural", "de-DE-KatjaNeural"),
    "ja": ("ja-JP-KeitaNeural", "ja-JP-NanamiNeural"),
    "zh": ("zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural"),
    "bn": ("bn-IN-BashkarNeural", "bn-IN-TanishaaNeural"),
    "ta": ("ta-IN-ValluvarNeural", "ta-IN-PallaviNeural"),
    "te": ("te-IN-MohanNeural", "te-IN-ShrutiNeural"),
    "mr": ("mr-IN-ManoharNeural", "mr-IN-AarohiNeural"),
    "gu": ("gu-IN-NiranjanNeural", "gu-IN-DhwaniNeural"),
    "kn": ("kn-IN-GaganNeural", "kn-IN-SapnaNeural"),
    "ml": ("ml-IN-MidhunNeural", "ml-IN-SobhanaNeural"),
    "ur": ("ur-IN-SalmanNeural", "ur-IN-GulNeural"),
    "ar": ("ar-SA-HamedNeural", "ar-SA-ZariyahNeural"),
    "ru": ("ru-RU-DmitryNeural", "ru-RU-SvetlanaNeural"),
    "pt": ("pt-BR-AntonioNeural", "pt-BR-FranciscaNeural"),
    "it": ("it-IT-DiegoNeural", "it-IT-ElsaNeural"),
    "ko": ("ko-KR-InJoonNeural", "ko-KR-SunHiNeural"),
    "tr": ("tr-TR-AhmetNeural", "tr-TR-EmelNeural"),
}

EXPRESSION_PROFILE = {
    "normal":  ("+0%",  "+0Hz",   "+0%"),
    "joy":     ("+8%",  "+18Hz",  "+8%"),
    "excited": ("+14%", "+12Hz",  "+14%"),
    "angry":   ("+12%", "+26Hz",  "+22%"),
    "sad":     ("-10%", "-16Hz",  "-8%"),
}

def detect_lang_from_text(text: str) -> str:
    counts: Dict[str, int] = {}
    for ch in text:
        try:
            name = unicodedata.name(ch)
        except ValueError:
            continue
        for tag, code in (("DEVANAGARI", "hi"), ("BENGALI", "bn"),
                          ("TAMIL", "ta"), ("TELUGU", "te"),
                          ("KANNADA", "kn"), ("MALAYALAM", "ml"),
                          ("GUJARATI", "gu"), ("GURMUKHI", "pa"),
                          ("ARABIC", "ur"), ("CJK", "zh"),
                          ("HIRAGANA", "ja"), ("KATAKANA", "ja"),
                          ("HANGUL", "ko"), ("CYRILLIC", "ru")):
            if tag in name:
                counts[code] = counts.get(code, 0) + 1
    if counts:
        return max(counts, key=counts.get)
    return "en"

async def _edge_tts_call(text: str, voice: str, rate: str, pitch: str, volume: str,
                         output_file: str, proxy: Optional[str]) -> None:
    kw = {}
    if proxy:
        kw["proxy"] = proxy
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume, **kw)
    await communicate.save(output_file)

def tts_to_array(text: str, voice: str, rate: str, pitch: str, volume: str,
                 sr_out: int, proxy: Optional[str]) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        mp3 = tmp.name
    try:
        asyncio.run(_edge_tts_call(text, voice, rate, pitch, volume, mp3, proxy))
        if not os.path.exists(mp3) or os.path.getsize(mp3) == 0:
            raise RuntimeError("TTS returned empty audio")
        arr = decode_audio(mp3, sr_out)
        return arr
    finally:
        try:
            os.remove(mp3)
        except OSError:
            pass

def time_stretch(arr: np.ndarray, sr: int, target_len: int,
                 max_speed: float = 1.6) -> np.ndarray:
    n = len(arr)
    if n == 0 or target_len <= 0 or n <= target_len:
        return arr
    factor = n / target_len
    factor = min(factor, max_speed)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as ti:
        in_wav = ti.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as to:
        out_wav = to.name
    try:
        sf.write(in_wav, arr, sr)
        filters = []
        f = factor
        while f > 2.0:
            filters.append("atempo=2.0")
            f /= 2.0
        filters.append(f"atempo={f:.4f}")
        run_ffmpeg(["-i", in_wav, "-filter:a", ",".join(filters),
                    "-ar", str(sr), out_wav])
        out, _ = sf.read(out_wav, dtype="float32")
        return out
    finally:
        for p in (in_wav, out_wav):
            try:
                os.remove(p)
            except OSError:
                pass

def apply_fades(arr: np.ndarray, sr: int, fade_ms: float = 8.0) -> np.ndarray:
    n = len(arr)
    k = min(int(sr * fade_ms / 1000.0), n // 2)
    if k <= 0:
        return arr
    arr = arr.copy()
    arr[:k] *= np.linspace(0.0, 1.0, k)
    arr[-k:] *= np.linspace(1.0, 0.0, k)
    return arr

def _best_segment(cue: Cue, segments: List[SpeechSeg]) -> Optional[SpeechSeg]:
    best = None
    best_ov = 0.0
    for s in segments:
        ov = max(0.0, min(cue.end, s.end) - max(cue.start, s.start))
        if ov > best_ov:
            best_ov, best = ov, s
    if best is None and segments:
        for s in segments:
            d = min(abs(cue.start - s.end), abs(s.start - cue.end))
            if best is None or d < best_ov:
                best, best_ov = s, d
    return best


# ============================================================================
#  JSON Event Logging Helper
# ============================================================================
def emit_event(event_type: str, data: Dict[str, Any], json_stream: bool = False):
    payload = {"type": event_type, **data}
    if json_stream:
        print(f"__DUBBER_EVENT__:{json.dumps(payload, ensure_ascii=False)}", flush=True)
    else:
        if event_type == "step":
            print(f"• [{data.get('step', '')}] {data.get('message', '')}", flush=True)


# ============================================================================
#  Dub Pipeline Execution
# ============================================================================
def run_dubbing(args):
    json_stream = getattr(args, "json_stream", False)

    emit_event("step", {"step": "reading_srt", "progress": 5, "message": "Reading and parsing SRT subtitle cues..."}, json_stream)
    cues = parse_srt(args.srt)
    if not cues:
        raise ValueError("No subtitle cues found in SRT file.")

    emit_event("cues_parsed", {"count": len(cues), "cues": [asdict(c) for c in cues]}, json_stream)

    if not args.lang:
        detected = detect_lang_from_text(" ".join(c.text for c in cues))
        args.lang = detected
    emit_event("lang_detected", {"lang": args.lang}, json_stream)

    # Decode original audio
    emit_event("step", {"step": "decoding_audio", "progress": 15, "message": "Decoding input audio waveform..."}, json_stream)
    audio_info = probe_audio_info(args.audio)
    sr_native = audio_info["sample_rate"]
    audio_native = decode_audio(args.audio, sr_native, mono=True)
    total_audio_sec = len(audio_native) / sr_native

    # Voice Activity Detection
    emit_event("step", {"step": "vad", "progress": 25, "message": "Running Voice Activity Detection (VAD)..."}, json_stream)
    if args.no_vad:
        zones = [(c.start, c.end) for c in cues]
        raw_vad = []
    else:
        audio_16k = decode_audio(args.audio, 16000, mono=True)
        raw_vad = vad_segments(audio_16k, 16000, energy_gate_db=args.vad_gate_db)
        zones = speech_zones(cues, raw_vad, mode=args.vad_mode)

    emit_event("step", {"step": "analyzing_voice", "progress": 35, "message": f"Analyzing speaker pitch, gender, and expression ({len(zones)} zones)..."}, json_stream)
    segments = analyze_segments(audio_native, sr_native, zones)
    emit_event("analysis_completed", {"segments": [asdict(s) for s in segments]}, json_stream)

    if args.report:
        with open(args.report, "w", encoding="utf-8") as rf:
            json.dump([asdict(s) for s in segments], rf, indent=2, ensure_ascii=False)

    if getattr(args, "analyze_only", False):
        emit_event("complete", {"message": "Voice analysis complete", "segments": [asdict(s) for s in segments]}, json_stream)
        return

    # Base track preparation
    n = len(audio_native)
    out = audio_native.astype(np.float32).copy()

    if getattr(args, "bed", None) and os.path.isfile(args.bed):
        emit_event("step", {"step": "ducking", "progress": 45, "message": f"Using supplied instrumental track '{os.path.basename(args.bed)}'"}, json_stream)
        bed = decode_audio(args.bed, sr_native)
        if len(bed) < n:
            bed = np.pad(bed, (0, n - len(bed)))
        out = bed[:n].astype(np.float32).copy()
    else:
        gain_db = -120.0 if args.mute else args.duck_db
        emit_event("step", {"step": "ducking", "progress": 45, "message": f"Ducking original dialogue in speech zones ({gain_db:.1f} dB)..."}, json_stream)
        g = 10.0 ** (gain_db / 20.0)
        ramp = max(1, int(sr_native * 0.012))
        for seg in segments:
            i0 = max(0, int(seg.start * sr_native))
            i1 = min(n, int(seg.end * sr_native))
            if i1 <= i0:
                continue
            env = np.full(i1 - i0, g, dtype=np.float32)
            r = min(ramp, (i1 - i0) // 2)
            if r > 0:
                env[:r] = np.linspace(1.0, g, r)
                env[-r:] = np.linspace(g, 1.0, r)
            out[i0:i1] *= env

    # Synthesis loop
    total_cues = len(cues)
    emit_event("step", {"step": "synthesis", "progress": 50, "message": f"Synthesizing {total_cues} dubbed voice cues with neural TTS..."}, json_stream)

    default_male, default_female = VOICE_MAP.get(args.lang, VOICE_MAP["hi"])
    male_voice = args.voice_male or default_male
    female_voice = args.voice_female or default_female

    for idx, cue in enumerate(cues, 1):
        seg = _best_segment(cue, segments)
        gender = cue.gender or (seg.gender if seg else "unknown")
        expr = seg.expression if seg else "normal"

        if cue.voice:
            voice = cue.voice
        elif gender == "male":
            voice = male_voice
        elif gender == "female":
            voice = female_voice
        else:
            voice = args.default_voice or male_voice

        rate, pitch, volume = EXPRESSION_PROFILE.get(expr, EXPRESSION_PROFILE["normal"])

        if args.match_pitch and seg and seg.pitch_hz > 0:
            base = 120.0 if gender == "male" else 210.0
            offset = float(np.clip(seg.pitch_hz - base, -40, 40))
            expr_pitch = float(pitch.replace("Hz", "").replace("+", "") or 0)
            total = float(np.clip(offset + expr_pitch, -60, 60))
            pitch = f"{total:+.0f}Hz"

        cue_progress = 50 + int((idx / total_cues) * 38)
        emit_event("cue_progress", {
            "index": cue.index,
            "current": idx,
            "total": total_cues,
            "progress": cue_progress,
            "text": cue.text[:50] + ("..." if len(cue.text) > 50 else ""),
            "voice": voice,
            "gender": gender,
            "expression": expr,
            "pitch": pitch,
            "rate": rate,
            "message": f"Synthesizing cue {idx}/{total_cues}: '{cue.text[:30]}...' ({gender}/{expr})"
        }, json_stream)

        try:
            clip = tts_to_array(cue.text, voice, rate, pitch, volume, sr_native, args.proxy)
            target = int((cue.end - cue.start) * sr_native)
            clip = time_stretch(clip, sr_native, target, args.max_speed)
            clip = apply_fades(clip, sr_native)

            i0 = max(0, int(cue.start * sr_native))
            i1 = min(n, i0 + len(clip))
            if i1 > i0:
                out[i0:i1] += clip[: i1 - i0] * (10.0 ** (args.dub_gain_db / 20.0))
        except Exception as e:
            emit_event("cue_error", {"index": cue.index, "error": str(e)}, json_stream)

    # Normalization & soft clipping
    emit_event("step", {"step": "final_mixing", "progress": 90, "message": "Applying master limiter and rendering output..."}, json_stream)
    peak = float(np.max(np.abs(out))) if len(out) else 1.0
    if peak > 0.999:
        out = out * (0.99 / peak)

    ext = os.path.splitext(args.output)[1].lower().lstrip(".") or "wav"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        sf.write(tmp_wav, out, sr_native)
        if ext == "wav":
            shutil.copy(tmp_wav, args.output)
        else:
            codec = {"mp3": ["-codec:a", "libmp3lame", "-q:a", "2"],
                     "m4a": ["-codec:a", "aac", "-b:a", "192k"],
                     "aac": ["-codec:a", "aac", "-b:a", "192k"],
                     "ogg": ["-codec:a", "libvorbis", "-q:a", "5"]}.get(ext, ["-codec:a", "libmp3lame", "-q:a", "2"])
            run_ffmpeg(["-i", tmp_wav] + codec + [args.output])
    finally:
        try:
            os.remove(tmp_wav)
        except OSError:
            pass

    emit_event("complete", {
        "progress": 100,
        "output": args.output,
        "duration": round(total_audio_sec, 2),
        "cues_count": total_cues,
        "segments_count": len(segments),
        "message": "Dubbed audio rendered successfully!"
    }, json_stream)


# ============================================================================
#  Main CLI Dispatcher
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description="Voice-Aware SRT Audio Dubber Engine")
    parser.add_argument("--action", choices=["dub", "parse-srt", "preview", "list-voices"], default="dub")
    parser.add_argument("--audio", help="Input original audio file")
    parser.add_argument("--srt", help="Input SRT subtitle file")
    parser.add_argument("--output", default="dubbed.mp3", help="Output audio file")
    parser.add_argument("--lang", default=None, help="Target language code")
    parser.add_argument("--voice-male", default=None, help="Male neural TTS voice")
    parser.add_argument("--voice-female", default=None, help="Female neural TTS voice")
    parser.add_argument("--default-voice", default=None, help="Fallback voice")
    parser.add_argument("--duck-db", type=float, default=-18.0, help="Original voice ducking in dB")
    parser.add_argument("--mute", action="store_true", help="Fully mute original voice in speech zones")
    parser.add_argument("--bed", default=None, help="Instrumental/background track")
    parser.add_argument("--dub-gain-db", type=float, default=0.0, help="Gain applied to dubbed vocals (dB)")
    parser.add_argument("--vad-mode", choices=["cue", "intersect", "pure"], default="cue")
    parser.add_argument("--vad-gate-db", type=float, default=6.0)
    parser.add_argument("--no-vad", action="store_true")
    parser.add_argument("--match-pitch", action="store_true", default=True)
    parser.add_argument("--no-match-pitch", dest="match_pitch", action="store_false")
    parser.add_argument("--max-speed", type=float, default=1.6)
    parser.add_argument("--proxy", default=None)
    parser.add_argument("--report", default=None)
    parser.add_argument("--analyze-only", action="store_true")
    parser.add_argument("--json-stream", action="store_true", help="Emit parseable JSON progress lines")
    parser.add_argument("--text", default="Hello from neural voice", help="Text for single preview")
    parser.add_argument("--voice", default="en-US-GuyNeural", help="Voice for single preview")

    args = parser.parse_args()

    if args.action == "list-voices":
        print(json.dumps(VOICE_MAP, indent=2))
        return

    if args.action == "parse-srt":
        if not args.srt or not os.path.isfile(args.srt):
            sys.exit("Error: --srt file path required.")
        cues = parse_srt(args.srt)
        lang = detect_lang_from_text(" ".join(c.text for c in cues))
        print(json.dumps({"language": lang, "cues": [asdict(c) for c in cues]}, ensure_ascii=False))
        return

    if args.action == "preview":
        if not args.output:
            args.output = "preview.mp3"
        asyncio.run(_edge_tts_call(args.text, args.voice, "+0%", "+0Hz", "+0%", args.output, args.proxy))
        print(f"Preview saved to {args.output}")
        return

    # Normal Dubbing Action
    run_dubbing(args)

if __name__ == "__main__":
    main()
