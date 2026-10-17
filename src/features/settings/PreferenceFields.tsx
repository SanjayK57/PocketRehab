import { useEffect, useId, useState } from 'react';
import type { Preferences } from '@/lib/validation/schemas';
import { ChoiceGroup, Field, Select, Toggle } from '@/components/ui';
import { listVoices, speak, speechSupported } from '@/features/live-coaching/voice';
import { recognitionSupported } from '@/features/live-coaching/voice';
import { Button } from '@/components/ui';

/** Coaching and accessibility preferences. Shared by onboarding and Settings. */
export function PreferenceFields({ value, onChange, compact }: { value: Preferences; onChange: (v: Preferences) => void; compact?: boolean }) {
  const id = useId();
  const set = (patch: Partial<Preferences>) => onChange({ ...value, ...patch });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listVoices());
  const canSpeak = speechSupported();

  useEffect(() => {
    if (!canSpeak) return;
    const update = () => setVoices(listVoices());
    window.speechSynthesis.addEventListener?.('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', update);
  }, [canSpeak]);

  return (
    <div className="space-y-7">
      <ChoiceGroup
        name="textScale"
        legend="Text size"
        columns={2}
        value={value.textScale}
        onChange={(v) => set({ textScale: v })}
        options={[
          { value: '100', label: 'Standard' },
          { value: '115', label: 'Large' },
          { value: '130', label: 'Larger' },
          { value: '150', label: 'Largest' },
        ]}
      />

      <div className="divide-y divide-rule border-y border-rule">
        <Toggle
          checked={value.voiceEnabled}
          onChange={(v) => set({ voiceEnabled: v })}
          disabled={!canSpeak}
          label="Spoken coaching"
          description={canSpeak ? 'Reads instructions and feedback aloud during sessions.' : 'This browser can’t speak, so instructions are shown as captions.'}
        />
        <Toggle checked={value.captions} onChange={(v) => set({ captions: v })} label="Captions" description="Shows every spoken message as large text on the session screen." />
        {!compact ? (
          <Toggle
            checked={value.voiceCommands}
            disabled={!recognitionSupported()}
            onChange={(v) => set({ voiceCommands: v })}
            label="Voice commands (pause, resume, repeat, end session)"
            description={
              recognitionSupported()
                ? 'Optional and off by default. Uses your browser’s speech recognition, which in some browsers (like Chrome) sends audio to the browser maker’s servers. Buttons and keyboard shortcuts always work.'
                : 'Not supported in this browser. Use the buttons or keyboard shortcuts instead.'
            }
          />
        ) : null}
        {!compact ? <Toggle checked={value.mirrorPreview} onChange={(v) => set({ mirrorPreview: v })} label="Mirror the camera preview" description="Shows you like a mirror, which most people find easier to follow." /> : null}
        {!compact ? <Toggle checked={value.highContrast} onChange={(v) => set({ highContrast: v })} label="Higher contrast" description="Darker text and stronger borders throughout the app." /> : null}
      </div>

      <ChoiceGroup
        name="style"
        legend="Coaching style"
        columns={3}
        value={value.coachingStyle}
        onChange={(v) => set({ coachingStyle: v })}
        options={[
          { value: 'calm', label: 'Calm', description: 'Clear, steady instructions.' },
          { value: 'encouraging', label: 'Encouraging', description: 'Adds brief acknowledgement of effort.' },
          { value: 'minimal', label: 'Minimal', description: 'Counts and essentials only.' },
        ]}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Feedback during sets" htmlFor={`${id}-freq`}>
          <Select id={`${id}-freq`} value={value.feedbackFrequency} onChange={(e) => set({ feedbackFrequency: e.target.value as Preferences['feedbackFrequency'] })}>
            <option value="every-rep">Speak after every repetition</option>
            <option value="key-moments">Only key moments (set end, tracking issues)</option>
          </Select>
        </Field>
        <Field label="Instruction length" htmlFor={`${id}-len`}>
          <Select id={`${id}-len`} value={value.instructionLength} onChange={(e) => set({ instructionLength: e.target.value as Preferences['instructionLength'] })}>
            <option value="short">Short</option>
            <option value="detailed">Detailed (every step)</option>
          </Select>
        </Field>
        {!compact ? (
          <Field label="Motion and animation" htmlFor={`${id}-motion`}>
            <Select id={`${id}-motion`} value={value.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.value as Preferences['reducedMotion'] })}>
              <option value="system">Follow my device setting</option>
              <option value="reduce">Reduce motion</option>
              <option value="no-preference">Allow animation</option>
            </Select>
          </Field>
        ) : null}
        {!compact ? (
          <Field label="Demonstration panel size" htmlFor={`${id}-demo`}>
            <Select id={`${id}-demo`} value={value.demoPanelSize} onChange={(e) => set({ demoPanelSize: e.target.value as Preferences['demoPanelSize'] })}>
              <option value="small">Small</option>
              <option value="large">Large</option>
            </Select>
          </Field>
        ) : null}
        {canSpeak && value.voiceEnabled ? (
          <Field label="Voice" htmlFor={`${id}-voice`}>
            <Select id={`${id}-voice`} value={value.voiceURI ?? ''} onChange={(e) => set({ voiceURI: e.target.value || null })}>
              <option value="">Browser default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {canSpeak && value.voiceEnabled ? (
          <Field label={`Speaking speed (${value.speechRate.toFixed(1)}×)`} htmlFor={`${id}-rate`}>
            <div className="flex items-center gap-3">
              <input id={`${id}-rate`} type="range" min={0.6} max={1.4} step={0.1} value={value.speechRate} onChange={(e) => set({ speechRate: Number(e.target.value) })} className="w-full" />
              <Button variant="secondary" size="sm" onClick={() => speak('This is how your coach will sound.', { rate: value.speechRate, voiceURI: value.voiceURI, interrupt: true })}>
                Test
              </Button>
            </div>
          </Field>
        ) : null}
      </div>
    </div>
  );
}
