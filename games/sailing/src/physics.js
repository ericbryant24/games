/* Keelboat dynamics: sail aerodynamics, keel and rudder hydrodynamics, hull
   resistance with a wave-making wall, heel with a real righting moment, and
   wave-driven pitch, roll and surge.
   World frame: +x east, +z north, +y up. Heading is a compass bearing in radians
   (0 = north) and the boat's forward vector is (sin psi, cos psi).
   Boat frame: u = surge (forward), v = sway (to starboard), r = yaw rate. */

const RHO_AIR = 1.225;
const CE_LEAD = 0.30;   // rig's centre of effort, metres forward of the CG when upright
const HEEL_SHIFT = 1.25; // how far that balance point walks aft as the boat heels
const CE_ARM = 1.15;    // how far the effort swings to leeward as the boom goes out
const RHO_WATER = 1025;
const G = 9.81;

export const KTS = 1.9438445; // m/s -> knots

/* A 7-metre one-design sportboat: quick, stiff enough to stand up to a breeze,
   and small enough that every gust shows up in the helm. */
export const CLASS_7M = {
  name: 'Rocket 7',
  loa: 7.0, lwl: 6.45, beam: 2.28, draft: 1.48,
  mass: 1450,           // displacement, kg
  wetted: 12.0,         // wetted surface, m^2
  formGz: 2.55,         // form stability: a beamy hull gets much stiffer as it heels
  hikeMoment: 4200,     // crew hanging off the rail, N.m
  sailArea: 34.0,       // main + jib, m^2
  spinArea: 22.0,       // extra area with the kite up, m^2
  mastHeight: 10.4,
  gm: 1.05,             // metacentric height, m
  heelArm: 4.05,        // centre of effort above the centre of lateral resistance, m
  keelArea: 1.62, keelAR: 2.55, keelX: -0.15,
  rudderArea: 0.34, rudderAR: 3.1, rudderX: -2.62,
  izz: 6100,            // yaw inertia incl. added mass
  ixx: 3050,            // roll inertia incl. added mass
  maxRudder: 0.62       // ~35 degrees
};

/* ---- Aerofoil coefficients ------------------------------------------------ */

/* Sail lift: linear to a peak near 20 degrees of attack, then a long stalled tail.
   The tail matters — it is what drives the boat on a broad reach and a run. */
export function sailCL(a) {
  const s = Math.min(a, 0.36);
  let cl = 4.03 * s;                                  // attached, slope ~2pi/(1+2/AR)
  if (a > 0.36) cl = 1.45 * Math.exp(-(a - 0.36) * 1.15) + 0.35 * Math.sin(2 * a);
  return cl;
}
/* Sail drag: rig parasitic + induced + separation. Near 90 degrees this is most
   of the force, which is why running is slow and pressing the sheet matters. */
export function sailCD(a, cl, ar = 2.8) {
  const sa = Math.sin(a);
  return 0.10 + (cl * cl) / (Math.PI * ar * 0.92) + 1.15 * sa * sa * sa;
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* Thin high-aspect foil (keel, rudder): linear then a hard stall. */
function foilCL(a, slope, clMax) {
  const m = Math.abs(a) * slope;
  // Past stall a blade still works like a flat plate — less lift, but far from none.
  const cl = m <= clMax ? m : clMax * Math.max(0.5, 1 - (m - clMax) * 0.40);
  return Math.sign(a) * cl;
}

/* Total hull resistance coefficient against Froude number: skin friction plus a
   residuary term that climbs steeply as the boat approaches hull speed. */
export function hullCt(fn) {
  const r = Math.max(fn, 0) / 0.42;
  return 0.0032 + 0.0075 * Math.pow(r, 4.2);
}

const _wind = { from: 0, speed: 0 };
const _wave = { y: 0, nx: 0, ny: 1, nz: 0, dhdx: 0, dhdz: 0, hullX: 0, hullZ: 0 };
const _orb = { x: 0, y: 0, z: 0 };

export class Boat {
  constructor(spec = CLASS_7M, opts = {}) {
    this.spec = spec;
    this.name = opts.name || spec.name;
    this.sail = opts.sail || '—';
    this.isPlayer = !!opts.isPlayer;

    this.x = opts.x || 0; this.z = opts.z || 0;
    this.psi = opts.psi || 0;
    this.u = 0.2; this.v = 0; this.r = 0;
    this.phi = 0; this.phiDot = 0;      // heel, + = heeled to starboard
    this.pitch = 0;
    this.y = 0;

    this.boomSide = 0;    // which side the boom is on: -1 port, +1 starboard
    this.reef = 0;        // 0 = full sail, 1 = deeply reefed
    this.rudder = 0;      // commanded blade angle, rad, + = bow swings to starboard
    this.trim = 0.35;     // 0 = sheeted flat, 1 = fully eased
    this.spinnaker = false;

    // Telemetry for the HUD and the AI.
    this.tel = {
      tws: 0, twa: 0, twFrom: 0, aws: 0, awa: 0, sailAngle: 0, attack: 0,
      luffing: false, stalled: false, drive: 0, side: 0, heelDeg: 0,
      speed: 0, vmg: 0, leeway: 0, flow: 0
    };
    this.wake = 0;        // 0..1 how hard the boat is working the water
    this.spray = 0;
  }

  get speed() { return Math.hypot(this.u, this.v); }
  /* Working sail area. Rolling in a reef takes area out of the top of the rig, which
     is why it costs so much less speed than it does heeling moment. */
  get sailAreaNow() {
    return this.spec.sailArea * (1 - 0.40 * this.reef) +
      (this.spinnaker ? this.spec.spinArea : 0);
  }
  get heelArmNow() {
    return this.spec.heelArm * (1 - 0.20 * this.reef);
  }
  /* Bearing the boat is making good over the ground. */
  get courseOverGround() {
    const fx = Math.sin(this.psi), fz = Math.cos(this.psi);
    const sx = Math.cos(this.psi), sz = -Math.sin(this.psi);
    return Math.atan2(this.u * fx + this.v * sx, this.u * fz + this.v * sz);
  }

  step(dt, env) {
    const S = this.spec;
    const t = env.time;

    /* --- true and apparent wind ------------------------------------------- */
    env.wind.sampleFor(this.x, this.z, this, _wind);
    const tws = _wind.speed;
    // Wind velocity vector: it blows *from* `from`, so it travels the other way.
    const twx = -Math.sin(_wind.from) * tws;
    const twz = -Math.cos(_wind.from) * tws;

    const fx = Math.sin(this.psi), fz = Math.cos(this.psi);   // forward
    const sx = Math.cos(this.psi), sz = -Math.sin(this.psi);  // starboard

    // Boat velocity over ground, world frame.
    const bvx = this.u * fx + this.v * sx;
    const bvz = this.u * fz + this.v * sz;

    // Apparent wind = true wind minus boat motion, in the boat frame.
    const awx_w = twx - bvx, awz_w = twz - bvz;
    const awU = awx_w * fx + awz_w * fz;
    const awV = awx_w * sx + awz_w * sz;
    const aws = Math.hypot(awU, awV);
    // Angle the apparent wind comes FROM, relative to the bow. + = from starboard.
    const awaSigned = Math.atan2(-awV, -awU);
    const a = Math.abs(awaSigned);
    const side = awaSigned >= 0 ? 1 : -1;

    /* --- sail force -------------------------------------------------------- */
    // The boom stays on the side it is on until the wind is clearly across the other
    // way. That hysteresis is what makes a gybe a real event, and it is what lets a
    // boat back its sail and steer out of irons instead of parking there forever.
    const wantSide = -Math.sign(awaSigned || 1);
    if (!this.boomSide) this.boomSide = wantSide;
    else if (wantSide !== this.boomSide && a > 0.055 && a < 3.05) this.boomSide = wantSide;

    const sheetMax = 0.075 + this.trim * (this.spinnaker ? 1.62 : 1.48);
    // Blown out to the sheet stop, or only as far as the wind if the sheet is easier.
    // Backed means the boom is on the same side the wind is coming from: the wind is
    // pressing the windward face of the sail.
    const backed = this.boomSide !== wantSide;
    const boomMag = backed ? sheetMax : Math.min(a, sheetMax);
    const beta = this.boomSide * boomMag;             // signed boom angle, + = to starboard

    // Angle between the sail chord and the flow. Positive means the wind is on the
    // leeward face and the sail is driving; negative means the sail is backed.
    const alpha = wrapAngle(awaSigned + beta);
    const attack = Math.abs(alpha);
    const luffing = attack < 0.035;

    const cosPhi = Math.cos(this.phi);
    // Running square, the main blankets the headsail and the rig loses its bite.
    const blanket = 1 - 0.50 * smoothstep(2.27, 3.0, a);
    const q = 0.5 * RHO_AIR * aws * aws * this.sailAreaNow * blanket * Math.max(0.25, cosPhi);

    let cl = luffing ? 0 : sailCL(attack) * Math.sign(alpha);
    let cd = luffing ? 0.055 : sailCD(attack, cl, this.spinnaker ? 2.2 : 2.8);
    if (this.spinnaker && a < 1.25) { cl *= 0.55; cd *= 0.8; }   // the kite is no use upwind
    // A backed sail is half collapsed and flogging, not cleanly driving. It keeps just
    // enough in it to stop a lazy tack or spin the bow out of irons.
    if (backed) { cl *= 0.42; cd *= 0.42; }

    // Drag runs with the flow; lift is square to it.
    const flowU = -Math.cos(awaSigned), flowV = -Math.sin(awaSigned);
    const liftU = Math.sin(awaSigned), liftV = -Math.cos(awaSigned);
    const sailU = q * (cl * liftU + cd * flowU);
    const sailV = q * (cl * liftV + cd * flowV);

    /* --- hull resistance --------------------------------------------------- */
    const u = this.u, v = this.v;
    const spd = Math.hypot(u, v);
    const fn = Math.abs(u) / Math.sqrt(G * S.lwl);
    const ct = hullCt(fn);
    const resist = 0.5 * RHO_WATER * S.wetted * ct * u * Math.abs(u);
    // Heel drags the leeward side of the hull deeper and adds a little resistance.
    const heelPenalty = 1 + 0.55 * Math.sin(Math.abs(this.phi)) * Math.sin(Math.abs(this.phi)) * 4;
    let hullU = -resist * heelPenalty;

    /* --- keel: side force and induced drag --------------------------------- */
    const flowSpeed = Math.max(0.4, Math.abs(u));
    const leeway = Math.atan2(v, Math.max(0.4, Math.abs(u)));  // + = slipping to starboard
    const qw = 0.5 * RHO_WATER * flowSpeed * flowSpeed;
    // The keel is a foil at the leeway angle; its lift opposes the slip.
    const keelCL = foilCL(-leeway, 3.5 * cosPhi, 1.25);
    const keelLift = qw * S.keelArea * keelCL;
    const keelCDi = (keelCL * keelCL) / (Math.PI * S.keelAR * 0.9) + 0.008;
    const keelDrag = qw * S.keelArea * keelCDi;
    // Broadside form drag once the keel gives up (big leeway, e.g. mid-tack).
    const bluff = -Math.sign(v) * 0.5 * RHO_WATER * (S.lwl * S.draft * 0.42) * 1.1 * v * v;

    let hullV = keelLift + bluff;
    hullU -= keelDrag;

    /* --- rudder ------------------------------------------------------------ */
    // Flow at the blade is the hull's slip plus its rotation about the CG. The keel
    // and hull straighten a good part of the slip before it gets back there.
    const bladeSway = (v + this.r * S.rudderX) * 0.55;
    const bladeFlow = Math.max(0.4, Math.hypot(u, bladeSway));
    const bladeAngle = Math.atan2(bladeSway, Math.max(0.35, Math.abs(u)));
    const rudderAttack = this.rudder - bladeAngle;
    const rudCL = foilCL(rudderAttack, 3.2, 1.15);
    const qr = 0.5 * RHO_WATER * bladeFlow * bladeFlow;
    // Lateral force at the blade, + = to starboard. Helm over to starboard throws the
    // stern to port, which is what swings the bow the other way. Going astern the helm
    // works backwards, exactly as it does on the water.
    const rudderSide = -qr * S.rudderArea * rudCL * cosPhi * (u < 0 ? -1 : 1);
    const rudderDrag = qr * S.rudderArea *
      (0.010 + (rudCL * rudCL) / (Math.PI * S.rudderAR * 0.9) +
       0.9 * Math.pow(Math.sin(Math.min(1.5, Math.abs(rudderAttack))), 3));
    hullV += rudderSide;
    hullU -= rudderDrag;

    /* --- waves: pitch, roll and surf --------------------------------------- */
    env.waves.sample(this.x, this.z, t, _wave);
    // Use the hull-scale slope: chop shorter than the boat passes underneath it.
    const wx = _wave.hullX ?? _wave.dhdx, wz = _wave.hullZ ?? _wave.dhdz;
    const slopeAlong = wx * fx + wz * fz;                      // + = climbing
    const slopeAcross = wx * sx + wz * sz;
    const wavePitch = Math.atan(-slopeAlong);
    const waveRoll = Math.atan(slopeAcross);
    // Gravity along the wave face: this is what lets the boat surf downwind.
    hullU += -S.mass * G * Math.sin(Math.atan(slopeAlong)) * 0.30;
    // Orbital flow in the crest adds its own push and pull.
    env.waves.surfaceVelocity(this.x, this.z, t, _orb);
    hullU += (_orb.x * fx + _orb.z * fz) * 42;

    /* --- integrate surge and sway ------------------------------------------ */
    const mAddU = S.mass * 1.06;     // added mass, surge
    const mAddV = S.mass * 1.85;     // added mass, sway (a keel drags a lot of water)
    const du = (sailU + hullU) / mAddU + v * this.r;
    const dv = (sailV + hullV) / mAddV - u * this.r;
    this.u += du * dt;
    this.v += dv * dt;
    if (this.u < -1.2) this.u = -1.2;

    /* --- yaw --------------------------------------------------------------- */
    // A side force Fy acting at longitudinal station x makes a yaw moment x * Fy.
    let yaw = 0;
    yaw += rudderSide * S.rudderX;        // the blade works a long way aft
    yaw += keelLift * S.keelX;
    // Helm balance. A rig is stepped with its centre of effort forward of the hull's
    // centre of lateral resistance, so upright the boat carries a touch of lee helm and
    // bears away on its own from a standstill. Heel makes the immersed hull asymmetric,
    // walks that balance point aft, and turns the lee helm into the weather helm you
    // lean on going upwind. The second term is the effort swinging out with the boom,
    // which loads the helm on a run and spins the bow off when the sail is backed.
    // Heel counts with a sign: leaning to leeward gives weather helm, and a roll to
    // windward makes the boat bear away — which is exactly how you steer a dinghy
    // downwind with your body weight.
    const leewardHeel = -this.phi * side;
    const lead = CE_LEAD - HEEL_SHIFT * Math.sin(leewardHeel);
    yaw += lead * sailV - Math.sin(beta) * CE_ARM * sailU;
    // Directional damping from the hull and appendages. Kept light on purpose: a boat
    // carries its rotation through a tack, and the helmsman has to stop the turn.
    yaw += -this.r * (1200 + 900 * spd);
    this.r += (yaw / S.izz) * dt;
    this.psi += this.r * dt;
    if (this.psi > Math.PI) this.psi -= 2 * Math.PI;
    if (this.psi < -Math.PI) this.psi += 2 * Math.PI;

    /* --- heel -------------------------------------------------------------- */
    // The rig's side force acts well above the water, so it lays the boat over to leeward.
    const heelMoment = sailV * this.heelArmNow * cosPhi;
    // Righting arm: ballast plus form stability, which grows fast on a beamy hull.
    const sp = Math.sin(this.phi);
    const gz = sp * (S.gm + S.formGz * sp * sp);
    const righting = -S.mass * G * gz;
    const rollDamp = -this.phiDot * 2150;
    const waveExcite = (waveRoll - this.phi) * S.mass * 0.85;           // rides the wave face
    // Crew hang off the windward rail as soon as it starts to blow up.
    const crewRighting = -Math.sign(this.phi || 1) *
      Math.min(1, Math.abs(this.phi) * 3.8) * S.hikeMoment;
    this.phiDot += ((heelMoment + righting + rollDamp + waveExcite + crewRighting) / S.ixx) * dt;
    this.phi += this.phiDot * dt;
    if (Math.abs(this.phi) > 1.32) {  // knocked down: spill the rig and slow hard
      this.phi = Math.sign(this.phi) * 1.32;
      this.phiDot *= -0.25;
      this.u *= 0.985;
    }

    /* --- position ---------------------------------------------------------- */
    this.x += (this.u * fx + this.v * sx) * dt;
    this.z += (this.u * fz + this.v * sz) * dt;
    this.y = _wave.y;
    this.pitch += (wavePitch * 0.85 - Math.min(0.055, fn * 0.10) - this.pitch) * Math.min(1, dt * 6.5);

    /* --- telemetry --------------------------------------------------------- */
    const tel = this.tel;
    tel.tws = tws; tel.twFrom = _wind.from; tel.aws = aws; tel.awa = awaSigned;
    // True wind angle: where the true wind sits relative to the bow.
    let twa = _wind.from - this.psi;
    while (twa > Math.PI) twa -= 2 * Math.PI;
    while (twa < -Math.PI) twa += 2 * Math.PI;
    tel.twa = twa;
    tel.sailAngle = beta;
    tel.attack = attack; tel.luffing = luffing;
    tel.backed = backed && !luffing;
    tel.stalled = attack > 0.42 && a < 1.4;
    tel.drive = sailU; tel.side = sailV;
    tel.heelDeg = this.phi * 180 / Math.PI;
    tel.speed = Math.hypot(this.u, this.v);
    tel.vmg = tel.speed * Math.cos(twa);   // + = making ground upwind
    tel.leeway = leeway;
    tel.flow = flowSpeed;

    if (this.debug) {
      this.dbg = {
        sailU, sailV, hullU, hullV, resist, keelLift, keelDrag, bluff,
        rudderSide, rudderDrag, rudderAttack, bladeAngle, alpha, beta,
        yawRudder: rudderSide * S.rudderX, yawKeel: keelLift * S.keelX,
        lead, yawSail: lead * sailV - Math.sin(beta) * CE_ARM * sailU,
        yawDamp: -this.r * (1200 + 900 * spd), leeway, u, v, r: this.r
      };
    }
    const work = Math.min(1, tel.speed / 4.6);
    this.wake += (work - this.wake) * Math.min(1, dt * 3);
    this.spray += (Math.min(1, Math.max(0, (tel.speed - 2.6) / 3.2) *
      (0.4 + Math.abs(wavePitch) * 3.2)) - this.spray) * Math.min(1, dt * 4);
  }

  /* Ease the sheet toward a target at a believable hauling rate. */
  slewTrim(target, dt, rate = 0.55) {
    const d = target - this.trim;
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    this.trim = Math.max(0, Math.min(1, this.trim + step));
  }

  /* Best sheet setting for the current apparent wind. Rather than chasing the heel
     angle (which oscillates), this asks the question a crew actually asks: how much
     side force can we carry and still keep the boat on its feet? Then it takes the
     most drive available inside that budget. */
  bestTrim(mode = 'drive', heelTargetDeg = 22) {
    const a = Math.abs(this.tel.awa);
    const aws = this.tel.aws;
    if (aws < 0.2) return this.trim;
    const S = this.spec;

    // Side force that would settle the boat at the target heel, crew hiking included.
    const pt = heelTargetDeg * Math.PI / 180;
    const spt = Math.sin(pt);
    const gz = spt * (S.gm + S.formGz * spt * spt);
    const hike = Math.min(1, pt * 3.8) * S.hikeMoment;
    const sideBudget = (S.mass * G * gz + hike) / (this.heelArmNow * Math.cos(pt));

    const blanket = 1 - 0.50 * smoothstep(2.27, 3.0, a);
    const q = 0.5 * RHO_AIR * aws * aws * this.sailAreaNow * blanket *
      Math.max(0.25, Math.cos(this.phi));
    const lambda = mode === 'point' ? 0.06 : 0.02;  // a fixed, gentle bias off side force
    const span = this.spinnaker ? 1.62 : 1.48;

    let best = this.trim, bestScore = -Infinity, calmest = this.trim, calmestSide = Infinity;
    for (let i = 0; i <= 24; i++) {
      const trim = i / 24;
      const attack = Math.abs(a - Math.min(a, 0.075 + trim * span));
      let cl, cd;
      if (attack < 0.035) { cl = 0; cd = 0.055; }
      else { cl = sailCL(attack); cd = sailCD(attack, cl, this.spinnaker ? 2.2 : 2.8); }
      if (this.spinnaker && a < 1.25) { cl *= 0.55; cd *= 0.8; }
      const drive = q * (cl * Math.sin(a) - cd * Math.cos(a));
      const side = Math.abs(q * (cl * Math.cos(a) + cd * Math.sin(a)));
      if (side < calmestSide) { calmestSide = side; calmest = trim; }
      if (side > sideBudget) continue;                 // would put the rail under
      const score = drive - lambda * side;
      if (score > bestScore) { bestScore = score; best = trim; }
    }
    // Nothing fits the budget: carry the least side force we can and hang on.
    return bestScore === -Infinity ? calmest : best;
  }
}
