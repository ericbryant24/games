import { Boat, CLASS_7M, KTS } from '../games/sailing/src/physics.js';
import { Wind } from '../games/sailing/src/wind.js';
const flat = { count:0, sample:(x,z,t,o={})=>{o.y=0;o.dhdx=0;o.dhdz=0;o.nx=0;o.ny=1;o.nz=0;return o;},
               surfaceVelocity:(x,z,t,o={})=>{o.x=0;o.y=0;o.z=0;return o;} };
export function run(twaDeg, tws, u0=2.5, spin=null, secs=140) {
  const wind = new Wind(0, tws); wind.shifty = 0; wind.gustiness = 0;
  const env = { wind, waves: flat, time: 0 };
  const b = new Boat(CLASS_7M, { psi: twaDeg*Math.PI/180 });
  b.spinnaker = spin === null ? Math.abs(twaDeg) >= 115 : spin;
  b.u = u0; const target = b.psi; const dt = 1/60;
  for (let i=0;i<secs*60;i++){
    env.time+=dt; wind.update(dt);
    let err = target-b.psi; while(err>Math.PI)err-=2*Math.PI; while(err<-Math.PI)err+=2*Math.PI;
    b.rudder = Math.max(-0.6,Math.min(0.6, err*2.4 - b.r*1.9));
    if (i%6===0) b.trimTarget = b.bestTrim(Math.abs(twaDeg)<58?"point":"drive"); b.slewTrim(b.trimTarget??b.trim, dt, 0.5);
    b.step(dt, env);
  }
  return b;
}
if (process.argv[2] !== 'lib') {
  for (const tws of [5,7,10,13]) {
    console.log(`\n=== TWS ${(tws*KTS).toFixed(1)} kn ===`);
    console.log('TWA  spd(kn)  VMG   heel  leew  trim  atk  AWA  |  from-rest');
    let bestUp={v:-9},bestDn={v:9};
    for (const twa of [30,35,38,40,42,45,50,55,60,75,90,110,125,140,150,160,170,180]) {
      const b=run(twa,tws); const t=b.tel;
      const r=run(twa,tws,0.2,null,60);
      if(t.vmg>bestUp.v)bestUp={v:t.vmg,twa};
      if(t.vmg<bestDn.v)bestDn={v:t.vmg,twa};
      console.log(String(twa).padStart(3),(t.speed*KTS).toFixed(2).padStart(6),(t.vmg*KTS).toFixed(2).padStart(6),
        t.heelDeg.toFixed(0).padStart(5),(t.leeway*57.3).toFixed(1).padStart(5),b.trim.toFixed(2).padStart(6),
        (t.attack*57.3).toFixed(0).padStart(4),(Math.abs(t.awa)*57.3).toFixed(0).padStart(4),' | ',
        (r.tel.speed*KTS).toFixed(2).padStart(5));
    }
    console.log(`best upwind VMG ${(bestUp.v*KTS).toFixed(2)} kn @ ${bestUp.twa}deg | best downwind ${(-bestDn.v*KTS).toFixed(2)} kn @ ${bestDn.twa}deg`);
  }
}
