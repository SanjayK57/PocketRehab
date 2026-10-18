/**
 * Voice coach output (speech synthesis) and optional voice commands (speech
 * recognition). Both are optional: captions always show the same text, and
 * every voice command has an on-screen button and a keyboard shortcut.
 */

/**
 * Spoken coaching has two engines:
 *  1. The PocketRehab coach voice (default): short studio-quality clips, one per
 *     sentence, generated ahead of time with ElevenLabs (`npm run voice-pack`)
 *     and served from this app's own files. Nothing is sent anywhere at runtime.
 *  2. The device's own speech synthesis, used when the user picks a device voice,
 *     or when a sentence has no clip (it never mixes engines inside one message).
 */

/** `voiceURI` value for "pick the best on-device system voice". `null` means the PocketRehab coach voice. */
export const DEVICE_VOICE_AUTO = 'device:auto';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && (typeof Audio !== 'undefined' || synthSupported());
}

function synthSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!synthSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
}

/**
 * Best-sounding English system voice that runs on the device (network voices
 * would send the coaching text to the browser maker, so they rank last).
 */
export function bestDeviceVoice(voices: SpeechSynthesisVoice[] = listVoices()): SpeechSynthesisVoice | undefined {
  const score = (v: SpeechSynthesisVoice) =>
    (v.localService ? 8 : 0) +
    (/\b(natural|neural|premium|enhanced|siri)\b/i.test(v.name) ? 4 : 0) +
    (/\b(samantha|ava|zoe|allison|susan|aria|jenny|serena|karen)\b/i.test(v.name) ? 2 : 0) +
    (v.lang === 'en-US' ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

/** Splits text into sentences: the unit a coach-voice clip covers. */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+[\u201d\u2019"')]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

interface VoicePack {
  voice: string;
  clips: Record<string, string>;
}

const CLIP_FILE = /^[a-z0-9-]{1,64}\.mp3$/;
let pack: VoicePack | null = null;
let packLoad: Promise<VoicePack | null> | null = null;

/** Loads the clip manifest once. Resolves to null (device voice fallback) if it is missing or malformed. */
export function loadVoicePack(): Promise<VoicePack | null> {
  packLoad ??= fetch(`${import.meta.env.BASE_URL}voice/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: unknown) => {
      const d = data as Partial<VoicePack> | null;
      if (!d || typeof d.voice !== 'string' || typeof d.clips !== 'object' || d.clips === null) return null;
      const clips: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.clips)) if (typeof v === 'string' && CLIP_FILE.test(v)) clips[k] = v;
      pack = { voice: d.voice, clips };
      return pack;
    })
    .catch(() => null);
  return packLoad;
}

/** Clip URLs for every sentence of `text`, or null if any sentence has no clip. */
function clipsFor(text: string): string[] | null {
  if (!pack) return null;
  const urls: string[] = [];
  for (const sentence of splitSentences(text)) {
    const file = pack.clips[sentence];
    if (!file) return null;
    urls.push(`${import.meta.env.BASE_URL}voice/${file}`);
  }
  return urls.length ? urls : null;
}

let audio: HTMLAudioElement | null = null;
let queue: Array<{ url: string; rate: number }> = [];
let gapTimer: number | null = null;

function audioEl(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      // A short breath between sentences, like a person would leave.
      gapTimer = window.setTimeout(playNext, 140);
    });
    audio.addEventListener('error', () => {
      queue = [];
    });
  }
  return audio;
}

function playNext(): void {
  gapTimer = null;
  const el = audioEl();
  const next = queue.shift();
  if (!el || !next) return;
  el.src = next.url;
  el.playbackRate = next.rate;
  el.preservesPitch = true;
  void el.play().catch(() => {
    queue = [];
  });
}

function isPlaying(): boolean {
  return gapTimer !== null || (!!audio && !audio.paused && !audio.ended);
}

/**
 * Unlocks audio playback. Call from a click handler (Safari only lets a page play
 * sound after the user has interacted with it).
 */
export function primeVoice(): void {
  void loadVoicePack();
  const el = audioEl();
  if (el && !isPlaying()) {
    el.src = `${import.meta.env.BASE_URL}voice/silence.mp3`;
    void el.play().catch(() => undefined);
  }
}

export function speak(text: string, opts: { rate: number; voiceURI: string | null; interrupt: boolean }): void {
  if (opts.interrupt) stopSpeaking();
  const clips = opts.voiceURI === null ? clipsFor(text) : null;
  if (clips) {
    queue.push(...clips.map((url) => ({ url, rate: opts.rate })));
    if (!isPlaying()) playNext();
    return;
  }
  if (!synthSupported()) return;
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate;
  const chosen = opts.voiceURI && opts.voiceURI !== DEVICE_VOICE_AUTO ? synth.getVoices().find((v) => v.voiceURI === opts.voiceURI) : undefined;
  const voice = chosen ?? bestDeviceVoice();
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  queue = [];
  if (gapTimer !== null) {
    window.clearTimeout(gapTimer);
    gapTimer = null;
  }
  if (audio && !audio.paused) audio.pause();
  if (synthSupported()) window.speechSynthesis.cancel();
}

export type VoiceCommand = 'pause' | 'resume' | 'repeat' | 'end';

interface MinimalRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => MinimalRecognition;

export function recognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Maps a transcript to a command using simple, predictable keyword rules. */
export function parseCommand(transcript: string): VoiceCommand | null {
  const t = transcript.toLowerCase();
  if (/\b(end|stop|finish)\b.*\bsession\b/.test(t)) return 'end';
  if (/\b(resume|continue|go on)\b/.test(t)) return 'resume';
  if (/\b(pause|wait|hold on)\b/.test(t)) return 'pause';
  if (/\b(repeat|again|say that)\b/.test(t)) return 'repeat';
  return null;
}

/**
 * Starts continuous listening for voice commands. Returns a stop function.
 * Note: some browsers process speech on their own servers; the setting that
 * enables this explains that, and it is off by default.
 */
export function startVoiceCommands(onCommand: (c: VoiceCommand) => void, onError: (message: string) => void): () => void {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onError('Voice commands are not supported in this browser.');
    return () => undefined;
  }
  let active = true;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alt = e.results[i]?.[0];
      const cmd = alt ? parseCommand(alt.transcript) : null;
      if (cmd) onCommand(cmd);
    }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      active = false;
      onError('Microphone permission was not granted, so voice commands are off. The on-screen buttons still work.');
    }
  };
  rec.onend = () => {
    if (active) {
      try {
        rec.start();
      } catch {
        // Restart can race with stop(); ignore.
      }
    }
  };
  try {
    rec.start();
  } catch {
    onError('Voice commands could not start.');
  }
  return () => {
    active = false;
    try {
      rec.stop();
    } catch {
      // Already stopped.
    }
  };
}
