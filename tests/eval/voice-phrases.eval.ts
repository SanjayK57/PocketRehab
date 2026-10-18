import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { allSpokenSentences } from '@/features/live-coaching/coach';

// Refreshes the coach voice script; `npm run voice-pack` records any new sentences.
it('writes public/voice/phrases.json', () => {
  const sentences = allSpokenSentences();
  expect(sentences.length).toBeGreaterThan(0);
  writeFileSync(new URL('../../public/voice/phrases.json', import.meta.url), `${JSON.stringify(sentences, null, 1)}\n`);
});
