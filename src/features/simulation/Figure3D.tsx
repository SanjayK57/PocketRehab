import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, TargetRange } from '@/lib/validation/schemas';
import type { FigureScene, PoseInput, SceneMode } from './scene';

let hardwareGl: boolean | null = null;

/**
 * True when WebGL runs on a real GPU. Software renderers (SwiftShader, llvmpipe)
 * draw the studio scene at a few frames per second and freeze the page, so they
 * get the 2D figure instead.
 */
export function canRender3D(): boolean {
  if (hardwareGl !== null) return hardwareGl;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    hardwareGl = !!gl && !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    hardwareGl = false;
  }
  return hardwareGl;
}

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
  const [failed, setFailed] = useState(() => !canRender3D());
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
    let frames = 0;
    let slow = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!scene || !visible || document.hidden) return;
      const pose = getPoseRef.current();
      if (!pose) return;
      const t0 = performance.now();
      scene.render(pose, now, animateRef.current);
      // A device that cannot keep up gets the 2D figure rather than a frozen page.
      slow = slow * 0.9 + (performance.now() - t0) * 0.1;
      if (++frames > 30 && slow > 45) setFailed(true);
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
