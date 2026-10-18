import type { MutableRefObject } from 'react';
import type { PoseFrame } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';
import { Figure3D } from './Figure3D';

export interface SimulatedStageProps {
  frameRef: MutableRefObject<PoseFrame | null>;
  def: ExerciseDefinition;
  side: BodySide;
  /** Kept for API symmetry; the stage camera never moves, so there is nothing to reduce. */
  reducedMotion: boolean;
  className?: string;
}

/**
 * The simulated session's 3D figure, drawn behind the AR canvas. It reads the
 * latest simulated frame every animation frame, so it moves exactly as the
 * engine measures, and its camera matches the frame so the overlay lines up.
 */
export function SimulatedStage({ frameRef, def, side, className }: SimulatedStageProps) {
  return (
    <Figure3D
      def={def}
      side={side}
      target={null}
      mode="stage"
      animateCamera={false}
      getPose={() => {
        const f = frameRef.current;
        return f?.landmarks ? { landmarks: f.landmarks, world: f.world ?? null, frameW: f.imageWidth, frameH: f.imageHeight } : null;
      }}
      fallback={null}
      className={className}
      label={`Simulated figure performing ${def.name.toLowerCase()}`}
    />
  );
}
