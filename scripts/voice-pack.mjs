// Generates the PocketRehab coach voice: one ElevenLabs clip per spoken sentence.
//
//   npm run evaluate                         # refreshes public/voice/phrases.json from the coach rules
//   ELEVENLABS_API_KEY=... npm run voice-pack
//
// Only sentences without a clip are sent, so re-running after a wording change
// costs only the new sentences. The key is read from the environment and never
// written anywhere. The app plays these files from its own origin; nothing is
// sent to ElevenLabs (or anyone) while someone uses PocketRehab.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VOICE = { name: 'Sarah', id: 'EXAVITQu4vr4xnSDxMaL' };
const MODEL = 'eleven_multilingual_v2';
const SETTINGS = { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };

const dir = fileURLToPath(new URL('../public/voice/', import.meta.url));
const phrases = JSON.parse(readFileSync(`${dir}phrases.json`, 'utf8'));
if (!Array.isArray(phrases) || !phrases.every((p) => typeof p === 'string')) throw new Error('phrases.json must be an array of strings');

const fileFor = (s) => `${createHash('sha256').update(`${VOICE.id}|${MODEL}|${JSON.stringify(SETTINGS)}|${s}`).digest('hex').slice(0, 16)}.mp3`;
const clips = Object.fromEntries(phrases.map((s) => [s, fileFor(s)]));
const missing = phrases.filter((s) => !existsSync(dir + clips[s]));
const chars = missing.reduce((n, s) => n + s.length, 0);
console.log(`${phrases.length} sentences, ${missing.length} to generate (${chars} characters).`);

const key = process.env.ELEVENLABS_API_KEY;
if (missing.length > 0 && !key) {
  console.error('Set ELEVENLABS_API_KEY to generate the missing clips.');
  process.exit(1);
}

let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synthesize(text) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 1500 * attempt);
      continue;
    }
    throw new Error(`ElevenLabs ${res.status} for "${text}": ${body.slice(0, 300)}`);
  }
}

let done = 0;
for (const s of missing) {
  const out = dir + clips[s];
  const raw = `${out}.raw.mp3`;
  writeFileSync(raw, await synthesize(s));
  if (hasFfmpeg) {
    // Trim the silence ElevenLabs leaves at both ends so cues land on time; normalize loudness.
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-i', raw,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,loudnorm=I=-18:TP=-2:LRA=7',
      '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', out,
    ]);
    unlinkSync(raw);
  } else {
    renameSync(raw, out);
  }
  done++;
  if (done % 10 === 0 || done === missing.length) console.log(`  ${done}/${missing.length}`);
}

// Drop clips no sentence uses any more.
const keep = new Set([...Object.values(clips), 'silence.mp3']);
for (const f of readdirSync(dir)) if (f.endsWith('.mp3') && !keep.has(f)) unlinkSync(dir + f);

writeFileSync(`${dir}manifest.json`, `${JSON.stringify({ voice: `${VOICE.name} (ElevenLabs, ${MODEL})`, clips }, null, 1)}\n`);
console.log(`Wrote manifest with ${phrases.length} clips.`);
