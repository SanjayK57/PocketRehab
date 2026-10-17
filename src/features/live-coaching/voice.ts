/**
 * Voice coach output (speech synthesis) and optional voice commands (speech
 * recognition). Both are optional: captions always show the same text, and
 * every voice command has an on-screen button and a keyboard shortcut.
 */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
}

export function speak(text: string, opts: { rate: number; voiceURI: string | null; interrupt: boolean }): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  if (opts.interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate;
  const voice = opts.voiceURI ? synth.getVoices().find((v) => v.voiceURI === opts.voiceURI) : undefined;
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
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
