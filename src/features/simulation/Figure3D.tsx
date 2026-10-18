import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, TargetRange } from '@/lib/validation/schemas';
import type { FigureScene, PoseInput, SceneMode } from './scene';

/**
 * Renders the 3D figure for a pose supplied each animation frame by `getPose`.
 * three.js loads on first use, rendering pauses while the figure is off-screen
 * or the tab is hidden, and `fallback` shows if WebGL is unavailable or the GPU
 * context is lost.
 */
export function Figure3D({
  def,
  side,
  target,
  mode,
  getPose,
  animateCamera,
  fallback,
  className,
  label,
}: {
  def: ExerciseDefinition;
  side: BodySide;
  target: TargetRange | null;
  mode: SceneMode;
  getPose: () => PoseInput | null;
  animateCamera: boolean;
  fallback: ReactNode;
  className?: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const getPoseRef = useRef(getPose);
  const animateRef = useRef(animateCamera);
  useLayoutEffect(() => {
    getPoseRef.current = getPose;
    animateRef.current = animateCamera;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || failed) return;
    let scene: FigureScene | null = null;
    let raf = 0;
    let visible = true;
    let cancelled = false;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!scene || !visible || document.hidden) return;
      const pose = getPoseRef.current();
      if (pose) scene.render(pose, now, animateRef.current);
    };
    const size = () => scene?.resize(canvas.clientWidth, canvas.clientHeight);
    const resizeObs = new ResizeObserver(size);
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
    });
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    import('./scene')
      .then(({ createFigureScene }) => {
        if (cancelled) return;
        scene = createFigureScene(canvas, def, side, target, mode);
        size();
        resizeObs.observe(canvas);
        io.observe(canvas);
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      io.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      scene?.dispose();
    };
  }, [def, side, target, mode, failed]);

  if (failed) return <>{fallback}</>;
  return <canvas ref={canvasRef} className={className} role="img" aria-label={label} />;
}
