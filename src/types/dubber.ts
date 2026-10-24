export interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
  gender?: 'male' | 'female' | 'unknown' | null;
  voice?: string | null;
}

export interface SpeechSegment {
  start: number;
  end: number;
  pitch_hz: number;
  gender: string;
  expression: string;
  rms_db: number;
  voiced: boolean;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  maleVoice: string;
  femaleVoice: string;
}

export interface DubbingSettings {
  lang: string;
  voiceMale: string;
  voiceFemale: string;
  duckDb: number;
  mute: boolean;
  vadMode: 'cue' | 'intersect' | 'pure';
  vadGateDb: number;
  noVad: boolean;
  matchPitch: boolean;
  maxSpeed: number;
  dubGainDb: number;
  outputFormat: 'mp3' | 'wav' | 'm4a';
}

export interface JobLog {
  timestamp: string;
  message: string;
  type?: string;
}

export interface DubbingJobState {
  id: string;
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  currentMessage: string;
  cues: Cue[];
  segments: SpeechSegment[];
  logs: JobLog[];
  duration?: number;
  error?: string;
  audioFilename?: string;
}
