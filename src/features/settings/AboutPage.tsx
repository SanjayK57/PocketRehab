import { DISCLAIMER_SHORT } from '@/lib/safety/checkins';
import { EXERCISE_LIST } from '@/features/exercises/library';
import { LinkButton, PageHeader, Section } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';

export function AboutPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="About PocketRehab" description="Rehab done right: what it does, what it doesn’t, and how it handles your safety and data." actions={<LinkButton to="/settings" variant="secondary">Back to settings</LinkButton>} />
      <div className="space-y-12">
        <Section title="Medical disclaimer">
          <p className="text-lg">{DISCLAIMER_SHORT}</p>
          <p className="mt-3 text-ink-2">PocketRehab does not diagnose injuries or conditions, prescribe or change exercises, tell you that you are healed or cleared, or guarantee any recovery timeline. A camera cannot see pain, tissue healing or the inside of a joint, and it can’t catch every unsafe movement.</p>
          <p className="mt-3 text-ink-2">If something could be an emergency, call 911 or your local emergency number. For new or worsening symptoms, follow your clinician’s instructions and contact your care team.</p>
        </Section>
        <Section title="What the measurements are">
          <ul className="list-disc space-y-2 pl-5">
            <li>Joint angles are 2D estimates from a single camera image. They can differ from a clinician’s goniometer measurement because of camera angle, body rotation, clothing and depth.</li>
            <li>Every frame gets a tracking-quality state (reliable, uncertain or unavailable) from predefined checks on landmark visibility, frame position and camera view. The model’s visibility scores are tracking-quality estimates, not calibrated probabilities.</li>
            <li>Repetitions with too little reliable tracking are counted but left out of measurements, and uncertain tracking never produces form feedback.</li>
            <li>PocketRehab hasn’t measured its own error against reference measurements, so it doesn’t call small changes improvement. Targets, thresholds and the four demonstration exercises are software examples, not clinically validated protocols.</li>
          </ul>
        </Section>
        <Section title="Supported exercises">
          <ul className="space-y-2">
            {EXERCISE_LIST.map((e) => (
              <li key={e.id}>
                <span className="font-semibold">{e.name}</span> <span className="text-ink-2">· {e.cameraView} camera view · definition v{e.version}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Built with">
          <ul className="list-disc space-y-1.5 pl-5 text-ink-2">
            <li>Google MediaPipe Pose Landmarker (Apache 2.0), running in the browser.</li>
            <li>React, TypeScript, Vite and Tailwind CSS (MIT).</li>
            <li>Atkinson Hyperlegible Next and Mono typefaces by the Braille Institute (SIL Open Font License), designed for readers with low vision.</li>
            <li>jsPDF for on-device PDF reports, Lucide icons, Zod and idb.</li>
          </ul>
        </Section>
        <Section title="Credits">
          <div className="flex items-center gap-3">
            <BrandMark className="h-6 w-8" />
            <p>
              <span className="font-bold">PocketRehab</span> · built by Sanjay Koripelli for the 2026 Congressional App Challenge. Version {__APP_VERSION__}.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
