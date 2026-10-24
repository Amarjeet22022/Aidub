#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dubber.py  —  Voice-aware SRT dubber
=====================================

What it does (exactly the pipeline you described):

  1. Reads an AUDIO file (original, e.g. Chinese speech + background music/SFX).
  2. Reads an SRT file whose cues are the TRANSLATED text (e.g. Hindi) on the
     same timeline as the original speech.
  3. Runs Voice Activity Detection (VAD) on the audio to find every region that
     contains a human voice, and for each region it records:
        - timeline (start / end)
        - pitch (median F0 in Hz)
        - gender (male / female, inferred from pitch)
        - expression (normal / joy / excited / angry / sad)
  4. Speaks each SRT cue with a neural TTS voice that MATCHES the detected
     gender, pitch and expression, and time-fits it inside the cue's timeline.
  5. Builds the output audio:
        - speech regions  -> original voice muted/ducked + the new dub placed in
        - non-speech regions (music, ambience, silence) -> left UNCHANGED
     The result is the SAME LENGTH as the input audio.
  6. Writes the processed audio file (wav / mp3 / m4a ...).

Dependencies:
    pip install -r requirements.txt
    System: ffmpeg must be on PATH (or `pip install imageio-ffmpeg` as a fallback).
    Internet: edge-tts talks to Microsoft's neural TTS endpoint (free).

Basic use:
    python dubber.py --audio original.mp3 --srt hindi.srt --output dubbed.mp3

Useful options:
    --analyze-only            just print the voice report, do not dub
    --voice-male  hi-IN-MadhurNeural
    --voice-female hi-IN-SwaraNeural
    --duck-db -18             how much to lower the ORIGINAL voice in speech zones
                              (0 = leave it, -60 ~= fully mute). Default -18 dB.
    --mute                    fully mute the original inside speech zones
    --bed instr.wav           mix onto a separate instrumental/background track
                              (cleanest removal of the original voice)
    --vad-mode cue            cue | intersect | pure  (how VAD + SRT combine)
    --no-vad                  skip audio VAD, use SRT cue times as speech zones
    --proxy URL               HTTP(S) proxy for the TTS endpoint (optional)

Author: built for Amar.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import wave
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple

import numpy as np

# ----------------------------------------------------------------------------
#  Optional third-party imports are done lazily / defensively so that
#  --analyze-only style partial runs still give a clear error message.
# ----------------------------------------------------------------------------
try:
    import soundfile as sf
except Exception:  # pragma: no cover
    sf = None

try:
    import librosa
except Exception:  # pragma: no cover
    librosa = None

try:
    import webrtcvad
except Exception:  # pragma: no cover
    webrtcvad = None


# ============================================================================
#  ffmpeg discovery
# ============================================================================
def find_ffmpeg() -> str:
    """Return a usable ffmpeg executable path."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    sys.exit(
        "ERROR: ffmpeg not found.\n"
        "  Install it (apt: 'sudo apt install ffmpeg', mac: 'brew install ffmpeg',\n"
        "  windows: https://www.gyan.dev/ffmpeg/builds/) or run:\n"
        "      pip install imageio-ffmpeg"
    )


FFMPEG = None  # resolved lazily / set in main()


def _ff() -> str:
    global FFMPEG
    if FFMPEG is None:
        FFMPEG = find_ffmpeg()
    return FFMPEG


def run_ffmpeg(args: List[str]) -> None:
    """Run ffmpeg quietly; raise with stderr on failure."""
    cmd = [_ff(), "-hide_banner", "-loglevel", "error", "-y"] + args
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(
            "ffmpeg failed:\n" + " ".join(cmd) + "\n" + proc.stderr.decode("utf-8", "ignore")
        )


def decode_audio(path: str, sr: int, mono: bool = True) -> np.ndarray:
    """Decode any audio file to a float32 numpy array at sample-rate `sr`."""
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


def probe_sample_rate(path: str) -> int:
    """Return the native sample rate of the input audio."""
    try:
        out = subprocess.run(
            [_ff(), "-hide_banner", "-i", path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stderr.decode("utf-8", "ignore")
        for line in out.splitlines():
            if "Audio:" in line and "Hz" in line:
                token = line.split("Hz")[0].strip().split(",")[-1].strip()
                return int(float(token))
    except Exception:
        pass
    return 44100


# ============================================================================
#  SRT parsing
# ============================================================================
@dataclass
class Cue:
    index: int
    start: float          # seconds
    end: float            # seconds
    text: str


def _srt_time_to_seconds(t: str) -> float:
    t = t.strip().replace(",", ".")
    hh, mm, ss = t.split(":")
    return int(hh) * 3600 + int(mm) * 60 + float(ss)


def parse_srt(path: str) -> List[Cue]:
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw = f.read()

    # Normalise newlines, split on blank lines into blocks.
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    blocks = [b for b in raw.split("\n\n") if b.strip()]
    cues: List[Cue] = []
    for b in blocks:
        lines = [ln for ln in b.split("\n") if ln.strip() != ""]
        if not lines:
            continue
        # First line may be the numeric index.
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


def _strip_srt_tags(s: str) -> str:
    import re
    s = re.sub(r"<[^>]+>", "", s)          # <i> <b> <font ...> etc.
    s = re.sub(r"\{\\[^}]*\}", "", s)       # {\an8} style tags
    s = s.replace("\u200b", "").strip()
    return s


# ============================================================================
#  Voice Activity Detection + per-segment analysis
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
    """Return a list of (start, end) seconds where a human voice is present.

    A frame counts as voice only if BOTH:
      - webrtcvad flags it as speech, and
      - its energy is at least `energy_gate_db` above the file's noise floor.
    The energy gate stops steady background music/ambience from being
    reported as voice.
    """
    if webrtcvad is None:
        raise RuntimeError("webrtcvad not installed -> pip install webrtcvad-wheels")

    vad = webrtcvad.Vad(aggressiveness)
    pcm = (np.clip(audio_16k, -1.0, 1.0) * 32767.0).astype(np.int16)
    frame_len = int(sr * frame_ms / 1000)   # samples
    n_frames = len(pcm) // frame_len

    # per-frame RMS (dB) for the energy gate
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

    # Merge frame flags into segments, bridging short gaps.
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

    # Filter short segments and pad.
    out = []
    for s, e in segs:
        if e - s < min_speech:
            continue
        out.append((max(0.0, s - pad), e + pad))
    return out


def speech_zones(cues: List["Cue"], raw_vad: List[Tuple[float, float]],
                 mode: str = "cue") -> List[Tuple[float, float]]:
    """Decide which time spans hold the ORIGINAL speech that must be replaced.

    mode = 'cue'       : the SRT cue spans ARE the speech zones (most reliable,
                         because the SRT is aligned to the original speech).
                         Any VAD segment overlapping a cue is merged in, so a
                         little speech bleeding past the cue is still covered.
    mode = 'intersect' : VAD segments, clipped to the cue spans (drops VAD
                         regions that fall outside any cue -> i.e. music).
    mode = 'pure'      : raw VAD segments only.
    """
    cue_spans = [(c.start, c.end) for c in cues]

    if mode == "pure":
        return _merge(raw_vad)

    zones = []
    for cs, ce in cue_spans:
        zs, ze = cs, ce
        for vs, ve in raw_vad:
            # merge any VAD segment that overlaps this cue
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


def _speech_band(x: np.ndarray, sr: int, f_lo: float = 70.0,
                 f_hi: float = 4000.0) -> np.ndarray:
    """Band-limit to the speech range to keep rumble/bass out of pitch analysis."""
    try:
        from scipy.signal import butter, sosfilt
        sos = butter(4, [f_lo / (sr / 2), min(0.99, f_hi / (sr / 2))],
                     btype="band", output="sos")
        return sosfilt(sos, x).astype(np.float32)
    except Exception:
        return x.astype(np.float32)


def _pyin_f0(seg_audio: np.ndarray, sr: int):
    """Return the raw F0 track (NaN where unvoiced) for a segment."""
    y = _speech_band(seg_audio, sr)
    # frame must hold >=2 periods of fmin (70 Hz); scale with sample rate
    frame_length = max(1024, int(2.0 * sr / 70.0) + 2)
    f0, _, _ = librosa.pyin(y, fmin=70, fmax=400, sr=sr,
                            frame_length=frame_length)
    return f0


def _median_pitch(seg_audio: np.ndarray, sr: int,
                  exclude: Tuple[float, ...] = ()) -> float:
    """Median F0 (Hz) of a short speech segment using librosa.pyin.

    `exclude` is a list of background/music pitches to ignore, so a tonal
    music bed does not hijack the speaker's measured pitch.
    """
    if librosa is None or len(seg_audio) < sr * 0.05:
        return 0.0
    try:
        f0 = _pyin_f0(seg_audio, sr)
        voiced = ~np.isnan(f0)
        # require enough actually-voiced frames, else the pitch is unreliable
        # (music/SFX zones otherwise return a bogus floor frequency)
        if voiced.mean() < 0.20:
            return 0.0
        vals = f0[voiced]
        vals = _drop_background(vals, exclude)
        if len(vals) == 0:
            return 0.0
        return float(np.median(vals))
    except Exception:
        return 0.0


def _drop_background(vals: np.ndarray, exclude: Tuple[float, ...]) -> np.ndarray:
    if not exclude or len(vals) == 0:
        return vals
    keep = np.array([v for v in vals
                     if all(abs(v - ex) / ex > 0.06 for ex in exclude)])
    # only trust the filter if it left a meaningful amount of data
    if len(keep) >= max(3, int(0.15 * len(vals))):
        return keep
    return vals


def _pitch_std_semitones(seg_audio: np.ndarray, sr: int,
                         exclude: Tuple[float, ...] = ()) -> float:
    if librosa is None or len(seg_audio) < sr * 0.05:
        return 0.0
    try:
        f0 = _pyin_f0(seg_audio, sr)
        vals = f0[~np.isnan(f0)]
        vals = _drop_background(vals, exclude)
        vals = vals[vals > 0]
        if len(vals) < 3:
            return 0.0
        st = 12.0 * np.log2(vals / np.median(vals))
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
    # Hindi/typical adult speech: ~85-165 Hz male, ~165-255 Hz female.
    return "male" if pitch_hz < 165.0 else "female"


def classify_expression(rms_db: float, f0_std_st: float,
                        pitch_hz: float, baseline_hz: float) -> str:
    """Heuristic emotion tag from loudness, pitch variability and pitch level."""
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
                        max_seconds: float = 4.0) -> Tuple[float, ...]:
    """Learn the dominant pitch(es) of the music/ambience in this file.

    We look at the time OUTSIDE the speech zones (pure background), estimate
    its F0, and return the frequencies that occur most often. Those are then
    excluded from the speaker's pitch measurement.
    """
    if librosa is None or len(audio) == 0:
        return ()
    n = len(audio)
    mask = np.ones(n, dtype=bool)
    for s, e in zones:
        mask[max(0, int(s * sr)):min(n, int(e * sr))] = False

    # contiguous background runs, longest first
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
            f0 = _pyin_f0(seg, sr)
            vals.extend(f0[~np.isnan(f0)].tolist())
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
    """Attach pitch / gender / expression to each speech zone."""
    exclude = _background_pitches(audio_native, sr_native, segs)
    if exclude:
        print(f"  background pitches detected (excluded): "
              f"{', '.join(f'{c:.0f}Hz' for c in exclude)}")

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
#  TTS (edge-tts) with gender + expression + pitch matching
# ============================================================================
VOICE_MAP = {
    # language -> (male_voice, female_voice)
    "hi": ("hi-IN-MadhurNeural", "hi-IN-SwaraNeural"),
    "en": ("en-IN-PrabhatNeural", "en-IN-NeerjaNeural"),
    "bn": ("bn-IN-BashkarNeural", "bn-IN-TanishaaNeural"),
    "ta": ("ta-IN-ValluvarNeural", "ta-IN-PallaviNeural"),
    "te": ("te-IN-MohanNeural", "te-IN-ShrutiNeural"),
    "mr": ("mr-IN-ManoharNeural", "mr-IN-AarohiNeural"),
    "gu": ("gu-IN-NiranjanNeural", "gu-IN-DhwaniNeural"),
    "kn": ("kn-IN-GaganNeural", "kn-IN-SapnaNeural"),
    "ml": ("ml-IN-MidhunNeural", "ml-IN-SobhanaNeural"),
    "ur": ("ur-IN-SalmanNeural", "ur-IN-GulNeural"),
    "zh": ("zh-CN-YunxiNeural", "zh-CN-XiaoxiaoNeural"),
}

# expression -> (rate %, pitch Hz, volume %)
EXPRESSION_PROFILE = {
    "normal":  ("+0%",  "+0Hz",   "+0%"),
    "joy":     ("+8%",  "+18Hz",  "+8%"),
    "excited": ("+14%", "+12Hz",  "+14%"),
    "angry":   ("+12%", "+26Hz",  "+22%"),
    "sad":     ("-10%", "-16Hz",  "-8%"),
}


def detect_lang_from_text(text: str) -> str:
    """Very small script-based guess for the SRT language."""
    counts = {}
    for ch in text:
        try:
            name = unicodedata.name(ch)
        except ValueError:
            continue
        for tag, code in (("DEVANAGARI", "hi"), ("BENGALI", "bn"),
                          ("TAMIL", "ta"), ("TELUGU", "te"),
                          ("KANNADA", "kn"), ("MALAYALAM", "ml"),
                          ("GUJARATI", "gu"), ("GURMUKHI", "pa"),
                          ("ARABIC", "ur"), ("CJK", "zh")):
            if tag in name:
                counts[code] = counts.get(code, 0) + 1
    if counts:
        return max(counts, key=counts.get)
    return "en"


def tts_to_array(text: str, voice: str, rate: str, pitch: str, volume: str,
                 sr_out: int, proxy: Optional[str]) -> np.ndarray:
    """Synthesise `text` with edge-tts and return float32 mono at sr_out."""
    import asyncio
    import edge_tts

    async def _go(path):
        kw = {}
        if proxy:
            kw["proxy"] = proxy
        c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch,
                                 volume=volume, **kw)
        await c.save(path)

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        mp3 = tmp.name
    try:
        asyncio.run(_go(mp3))
        if not os.path.getsize(mp3):
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
    """Speed the clip up (pitch-preserving) so it fits target_len samples."""
    n = len(arr)
    if n == 0 or target_len <= 0:
        return arr
    if n <= target_len:
        return arr  # already fits, keep natural pacing
    factor = n / target_len
    factor = min(factor, max_speed)
    # ffmpeg atempo preserves pitch; chain for factor > 2.
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


# ============================================================================
#  Build the dubbed track
# ============================================================================
def build_output(audio: np.ndarray, sr: int, cues: List[Cue],
                 segments: List[SpeechSeg], args) -> np.ndarray:
    """Return the final mixed audio (same length as `audio`)."""
    out = audio.astype(np.float32).copy()
    n = len(out)

    # --- 0. optional: start from a supplied background/instrumental bed ----
    # (this is the cleanest way to fully remove the original voice: pass the
    #  instrumental stem, and no ducking is needed)
    if getattr(args, "bed", None):
        bed = decode_audio(args.bed, sr)
        if len(bed) < n:
            bed = np.pad(bed, (0, n - len(bed)))
        out = bed[:n].astype(np.float32).copy()
        print(f"  using supplied bed '{args.bed}' as the base track")

    # --- 1. duck / mute the ORIGINAL voice inside speech regions -----------
    elif args.mute:
        gain_db = -120.0
    else:
        gain_db = args.duck_db

    if not getattr(args, "bed", None):
        g = 10.0 ** (gain_db / 20.0)
        ramp = max(1, int(sr * 0.012))  # 12 ms ramp

        for seg in segments:
            i0 = max(0, int(seg.start * sr))
            i1 = min(n, int(seg.end * sr))
            if i1 <= i0:
                continue
            # smooth ducking envelope
            env = np.full(i1 - i0, g, dtype=np.float32)
            r = min(ramp, (i1 - i0) // 2)
            if r > 0:
                env[:r] = np.linspace(1.0, g, r)
                env[-r:] = np.linspace(g, 1.0, r)
            out[i0:i1] *= env

    # --- 2. overlay the dubbed TTS on each SRT cue -------------------------
    # pick a voice per cue from the overlapping speech segment
    for cue in cues:
        seg = _best_segment(cue, segments)
        gender = seg.gender if seg else "unknown"
        expr = seg.expression if seg else "normal"

        male_v, female_v = VOICE_MAP.get(args.lang, VOICE_MAP["hi"])
        if args.voice_male:
            male_v = args.voice_male
        if args.voice_female:
            female_v = args.voice_female
        voice = male_v if gender == "male" else female_v if gender == "female" \
            else args.default_voice or male_v

        rate, pitch, volume = EXPRESSION_PROFILE.get(expr, EXPRESSION_PROFILE["normal"])

        # pitch matching: nudge the TTS toward the speaker's median pitch
        if args.match_pitch and seg and seg.pitch_hz > 0:
            base = 120.0 if gender == "male" else 210.0
            offset = float(np.clip(seg.pitch_hz - base, -40, 40))
            expr_pitch = float(pitch.replace("Hz", "").replace("+", "") or 0)
            total = float(np.clip(offset + expr_pitch, -60, 60))
            pitch = f"{total:+.0f}Hz"

        try:
            clip = tts_to_array(cue.text, voice, rate, pitch, volume, sr, args.proxy)
        except Exception as e:
            print(f"  ! TTS failed for cue {cue.index}: {e}")
            continue

        target = int((cue.end - cue.start) * sr)
        clip = time_stretch(clip, sr, target, args.max_speed)
        clip = apply_fades(clip, sr)

        i0 = max(0, int(cue.start * sr))
        i1 = min(n, i0 + len(clip))
        if i1 <= i0:
            continue
        out[i0:i1] += clip[: i1 - i0] * (10.0 ** (args.dub_gain_db / 20.0))

    # --- 3. soft clip / normalise to avoid distortion ----------------------
    peak = float(np.max(np.abs(out))) if len(out) else 1.0
    if peak > 0.999:
        out = out * (0.99 / peak)
    return out


def _best_segment(cue: Cue, segments: List[SpeechSeg]) -> Optional[SpeechSeg]:
    best = None
    best_ov = 0.0
    for s in segments:
        ov = max(0.0, min(cue.end, s.end) - max(cue.start, s.start))
        if ov > best_ov:
            best_ov, best = ov, s
    if best is None:  # fall back to nearest segment
        for s in segments:
            d = min(abs(cue.start - s.end), abs(s.start - cue.end))
            if best is None or d < best_ov:
                best, best_ov = s, d
    return best


# ============================================================================
#  Main
# ============================================================================
def fmt_ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    global FFMPEG
    ap = argparse.ArgumentParser(
        description="Voice-aware SRT dubber: replace original speech with a "
                    "gender/expression-matched TTS of the translated SRT text.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--audio", required=True, help="original audio file")
    ap.add_argument("--srt", required=True, help="translated SRT file")
    ap.add_argument("--output", default="dubbed_output.wav",
                    help="output file (extension sets the format: wav/mp3/m4a/aac/ogg)")
    ap.add_argument("--lang", default=None, help="SRT language code (auto if omitted)")
    ap.add_argument("--voice-male", default=None, help="override male TTS voice")
    ap.add_argument("--voice-female", default=None, help="override female TTS voice")
    ap.add_argument("--default-voice", default=None, help="voice when gender unknown")
    ap.add_argument("--analyze-only", action="store_true",
                    help="print the voice report and exit (no dubbing)")
    ap.add_argument("--no-vad", action="store_true",
                    help="use SRT cue times instead of audio VAD for speech zones")
    ap.add_argument("--vad-mode", choices=["cue", "intersect", "pure"], default="cue",
                    help="how VAD and SRT cues combine to define speech zones")
    ap.add_argument("--vad-gate-db", type=float, default=6.0,
                    help="energy floor (dB above noise floor) for a VAD frame to count")
    ap.add_argument("--duck-db", type=float, default=-18.0,
                    help="gain (dB) applied to the ORIGINAL voice in speech zones")
    ap.add_argument("--mute", action="store_true",
                    help="fully mute the original voice in speech zones")
    ap.add_argument("--bed", default=None,
                    help="optional background/instrumental track to mix onto "
                         "(same timeline as --audio); removes the original voice "
                         "completely. Produces the cleanest dub.")
    ap.add_argument("--dub-gain-db", type=float, default=0.0,
                    help="gain (dB) applied to the dubbed voice")
    ap.add_argument("--match-pitch", action="store_true", default=True,
                    help="nudge TTS pitch toward the speaker's median pitch")
    ap.add_argument("--no-match-pitch", dest="match_pitch", action="store_false")
    ap.add_argument("--max-speed", type=float, default=1.6,
                    help="max speed-up when a dub is too long for its cue")
    ap.add_argument("--proxy", default=os.environ.get("HTTPS_PROXY")
                    or os.environ.get("https_proxy"),
                    help="HTTP(S) proxy for the TTS endpoint")
    ap.add_argument("--report", default=None, help="write the voice report JSON here")
    args = ap.parse_args()

    FFMPEG = find_ffmpeg()

    for f in (args.audio, args.srt):
        if not os.path.isfile(f):
            sys.exit(f"ERROR: file not found: {f}")

    print("• Reading SRT ...")
    cues = parse_srt(args.srt)
    if not cues:
        sys.exit("ERROR: no cues parsed from SRT")
    print(f"  {len(cues)} cues, first cue {fmt_ts(cues[0].start)} -> {fmt_ts(cues[0].end)}")

    if args.lang is None:
        args.lang = detect_lang_from_text(" ".join(c.text for c in cues))
    print(f"  language detected: {args.lang}")

    sr_native = probe_sample_rate(args.audio)
    print(f"• Decoding audio (native {sr_native} Hz) ...")
    audio_native = decode_audio(args.audio, sr_native, mono=True)

    # ---- detect voice regions ---------------------------------------------
    if args.no_vad:
        raw_vad = []
        zones = [(c.start, c.end) for c in cues]
        print(f"• --no-vad: using SRT cue times as speech zones ({len(zones)} regions)")
    else:
        print("• Running voice activity detection ...")
        audio_16k = decode_audio(args.audio, 16000, mono=True)
        raw_vad = vad_segments(audio_16k, 16000,
                               energy_gate_db=args.vad_gate_db)
        zones = speech_zones(cues, raw_vad, mode=args.vad_mode)
        print(f"  raw VAD regions: {len(raw_vad)}  ->  speech zones used: "
              f"{len(zones)} (mode={args.vad_mode})")

    print("• Analysing pitch / gender / expression ...")
    segments = analyze_segments(audio_native, sr_native, zones)

    # ---- report ----
    print("\n  #   timeline                       pitch(Hz)  gender   expression")
    for i, s in enumerate(segments, 1):
        print(f"  {i:<3} {fmt_ts(s.start)} -> {fmt_ts(s.end)}   "
              f"{s.pitch_hz:>7.1f}   {s.gender:<8} {s.expression}")
    print()
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump([asdict(s) for s in segments], f, ensure_ascii=False, indent=2)
        print(f"  report written to {args.report}")

    if args.analyze_only:
        return

    print("• Synthesising dubbed speech and mixing ...")
    final = build_output(audio_native, sr_native, cues, segments, args)

    # ---- write output ----
    ext = os.path.splitext(args.output)[1].lower().lstrip(".") or "wav"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        sf.write(tmp_wav, final, sr_native)
        if ext == "wav":
            shutil.copy(tmp_wav, args.output)
        else:
            codec = {"mp3": ["-codec:a", "libmp3lame", "-q:a", "2"],
                     "m4a": ["-codec:a", "aac", "-b:a", "192k"],
                     "aac": ["-codec:a", "aac", "-b:a", "192k"],
                     "ogg": ["-codec:a", "libvorbis", "-q:a", "5"]}.get(ext)
            if codec is None:
                sys.exit(f"ERROR: unsupported output extension .{ext}")
            run_ffmpeg(["-i", tmp_wav] + codec + [args.output])
    finally:
        try:
            os.remove(tmp_wav)
        except OSError:
            pass

    print(f"\n✅ Done. Output written to: {args.output}")
    print("   Speech zones dubbed; music/ambience outside them left untouched; "
          "same length as the input.")


if __name__ == "__main__":
    main()
