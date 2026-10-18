import { BufferGeometry, Group, LatheGeometry, Material, Matrix4, Mesh, SphereGeometry, SplineCurve, Vector2, Vector3 } from 'three';
import type { BodySide } from '@/lib/validation/schemas';
import { BODY, cross, orthonormal, scale, sub, unit, v3, type Rig, type SegmentId, type Vec3 } from './rig';

/**
 * A sculpted, faceless mannequin built from lathed (turned) profiles, posed
 * every frame from a {@link Rig}. Limbs are tapered capsules whose rounded ends
 * overlap at the joints, so a bent elbow or knee reads as one continuous form
 * rather than a stick figure with dots.
 */

const Y = new Vector3(0, 1, 0);
const tmpV = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const tmpM = new Matrix4();

/** A smooth closed profile through (radius, height) control points, turned around +Y. */
function turned(points: Array<[number, number]>, radial = 40, samples = 48): LatheGeometry {
  const curve = new SplineCurve(points.map(([r, y]) => new Vector2(r, y)));
  const pts = curve.getPoints(samples).map((p) => new Vector2(Math.max(0, p.x), p.y));
  const g = new LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

/**
 * A tapered capsule from y = 0 (radius r0) to y = len (radius r1) with
 * hemispherical ends and an optional muscle swell, origin at the proximal joint.
 */
function limb(r0: number, r1: number, len: number, swell = 0, swellAt = 0.35): LatheGeometry {
  const pts: Vector2[] = [];
  const cap = 8;
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(r0 * Math.cos(a), r0 * Math.sin(a)));
  }
  const body = 24;
  for (let i = 1; i < body; i++) {
    const t = i / body;
    // Muscle swell: peaks at `swellAt` along the bone and fades smoothly to both joints.
    const u = t < swellAt ? (0.5 * t) / swellAt : 0.5 + (0.5 * (t - swellAt)) / (1 - swellAt);
    const bump = swell * Math.sin(Math.PI * u) ** 2;
    pts.push(new Vector2(r0 + (r1 - r0) * t + bump, t * len));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(r1 * Math.cos(a), len + r1 * Math.sin(a)));
  }
  const g = new LatheGeometry(pts, 40);
  g.computeVertexNormals();
  return g;
}

/** Profile lengths the limb meshes are modelled at (scaled along the bone to fit the pose). */
const MODEL = { upperArm: BODY.upperArm, forearm: BODY.forearm, thigh: BODY.thigh, shin: BODY.shin, torso: BODY.torso } as const;

function geometries() {
  return {
    // Waist (inside the pelvis) up to the base of the neck; scaled flatter front to back.
    torso: turned([
      [0.112, 0.02],
      [0.118, 0.12],
      [0.138, 0.24],
      [0.16, 0.36],
      [0.168, 0.44],
      [0.152, 0.5],
      [0.11, 0.545],
      [0.058, 0.575],
      [0.0, 0.585],
    ]),
    pelvis: turned([
      [0.0, -0.115],
      [0.09, -0.1],
      [0.135, -0.05],
      [0.148, 0.01],
      [0.138, 0.07],
      [0.115, 0.11],
      [0.0, 0.125],
    ]),
    neck: limb(0.05, 0.046, 0.1),
    head: new SphereGeometry(1, 48, 32),
    deltoid: new SphereGeometry(0.06, 32, 24),
    upperArm: limb(0.05, 0.038, MODEL.upperArm, 0.006, 0.3),
    forearm: limb(0.038, 0.027, MODEL.forearm, 0.006, 0.25),
    hand: turned([
      [0.0, -0.01],
      [0.03, 0.0],
      [0.042, 0.05],
      [0.043, 0.1],
      [0.034, 0.145],
      [0.0, 0.17],
    ], 32, 32),
    thigh: limb(0.082, 0.052, MODEL.thigh, 0.01, 0.25),
    shin: limb(0.052, 0.033, MODEL.shin, 0.012, 0.28),
    foot: turned([
      [0.0, -0.06],
      [0.035, -0.052],
      [0.043, 0.0],
      [0.047, 0.09],
      [0.04, 0.16],
      [0.0, 0.2],
    ], 32, 32),
  };
}

export interface MannequinMaterials {
  body: Material;
  measured: Material;
}

export interface Mannequin {
  group: Group;
  /** Poses every part from the rig. `palmAxis` keeps hands flat in the plane the arms move in. */
  pose(rig: Rig, palmAxis: 'forward' | 'lateral'): void;
  /** Hides everything except the given segments (used for the target ghost). */
  showOnly(segments: SegmentId[] | null): void;
  dispose(): void;
}

type LimbName = 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot';

export function createMannequin(materials: MannequinMaterials, measured: SegmentId[], castShadow = true): Mannequin {
  const geo = geometries();
  const group = new Group();
  const meshes: Mesh[] = [];
  const make = (g: BufferGeometry, accent = false) => {
    const m = new Mesh(g, accent ? materials.measured : materials.body);
    m.castShadow = castShadow;
    m.matrixAutoUpdate = true;
    group.add(m);
    meshes.push(m);
    return m;
  };
  const torso = make(geo.torso);
  const pelvis = make(geo.pelvis);
  const neck = make(geo.neck);
  const head = make(geo.head);
  const limbs: Record<BodySide, Record<LimbName, Mesh> & { deltoid: Mesh }> = {
    left: buildSide('left'),
    right: buildSide('right'),
  };
  function buildSide(s: BodySide) {
    const isMeasured = (n: LimbName) => measured.includes(`${s}.${n}` as SegmentId);
    return {
      deltoid: make(geo.deltoid, isMeasured('upperArm')),
      upperArm: make(geo.upperArm, isMeasured('upperArm')),
      forearm: make(geo.forearm, isMeasured('forearm')),
      hand: make(geo.hand, isMeasured('hand')),
      thigh: make(geo.thigh, isMeasured('thigh')),
      shin: make(geo.shin, isMeasured('shin')),
      foot: make(geo.foot, isMeasured('foot')),
    };
  }

  /** Orients a lathed segment from joint `a` to joint `b`, stretching it to the joint distance. */
  const segment = (m: Mesh, a: Vec3, b: Vec3, modelLen: number) => {
    tmpV.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = tmpV.length();
    m.position.set(a.x, a.y, a.z);
    if (len > 1e-6) m.quaternion.setFromUnitVectors(Y, tmpV.multiplyScalar(1 / len));
    m.scale.set(1, Math.max(0.05, len / modelLen), 1);
  };
  /** Orients a rigid part with an orthonormal basis (x, y, z = x × y). */
  const basis = (m: Mesh, at: Vec3, x: Vec3, y: Vec3) => {
    const z = cross(x, y);
    tmpX.set(x.x, x.y, x.z);
    tmpY.set(y.x, y.y, y.z);
    tmpZ.set(z.x, z.y, z.z);
    m.quaternion.setFromRotationMatrix(tmpM.makeBasis(tmpX, tmpY, tmpZ));
    m.position.set(at.x, at.y, at.z);
  };

  return {
    group,
    pose(rig, palmAxis) {
      const { up, lateral, forward } = rig;
      const shoulderWidth = Math.hypot(rig.left.shoulder.x - rig.right.shoulder.x, rig.left.shoulder.y - rig.right.shoulder.y, rig.left.shoulder.z - rig.right.shoulder.z);
      const hipWidth = Math.hypot(rig.left.hip.x - rig.right.hip.x, rig.left.hip.y - rig.right.hip.y, rig.left.hip.z - rig.right.hip.z);
      const torsoLen = Math.hypot(rig.shoulderMid.x - rig.hipMid.x, rig.shoulderMid.y - rig.hipMid.y, rig.shoulderMid.z - rig.hipMid.z);
      const widthScale = Math.min(1.25, Math.max(0.8, shoulderWidth / 0.38));

      basis(torso, rig.hipMid, lateral, up);
      torso.scale.set(widthScale, torsoLen / MODEL.torso, 0.64 * Math.min(1.1, widthScale));
      basis(pelvis, rig.hipMid, lateral, up);
      pelvis.scale.set(Math.min(1.35, Math.max(0.95, hipWidth / 0.2)), 1, 0.72);

      const neckBase = sub(rig.shoulderMid, scale(up, 0.02 * (torsoLen / MODEL.torso)));
      segment(neck, neckBase, { x: neckBase.x + rig.headUp.x * 0.12, y: neckBase.y + rig.headUp.y * 0.12, z: neckBase.z + rig.headUp.z * 0.12 }, 0.1);
      const headCentre = { x: neckBase.x + rig.headUp.x * 0.205 + forward.x * 0.012, y: neckBase.y + rig.headUp.y * 0.205 + forward.y * 0.012, z: neckBase.z + rig.headUp.z * 0.205 + forward.z * 0.012 };
      basis(head, headCentre, orthonormal(lateral, rig.headUp, lateral), rig.headUp);
      head.scale.set(0.079, 0.112, 0.097);

      for (const s of ['left', 'right'] as const) {
        const j = rig[s];
        const p = limbs[s];
        p.deltoid.position.set(j.shoulder.x, j.shoulder.y, j.shoulder.z);
        segment(p.upperArm, j.shoulder, j.elbow, MODEL.upperArm);
        segment(p.forearm, j.elbow, j.wrist, MODEL.forearm);
        segment(p.thigh, j.hip, j.knee, MODEL.thigh);
        segment(p.shin, j.knee, j.ankle, MODEL.shin);

        // Hand continues the forearm; its flat faces lie across the plane the arm moves in.
        const fore = unit(sub(j.wrist, j.elbow), scale(up, -1));
        const palm = orthonormal(cross(fore, palmAxis === 'forward' ? forward : lateral), fore, lateral);
        basis(p.hand, j.wrist, cross(fore, palm), fore);
        p.hand.scale.set(1, 1, 0.52);
        p.hand.position.set(j.wrist.x + fore.x * 0.012, j.wrist.y + fore.y * 0.012, j.wrist.z + fore.z * 0.012);

        // Foot: flat on the floor when the shin is upright, at a right angle to the shin when the leg lifts.
        const shin = unit(sub(j.ankle, j.knee), scale(up, -1));
        const perpFoot = unit(cross(shin, lateral), forward);
        const flatFoot = unit(v3(forward.x, 0, forward.z), forward);
        const planted = Math.max(0, Math.min(1, (-shin.y - 0.8) / 0.15));
        const footDir = unit(v3(perpFoot.x + (flatFoot.x - perpFoot.x) * planted, perpFoot.y + (flatFoot.y - perpFoot.y) * planted, perpFoot.z + (flatFoot.z - perpFoot.z) * planted), forward);
        const footUp = orthonormal(scale(shin, -1), footDir, up);
        const footSide = cross(footDir, footUp);
        basis(p.foot, { x: j.ankle.x - footUp.x * 0.045, y: j.ankle.y - footUp.y * 0.045, z: j.ankle.z - footUp.z * 0.045 }, footSide, footDir);
        p.foot.scale.set(1, 1, 0.68);
      }
    },
    showOnly(segments) {
      const keep = segments ? new Set<Mesh>() : null;
      if (segments && keep) {
        for (const id of segments) {
          const [s, n] = id.split('.') as [BodySide, LimbName];
          keep.add(limbs[s][n]);
          if (n === 'upperArm') keep.add(limbs[s].deltoid);
        }
      }
      for (const m of meshes) m.visible = !keep || keep.has(m);
    },
    dispose() {
      for (const g of Object.values(geo)) g.dispose();
    },
  };
}
