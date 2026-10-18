import {
  AgXToneMapping,
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Landmark, WorldLandmark } from '@/types/pose';
import type { ExerciseDefinition } from '@/types/exercise';
import type { BodySide, TargetRange } from '@/lib/validation/schemas';
import { buildSyntheticBody, SYNTHETIC_FRAME } from '@/features/pose-estimation/synthetic';
import { createMannequin, type Mannequin } from './mannequin';
import { BODY, buildRig, groundOffset, interiorFor, measuredSegments, motionPlane, posePoints, supportFeet, translateRig, unprojectPoints, v3, type Rig, type StageCamera } from './rig';

/**
 * The 3D figure scene. Two looks:
 *  - 'stage': the simulated live session. Dark studio, camera matched to the
 *    simulated frame so the AR overlay lines up with the figure exactly.
 *  - 'demo': the exercise demonstration. Warm paper backdrop, slow turntable
 *    camera, translucent target pose and the target range as a 3D tape arc.
 */

export type SceneMode = 'stage' | 'demo';

export interface PoseInput {
  landmarks: Landmark[];
  world: WorldLandmark[] | null;
  frameW: number;
  frameH: number;
}

export interface FigureScene {
  resize(cssW: number, cssH: number): void;
  render(pose: PoseInput, timeMs: number, animateCamera: boolean): void;
  dispose(): void;
}

const TAPE = '#0a8fb8';
const LOOK = {
  stage: { bg: '#15181b', floor: '#1d2125', fogNear: 4.5, fogFar: 9, hemi: 0.35, key: 2.6, rim: 1.6 },
  demo: { bg: '#efe9de', floor: '#ece5d8', fogNear: 4, fogFar: 8.5, hemi: 0.75, key: 2.1, rim: 0.9 },
} as const;

// Simulated-frame camera: about 34° vertical field of view, person ~3.5 m away.
const STAGE_CAM: StageCamera = { focal: SYNTHETIC_FRAME.height * 1.5, position: v3(0, 0, 3.5), frameW: SYNTHETIC_FRAME.width, frameH: SYNTHETIC_FRAME.height };

export function createFigureScene(canvas: HTMLCanvasElement, def: ExerciseDefinition, side: BodySide, target: TargetRange | null, mode: SceneMode): FigureScene {
  const look = LOOK[mode];
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = mode === 'stage' ? 1.1 : 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new Scene();
  scene.background = new Color(look.bg);
  scene.fog = new Fog(look.bg, look.fogNear, look.fogFar);
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = mode === 'stage' ? 0.35 : 0.6;

  scene.add(new HemisphereLight('#ffffff', mode === 'stage' ? '#2a2d31' : '#d8cfbf', look.hemi));
  const key = new DirectionalLight('#fff3e4', look.key);
  key.position.set(-2.2, 4.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -1.2, near: 0.5, far: 12 });
  scene.add(key);
  const rim = new DirectionalLight('#d6ecff', look.rim);
  rim.position.set(2.6, 2.4, -3.2);
  scene.add(rim);

  // Satin "porcelain" body; the measured limb in tape cyan.
  const bodyMat = new MeshPhysicalMaterial({ color: mode === 'stage' ? '#dcd6cd' : '#e4ded4', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new Color('#ffffff') });
  const tapeMat = new MeshPhysicalMaterial({ color: TAPE, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2, emissive: new Color(TAPE), emissiveIntensity: mode === 'stage' ? 0.18 : 0.06 });
  const measured = measuredSegments(def, side);
  const figure: Mannequin = createMannequin({ body: bodyMat, measured: tapeMat }, measured, true);
  scene.add(figure.group);
  const palmAxis = def.demo.pose.bendToward === 'outward' ? 'lateral' : 'forward';

  // Neutral and peak poses fix the floor, the chair and (demo) the framing, so nothing slides between frames.
  const toRig = (p: PoseInput): Rig | null => {
    if (mode === 'stage') {
      const pts = unprojectPoints(p.landmarks, p.world, def, side, STAGE_CAM, 0);
      return pts ? buildRig(pts, 'data') : null;
    }
    const pts = posePoints(p.landmarks, p.frameW, p.frameH, p.world, def, side);
    return pts ? buildRig(pts, 'canonical') : null;
  };
  const syntheticInput = (value: number): PoseInput => {
    const b = buildSyntheticBody(def, side, value);
    return { landmarks: b.landmarks, world: b.world, frameW: SYNTHETIC_FRAME.width, frameH: SYNTHETIC_FRAME.height };
  };
  const neutralRaw = toRig(syntheticInput(def.demo.neutral));
  const peakRaw = toRig(syntheticInput(def.demo.peak));
  const feet = neutralRaw && peakRaw ? supportFeet(neutralRaw, peakRaw) : (['left', 'right'] as BodySide[]);
  // Demo: plant the support feet at the origin. Stage: keep the camera-matched position and put the floor under the feet.
  const place = (r: Rig): Rig => (mode === 'demo' ? translateRig(r, groundOffset(r, feet, { x: 0, z: 0 })) : r);
  const neutral = neutralRaw ? place(neutralRaw) : null;
  const floorY = neutral ? Math.min(...feet.map((s) => neutral[s].ankle.y)) - BODY.ankleHeight : -1;

  const floor = new Mesh(new CircleGeometry(12, 64), new MeshStandardMaterial({ color: look.floor, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  const disposables: Array<{ dispose(): void }> = [renderer, pmrem, env, bodyMat, tapeMat, floor.geometry, floor.material as Material];

  if (def.demo.pose.posture === 'seated' && neutral) scene.add(chair(neutral, floorY, disposables));

  // Demo only: a translucent ghost at the target, and the target range as a tape arc around the joint.
  let ghost: Mannequin | null = null;
  if (mode === 'demo') {
    const goal = target ? (target.min + target.max) / 2 : def.demo.peak;
    const ghostRaw = toRig(syntheticInput(goal));
    if (ghostRaw) {
      const ghostMat = new MeshPhysicalMaterial({ color: TAPE, transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.2 });
      disposables.push(ghostMat);
      ghost = createMannequin({ body: ghostMat, measured: ghostMat }, measured, false);
      ghost.pose(place(ghostRaw), palmAxis);
      ghost.showOnly(measured);
      scene.add(ghost.group);
    }
    if (target && neutral) {
      scene.add(targetArc(def, target, neutral, side, disposables));
    }
  }

  // Camera
  const camera = new PerspectiveCamera(30, 1, 0.1, 40);
  const center = new Vector3();
  let distance = 4;
  if (mode === 'stage') {
    camera.fov = (2 * Math.atan(STAGE_CAM.frameH / 2 / STAGE_CAM.focal) * 180) / Math.PI;
    camera.position.set(STAGE_CAM.position.x, STAGE_CAM.position.y, STAGE_CAM.position.z);
    camera.lookAt(STAGE_CAM.position.x, STAGE_CAM.position.y, STAGE_CAM.position.z - 1);
  } else if (neutral) {
    const peak = peakRaw ? place(peakRaw) : neutral;
    const ys = [neutral, peak].flatMap((r) => [r.left.ankle.y, r.right.ankle.y, r.shoulderMid.y + 0.32, r.left.wrist.y, r.right.wrist.y]);
    const top = Math.max(...ys);
    center.set(0, (top + floorY) / 2, 0);
    distance = ((top - floorY) / 2 / Math.tan((15 * Math.PI) / 180)) * 1.28;
  }
  let cssW = 1;
  let cssH = 1;

  const placeDemoCamera = (timeMs: number, animate: boolean) => {
    // A three-quarter view reads depth better than straight on; a slow sway keeps it alive.
    const az = (24 + (animate ? Math.sin(timeMs / 2600) * 7 : 0)) * (Math.PI / 180);
    camera.position.set(center.x + Math.sin(az) * distance, center.y + distance * 0.12, center.z + Math.cos(az) * distance);
    camera.lookAt(center.x, center.y - 0.04, center.z);
  };

  return {
    resize(w, h) {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      renderer.setSize(cssW, cssH, false);
      if (mode === 'stage') {
        // Same crop as the video's object-fit: cover, so 3D and AR overlay share pixels.
        const s = Math.max(cssW / STAGE_CAM.frameW, cssH / STAGE_CAM.frameH);
        const visW = cssW / s;
        const visH = cssH / s;
        camera.aspect = STAGE_CAM.frameW / STAGE_CAM.frameH;
        camera.setViewOffset(STAGE_CAM.frameW, STAGE_CAM.frameH, (STAGE_CAM.frameW - visW) / 2, (STAGE_CAM.frameH - visH) / 2, visW, visH);
      } else {
        camera.aspect = cssW / cssH;
      }
      camera.updateProjectionMatrix();
    },
    render(pose, timeMs, animateCamera) {
      const raw = toRig(pose);
      if (raw) figure.pose(place(raw), palmAxis);
      if (mode === 'demo') placeDemoCamera(timeMs, animateCamera);
      renderer.render(scene, camera);
    },
    dispose() {
      figure.dispose();
      ghost?.dispose();
      for (const d of disposables) d.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** A simple modern chair: seat under the hips, four slim legs, a low back. */
function chair(neutral: Rig, floorY: number, disposables: Array<{ dispose(): void }>): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({ color: '#8b7d6b', roughness: 0.55 });
  const seatY = neutral.hipMid.y - 0.1;
  const seatGeo = new BoxGeometry(0.46, 0.04, 0.44);
  const legGeo = new BoxGeometry(0.03, 1, 0.03);
  const backGeo = new BoxGeometry(0.46, 0.4, 0.035);
  disposables.push(mat, seatGeo, legGeo, backGeo);
  const seat = new Mesh(seatGeo, mat);
  seat.position.y = seatY;
  g.add(seat);
  const legH = seatY - floorY;
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]] as const) {
    const leg = new Mesh(legGeo, mat);
    leg.scale.y = legH;
    leg.position.set(x, floorY + legH / 2, z);
    g.add(leg);
  }
  const back = new Mesh(backGeo, mat);
  back.position.set(0, seatY + 0.24, -0.21);
  g.add(back);
  g.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Turn the chair to face where the figure faces, centred just behind the hips.
  const f = neutral.forward;
  const yaw = Math.atan2(f.x, f.z);
  g.rotation.y = yaw;
  g.position.set(neutral.hipMid.x - f.x * 0.08, 0, neutral.hipMid.z - f.z * 0.08);
  return g;
}

/** The target range drawn as a cyan tape arc in the plane the joint moves in. */
function targetArc(def: ExerciseDefinition, target: TargetRange, rig: Rig, side: BodySide, disposables: Array<{ dispose(): void }>): Group {
  const plane = motionPlane(rig, def, side);
  const r = 0.2;
  const from = (interiorFor(def, target.min) * Math.PI) / 180;
  const to = (interiorFor(def, target.max) * Math.PI) / 180;
  const pts: Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = from + ((to - from) * i) / 24;
    pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  const geo = new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.014, 10, false);
  const mat = new MeshPhysicalMaterial({ color: TAPE, roughness: 0.3, clearcoat: 0.8, emissive: new Color(TAPE), emissiveIntensity: 0.25 });
  disposables.push(geo, mat);
  const g = new Group();
  g.add(new Mesh(geo, mat));
  g.matrixAutoUpdate = false;
  g.matrix.copy(
    new Matrix4()
      .makeBasis(new Vector3(plane.ref.x, plane.ref.y, plane.ref.z), new Vector3(plane.perp.x, plane.perp.y, plane.perp.z), new Vector3(plane.normal.x, plane.normal.y, plane.normal.z))
      .setPosition(plane.origin.x, plane.origin.y, plane.origin.z),
  );
  return g;
}
