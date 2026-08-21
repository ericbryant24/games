/* The boat, built from code: a lofted hull, a rig, and sails whose shape comes from the
   simulation — the boom sits at the angle the physics computed, the camber fills in with
   the load on it, and the cloth shakes when the sail is luffing. */

import * as THREE from '../../vendor/three.module.min.js';

const TAU = Math.PI * 2;

/* Piecewise-linear curve through control values, for hull lines. */
function curve(table, t) {
  const n = table.length - 1;
  const x = Math.max(0, Math.min(1, t)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  return table[i] * (1 - f) + table[i + 1] * f;
}

/* --- hull lines ---------------------------------------------------------------
   t runs 0 at the stem to 1 at the transom. A sportboat: fine forward, carrying its
   beam well aft, with a wide flat transom to plane off. */
const BEAM_CURVE  = [0.02, 0.30, 0.58, 0.80, 0.94, 1.00, 0.99, 0.93, 0.87];
const ROCKER      = [0.06, 0.42, 0.74, 0.92, 1.00, 0.99, 0.94, 0.86, 0.78];
const SHEER       = [1.62, 1.30, 1.11, 1.00, 0.95, 0.94, 0.96, 1.00, 1.05];

export class Hull {
  constructor(spec) {
    this.spec = spec;
    this.halfBeam = spec.beam * 0.5;
    this.canoe = 0.44;                 // depth of the hull below the waterline
    this.freeboard = 0.62;
  }
  hb(t) { return this.halfBeam * curve(BEAM_CURVE, t); }
  bottom(t) { return -this.canoe * curve(ROCKER, t); }
  sheer(t) { return this.freeboard * curve(SHEER, t); }
  /* A point on the hull skin. v: 0 at the keel, 1 at the sheer. */
  point(t, v, side) {
    const b = this.hb(t), yB = this.bottom(t), yS = this.sheer(t);
    return [
      side * b * Math.pow(v, 0.58),
      yB + (yS - yB) * Math.pow(v, 1.32),
      (0.5 - t) * this.spec.loa
    ];
  }
}

function surfaceGeometry(rows, cols, fn, skip) {
  const pos = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) pos.push(...fn(i / rows, j / cols));
  }
  const at = (i, j) => i * (cols + 1) + j;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (skip && skip(i / rows, j / cols)) continue;
      idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* A symmetric foil section, for keels and rudders. Thickness after NACA-ish form. */
function foilGeometry(chordAt, spanTop, spanBottom, thickness, zAt) {
  const N = 12, M = 5;
  return surfaceGeometry(M, N * 2, (u, w) => {
    const y = spanTop + (spanBottom - spanTop) * u;
    const c = chordAt(u);
    // w wraps around the section: 0 -> 0.5 down one side, 0.5 -> 1 back up the other.
    const s = w < 0.5 ? w * 2 : (1 - w) * 2;
    const side = w < 0.5 ? 1 : -1;
    const x = s;
    const th = thickness * c * 5 * (0.2969 * Math.sqrt(Math.max(x, 0)) - 0.126 * x
      - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
    return [side * th, y, zAt(u) - x * c];
  });
}

/* The lofted surfaces are open sheets, and which way round a given patch is wound
   depends on how it happens to be parameterised. Drawing them double-sided sidesteps
   the whole question — three flips the normal for back faces, so the lighting stays
   right either way. */
const MAT = {
  hull: (color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.30, metalness: 0.02, side: THREE.DoubleSide }),
  deck: () => new THREE.MeshStandardMaterial({
    color: 0xdfe3e6, roughness: 0.72, side: THREE.DoubleSide }),
  dark: () => new THREE.MeshStandardMaterial({
    color: 0x2a3138, roughness: 0.55, side: THREE.DoubleSide }),
  spar: () => new THREE.MeshStandardMaterial({ color: 0xb9bfc6, roughness: 0.38, metalness: 0.5 }),
  wire: () => new THREE.MeshStandardMaterial({ color: 0x8b939b, roughness: 0.4, metalness: 0.6 }),
  // Sailcloth is thin: lit from behind it glows rather than going to shadow, so a
  // chunk of emissive stands in for the light coming through it.
  sail: () => new THREE.MeshStandardMaterial({
    color: 0xfdfdfc, roughness: 0.78, side: THREE.DoubleSide,
    emissive: 0xaebac8, emissiveIntensity: 0.80
  }),
  kite: (color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.70, side: THREE.DoubleSide, emissive: 0xd9a45a, emissiveIntensity: 0.85
  })
};

/* --- sails --------------------------------------------------------------------
   Each sail is a small parametric grid rebuilt on the CPU every frame. The vertex
   counts are tiny and it means the cloth can answer directly to the trim. */
class Sail {
  constructor(rows, cols, material) {
    this.rows = rows; this.cols = cols;
    const pos = new Float32Array((rows + 1) * (cols + 1) * 3);
    const idx = [];
    const at = (i, j) => i * (cols + 1) + j;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this._v = new THREE.Vector3();
  }
  /* fn(u, w) -> [x, y, z] in boat-local space. */
  shape(fn) {
    const pos = this.geometry.attributes.position;
    const a = pos.array;
    let k = 0;
    for (let i = 0; i <= this.rows; i++) {
      const u = i / this.rows;
      for (let j = 0; j <= this.cols; j++) {
        const p = fn(u, j / this.cols);
        a[k++] = p[0]; a[k++] = p[1]; a[k++] = p[2];
      }
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

export class BoatMesh {
  /**
   * @param {object} spec  the boat class from physics.js
   * @param {object} opts  hull colour, sail number, level of detail
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.detail = opts.detail ?? 1;
    const hull = new Hull(spec);
    this.hull = hull;

    this.root = new THREE.Group();
    this.yaw = new THREE.Group();
    this.roll = new THREE.Group();
    this.pitch = new THREE.Group();
    this.root.add(this.yaw); this.yaw.add(this.roll); this.roll.add(this.pitch);

    const body = new THREE.Group();
    this.pitch.add(body);
    this.body = body;

    const hullColor = opts.color ?? 0xf2f4f6;
    const nT = this.detail > 0.5 ? 30 : 18;
    const nV = this.detail > 0.5 ? 9 : 6;

    /* Hull skin, both sides. */
    for (const side of [1, -1]) {
      const g = surfaceGeometry(nT, nV, (t, v) => hull.point(t, v, side));
      body.add(new THREE.Mesh(g, MAT.hull(hullColor)));
    }
    // Transom closes the after end.
    body.add(new THREE.Mesh(surfaceGeometry(4, nV, (a, v) => {
      const p = hull.point(1, v, a * 2 - 1);
      return p;
    }), MAT.hull(hullColor)));

    /* Deck, with a cockpit cut out of it. */
    const cock = { t0: 0.60, t1: 0.95, w: 0.66 };
    const deckPt = (t, a) => {
      const x = (a * 2 - 1) * hull.hb(t);
      const camber = 0.075 * hull.hb(t) * (1 - Math.pow(a * 2 - 1, 2));
      return [x, hull.sheer(t) + camber, (0.5 - t) * spec.loa];
    };
    body.add(new THREE.Mesh(surfaceGeometry(nT, 10, deckPt,
      (t, a) => t >= cock.t0 && t < cock.t1 && Math.abs(a * 2 - 1) < cock.w), MAT.deck()));

    /* Cockpit well: a floor and four walls, so it reads as a place to sit. */
    const cockFloorY = hull.sheer(0.75) - 0.42;
    const cw = (t) => hull.hb(t) * cock.w;
    body.add(new THREE.Mesh(surfaceGeometry(4, 4, (t, a) => {
      const tt = cock.t0 + (cock.t1 - cock.t0) * t;
      return [(a * 2 - 1) * cw(tt), cockFloorY, (0.5 - tt) * spec.loa];
    }), MAT.dark()));
    for (const side of [1, -1]) {
      body.add(new THREE.Mesh(surfaceGeometry(4, 3, (t, v) => {
        const tt = cock.t0 + (cock.t1 - cock.t0) * t;
        return [side * cw(tt), cockFloorY + v * (hull.sheer(tt) - cockFloorY), (0.5 - tt) * spec.loa];
      }), MAT.dark()));
    }
    body.add(new THREE.Mesh(surfaceGeometry(3, 3, (a, v) => {
      const tt = cock.t0;
      return [(a * 2 - 1) * cw(tt), cockFloorY + v * (hull.sheer(tt) - cockFloorY), (0.5 - tt) * spec.loa];
    }), MAT.dark()));

    /* Cabin trunk forward of the cockpit. */
    const trunk = new THREE.Mesh(surfaceGeometry(6, 6, (t, a) => {
      const tt = 0.20 + 0.38 * t;
      const w = hull.hb(tt) * (0.60 - 0.10 * t);
      const ang = a * Math.PI;
      const h = 0.20 + 0.05 * Math.sin(Math.PI * t);
      return [Math.cos(ang) * w, hull.sheer(tt) + h * Math.sin(ang) * 0.95 + 0.02,
        (0.5 - tt) * spec.loa];
    }), MAT.deck());
    body.add(trunk);

    /* Keel and its bulb. */
    const keelTop = hull.bottom(0.55);
    const keel = new THREE.Mesh(
      foilGeometry(u => 1.30 - 0.45 * u, keelTop, -spec.draft, 0.11, u => -0.10 - 0.12 * u),
      MAT.dark());
    body.add(keel);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 8), MAT.dark());
    bulb.scale.set(0.85, 0.72, 3.4);
    bulb.position.set(0, -spec.draft + 0.10, -0.34);
    body.add(bulb);

    /* Rudder hangs in its own group so it can be steered. */
    this.rudderPivot = new THREE.Group();
    this.rudderPivot.position.set(0, hull.bottom(0.97) + 0.06, (0.5 - 0.965) * spec.loa);
    this.rudderPivot.add(new THREE.Mesh(
      foilGeometry(u => 0.46 - 0.14 * u, 0.34, -1.02, 0.11, () => 0.0), MAT.dark()));
    body.add(this.rudderPivot);

    /* Rig: a tapered mast, raked a little aft, with a boom on a pivot. */
    const mastFoot = new THREE.Vector3(0, hull.sheer(0.32) + 0.05, (0.5 - 0.32) * spec.loa);
    this.mastFoot = mastFoot;
    this.mastHeight = spec.mastHeight;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.075, spec.mastHeight, 10, 1), MAT.spar());
    mast.position.copy(mastFoot).add(new THREE.Vector3(0, spec.mastHeight / 2, -0.16));
    mast.rotation.x = -0.033;                      // rake
    body.add(mast);

    this.boomPivot = new THREE.Group();
    this.boomPivot.position.copy(mastFoot).add(new THREE.Vector3(0, 1.18, -0.12));
    this.boomLength = 2.95;
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.052, this.boomLength, 8), MAT.spar());
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0, -this.boomLength / 2);
    this.boomPivot.add(boom);
    body.add(this.boomPivot);

    if (this.detail > 0.5) {
      // Spreaders and standing rigging.
      const spH = spec.mastHeight * 0.58;
      for (const side of [1, -1]) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 6), MAT.spar());
        sp.rotation.z = Math.PI / 2;
        sp.position.set(side * 0.39, mastFoot.y + spH, mastFoot.z - 0.16);
        body.add(sp);
        this.addWire(body, [side * 0.78, mastFoot.y + spH, mastFoot.z - 0.16],
          [side * hull.hb(0.36) * 0.94, hull.sheer(0.36), (0.5 - 0.36) * spec.loa]);
        this.addWire(body, [0, mastFoot.y + spec.mastHeight * 0.99, mastFoot.z - 0.32],
          [side * 0.78, mastFoot.y + spH, mastFoot.z - 0.16]);
      }
      // Forestay and backstay.
      this.addWire(body, [0, mastFoot.y + spec.mastHeight * 0.99, mastFoot.z - 0.32],
        [0, hull.sheer(0.02) + 0.02, (0.5 - 0.015) * spec.loa]);
      this.addWire(body, [0, mastFoot.y + spec.mastHeight * 0.99, mastFoot.z - 0.32],
        [0, hull.sheer(0.99), (0.5 - 0.995) * spec.loa]);
    }

    /* Sails. */
    const segs = this.detail > 0.5 ? [10, 9] : [6, 5];
    this.main = new Sail(segs[0], segs[1], MAT.sail());
    this.jib = new Sail(segs[0], segs[1], MAT.sail());
    this.kite = new Sail(segs[0] + 2, segs[1] + 2, MAT.kite(opts.kite ?? 0xffb03a));
    body.add(this.main.mesh, this.jib.mesh, this.kite.mesh);
    this.kite.mesh.visible = false;

    /* Crew, hiking on the windward rail. */
    this.crew = [];
    if (this.detail > 0.5) {
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.44, 4, 8),
          new THREE.MeshStandardMaterial({ color: i === 0 ? 0xc9432f : 0x27405c, roughness: 0.8 }));
        torso.rotation.x = Math.PI / 2.7;
        torso.position.y = 0.30;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xe8c39a, roughness: 0.85 }));
        head.position.set(0, 0.60, 0.16);
        const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.52, 4, 6),
          new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.85 }));
        legs.rotation.x = Math.PI / 2;
        legs.position.set(0, 0.10, -0.34);
        g.add(torso, head, legs);
        g.position.z = (0.5 - (0.66 + i * 0.09)) * spec.loa;
        this.crew.push(g);
        body.add(g);
      }
    }

    this.sailNumber = opts.sail || '';
    this.side = 1;
  }

  addWire(parent, a, b) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 4), MAT.wire());
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      vb.clone().sub(va).normalize());
    parent.add(m);
    return m;
  }

  /* Drive the model from the simulation state. */
  update(boat, time, dt) {
    const tel = boat.tel;
    // Sunk a hand's width below the sampled wave height: the water surface carries a
    // horizontal Gerstner displacement the sampler ignores, and this keeps that small
    // mismatch from showing the top of the keel.
    this.root.position.set(boat.x, boat.y - 0.12, boat.z);
    this.yaw.rotation.y = boat.psi;
    this.roll.rotation.z = -boat.phi;
    this.pitch.rotation.x = -boat.pitch;

    const beta = tel.sailAngle;                    // signed boom angle, + to starboard
    // Rotation about +Y sends local +z toward (sin, cos), so the boom — built aft along
    // -z — needs the opposite sign to swing out to the side the physics put it.
    this.boomPivot.rotation.y = -beta;
    this.rudderPivot.rotation.y = -boat.rudder;    // blade to starboard turns the bow that way

    const luff = tel.luffing ? 1 : 0;
    const load = Math.min(1, tel.attack / 0.36);   // how hard the sail is working
    const shake = luff ? 1 : (tel.backed ? 0.55 : 0);
    const side = Math.sign(beta) || boat.boomSide || 1;
    this.side = side;

    /* Mainsail: luff up the mast, foot along the boom, twisting open aloft. */
    const foot = this.boomLength;
    const luffLen = this.mastHeight * 0.94;
    const base = this.mastFoot;
    const reefLose = 0.34 * (boat.reef || 0);
    this.main.shape((u, w) => {
      const uu = u * (1 - reefLose);
      const c = foot * (1 - 0.80 * Math.pow(uu, 1.45));
      const twist = beta * (1 + 0.44 * uu);
      const cx = Math.sin(twist), cz = -Math.cos(twist);
      const cam = (0.115 * c * (1 - 0.30 * uu)) * (0.28 + 0.72 * load) * (1 - 0.55 * luff);
      const bulge = Math.pow(Math.sin(Math.PI * Math.pow(w, 0.86)), 0.85);
      const flap = shake * 0.30 * c * w * Math.sin(w * 7.0 + time * 17.0 + uu * 4.0);
      const px = base.x + cx * c * w + side * (cam * bulge + flap) * Math.cos(twist);
      const pz = base.z + cz * c * w - 0.12 - uu * 0.34 + side * (cam * bulge + flap) * Math.sin(twist);
      return [px, base.y + 1.05 + uu * (luffLen - 1.05), pz];
    });

    /* Headsail: luff up the forestay, which rakes aft to the masthead, and sheeted
       harder than the main. */
    const stayTop = base.y + this.mastHeight * 0.94;
    const stayTopZ = base.z - 0.32;
    const bowZ = (0.5 - 0.015) * this.spec.loa;
    const deckY = this.hull.sheer(0.02);
    const jibBeta = beta * 0.52;
    const jibFoot = 2.25;
    this.jib.shape((u, w) => {
      const c = jibFoot * (1 - 0.86 * Math.pow(u, 1.25));
      const twist = jibBeta * (1 + 0.5 * u);
      const lx = 0, ly = deckY + u * (stayTop - deckY), lz = bowZ + u * (stayTopZ - bowZ);
      const cam = (0.10 * c) * (0.28 + 0.72 * load) * (1 - 0.6 * luff);
      const bulge = Math.pow(Math.sin(Math.PI * Math.pow(w, 0.88)), 0.85);
      const flap = shake * 0.34 * c * w * Math.sin(w * 8.0 + time * 19.0 + u * 5.0);
      return [
        lx + Math.sin(twist) * c * w + side * (cam * bulge + flap) * Math.cos(twist),
        ly,
        lz - Math.cos(twist) * c * w + side * (cam * bulge + flap) * Math.sin(twist)
      ];
    });

    /* Spinnaker: flown off the bow, bellying out to leeward. */
    this.kite.mesh.visible = !!boat.spinnaker;
    this.jib.mesh.visible = !boat.spinnaker;
    if (boat.spinnaker) {
      const headY = base.y + this.mastHeight * 0.90;
      const tack = [side * 0.15, deckY + 0.35, bowZ + 0.75];
      const clewA = Math.max(0.75, Math.min(1.45, Math.abs(beta) * 0.8 + 0.70));
      const clew = [side * Math.sin(clewA) * 4.0, deckY + 1.45, bowZ - Math.cos(clewA) * 3.4 - 0.8];
      const kiteShake = luff * 0.5;
      const fill = 0.45 + 0.55 * load;
      this.kite.shape((u, w) => {
        // Luff and leech both curve out from the head: a kite is a fat sail, and a
        // straight-sided triangle reads as a bedsheet.
        const shoulder = Math.pow(Math.sin(Math.PI * u), 0.62);
        const lx = tack[0] * u - side * 0.55 * shoulder;
        const ly = headY + (tack[1] - headY) * u;
        const lz = tack[2] * u + 0.45 * shoulder;
        const ex = clew[0] * u + side * 1.75 * shoulder;
        const ey = headY + (clew[1] - headY) * u;
        const ez = -0.30 * (1 - u) + clew[2] * u + 0.30 * shoulder;
        const px = lx + (ex - lx) * w, py = ly + (ey - ly) * w, pz = lz + (ez - lz) * w;
        const belly = 1.45 * Math.sin(Math.PI * Math.pow(w, 0.88)) *
          Math.sin(Math.PI * (0.10 + u * 0.86)) * fill;
        const wob = kiteShake * 0.4 * Math.sin(w * 6.0 + time * 12.0 + u * 3.0);
        return [px + side * (belly + wob) * 0.80, py + belly * 0.12, pz - belly * 0.62];
      });
    }

    /* Crew hike out to windward as it blows up, and shift aft when pressed. */
    const hike = Math.min(1, Math.abs(boat.phi) * 3.4);
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      const rail = this.hull.hb(0.66 + i * 0.09) * 0.86;
      c.position.x = -side * rail * (0.35 + 0.65 * hike);
      c.position.y = this.hull.sheer(0.7) - 0.05;
      c.rotation.z = side * hike * 0.55;
      c.rotation.y = side * 0.25;
      c.visible = !boat.spinnaker || i < 3;
    }
  }
}
