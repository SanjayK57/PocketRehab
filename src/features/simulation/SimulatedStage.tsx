import type { MutableRefObject } from 'react';
import type { PoseFrame } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide } from '@/lib/validation/schemas';

/**
 * Full-bleed 3D scene for the clearly labelled simulated demo: a sculpted
 * figure driven by the latest simulated pose frame (read from `frameRef` every
 * animation frame), drawn behind the AR overlay canvas.
 * Contract placeholder: the simulation feature replaces this implementation.
 */
export interface SimulatedStageProps {
  frameRef: MutableRefObject<PoseFrame | null>;
  def: ExerciseDefinition;
  side: BodySide;
  /** When true, render a still frame instead of animating continuously. */
  reducedMotion: boolean;
  className?: string;
}

export function SimulatedStage(props: SimulatedStageProps) {
  void props;
  return null;
}
