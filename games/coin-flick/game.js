(()=>{
'use strict';
const TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const easeOut=t=>1-Math.pow(1-t,3);
const hypot=(x,y)=>Math.hypot(x,y);
const mulberry32=(seed)=>{let a=(seed>>>0)||1;return()=>{let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};};
const qs=()=>new URLSearchParams(location.search);
const DEBUG=qs().get('debug')==='true';
let SEED=(()=>{const s=qs().get('seed');const n=s?parseInt(s,10):NaN;return Number.isFinite(n)?(n|0):((Math.random()*1e9)|0);})();
const setSeedInUrl=(s)=>{const p=qs();p.set('seed',String(s));if(DEBUG)p.set('debug','true');try{history.replaceState({},'',`${location.pathname}?${p.toString()}`);}catch{}};
setSeedInUrl(SEED);

// DOM
const cv=document.getElementById('gameCanvas');
const g=cv.getContext('2d',{alpha:false,desynchronized:true});
const ui={
  ps:document.getElementById('playerScore'),
  as:document.getElementById('aiScore'),
  toast:document.getElementById('toast'),
  ante:document.getElementById('anteVal'),
  pot:document.getElementById('potVal'),
  newBtn:document.getElementById('newMatchBtn'),
  projBtn:document.getElementById('projBtn'),
  sndBtn:document.getElementById('soundBtn'),
  ov:document.getElementById('overlay'),
  ovT:document.getElementById('overlayTitle'),
  ovS:document.getElementById('overlaySub'),
  again:document.getElementById('playAgainBtn'),
  rematch:document.getElementById('rematchBtn'),
};

// Audio (procedural)
const S=(()=>{
  let ctx=null,master=null,enabled=true,lastPing=0;
  const ensure=()=>{if(ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();master=ctx.createGain();master.gain.value=0.85;master.connect(ctx.destination);};
  const unlock=async()=>{if(!enabled)return;ensure();if(!ctx)return;try{if(ctx.state==='suspended')await ctx.resume();}catch{}};
  const env=(gn,t0,a,d,peak)=>{const gg=gn.gain;gg.cancelScheduledValues(t0);gg.setValueAtTime(0.0001,t0);gg.exponentialRampToValueAtTime(Math.max(0.0002,peak),t0+a);gg.exponentialRampToValueAtTime(0.0001,t0+a+d);};
  const tone=(type,inten=1,tone=0.3)=>{if(!enabled)return;ensure();if(!ctx)return;const now=performance.now();if(type==='ping'&&now-lastPing<35)return;lastPing=now;const t0=ctx.currentTime;
    const o=ctx.createOscillator(),o2=ctx.createOscillator(),gn=ctx.createGain();
    if(type==='ping'){
      const base=lerp(820,1550,clamp(inten,0,1))+lerp(-18,22,tone);
      o.type='triangle';o.frequency.setValueAtTime(base,t0);
      o2.type='sine';o2.frequency.setValueAtTime(base*1.98,t0);
      env(gn,t0,0.005,lerp(0.07,0.12,inten),lerp(0.04,0.14,inten));
      const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.setValueAtTime(6500,t0);
      o.connect(gn);o2.connect(gn);gn.connect(lp);lp.connect(master);
      o.start(t0);o2.start(t0);o.stop(t0+0.16);o2.stop(t0+0.16);
      return;
    }
    if(type==='buzz'){
      o.type='square';o.frequency.setValueAtTime(110,t0);o.frequency.exponentialRampToValueAtTime(80,t0+0.18);
      const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.setValueAtTime(140,t0);bp.Q.setValueAtTime(1.2,t0);
      env(gn,t0,0.01,0.18,0.09);o.connect(bp);bp.connect(gn);gn.connect(master);
      o.start(t0);o.stop(t0+0.22);return;
    }
    if(type==='chime'){
      o.type='sine';o.frequency.setValueAtTime(420,t0);o.frequency.exponentialRampToValueAtTime(920,t0+0.14);
      const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(240,t0);
      env(gn,t0,0.01,0.18,0.12);o.connect(hp);hp.connect(gn);gn.connect(master);
      o.start(t0);o.stop(t0+0.24);return;
    }
    if(type==='fall'){
      o.type='sine';o.frequency.setValueAtTime(560,t0);o.frequency.exponentialRampToValueAtTime(140,t0+0.26);
      env(gn,t0,0.01,0.28,0.10);o.connect(gn);gn.connect(master);
      o.start(t0);o.stop(t0+0.32);return;
    }
  };
  const win=()=>{if(!enabled)return;ensure();if(!ctx)return;const t0=ctx.currentTime;[440,554,659].forEach((f,i)=>{const t=t0+i*0.11;const o=ctx.createOscillator(),gn=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(f,t);env(gn,t,0.01,0.14,0.10);o.connect(gn);gn.connect(master);o.start(t);o.stop(t+0.18);});};
  return {unlock,setEnabled:(on)=>{enabled=!!on;if(master&&ctx)master.gain.setTargetAtTime(enabled?0.85:0,ctx.currentTime,0.01);},get enabled(){return enabled;},ping:(i,t)=>tone('ping',i,t),buzz:()=>tone('buzz'),chime:()=>tone('chime'),fall:()=>tone('fall'),win};
})();

// Tunables
const DT=1/60;
const FRICTION=6.0;      // v *= (1 - FRICTION*dt)
const REST=20;           // px/s (~0.02 px/ms)
const MAX_DRAG=140;
const POWER=7.2;         // px/s per px drag
const MAX_V=1350;
const R=16;
const E_CC=0.92, E_OB=0.85, E_W=0.80;

// World + state
let DPR=1,W=0,H=0;
let table={x:0,y:0,w:0,h:0,r:18};
let coins=[],obs=[];
let active=null;
let scores={p:0,a:0};
let stack={p:[],a:[]};
let state='SETUP';
let owner='p';
let firstShot=true;
let shot=null; // {sh:'p'|'a',id,t:Set,anyOff,shotOff,srcs,pt,early}
let acc=0,lastT=0;
let wood=null,spr=null;
let fly=[],fall=[],burst=[];
let matchId=0,aiTimer=0;
let drag={on:false,pid:null,sx:0,sy:0,x:0,y:0};
let toastT=0;
const opt={proj:true};

let rand=mulberry32(SEED);
const rnd=()=>rand();

const pilePos=(who)=>{
  const y=table.y+table.h*0.52;
  return who==='p'?{x:table.x*0.55,y}:{x:table.x+table.w+(W-(table.x+table.w))*0.45,y};
};
const tableCenter=()=>({x:table.x+table.w*0.5,y:table.y+table.h*0.5});

function buildWood(){
  const c=document.createElement('canvas');c.width=c.height=384;
  const ctx=c.getContext('2d');
  const r=mulberry32((SEED^0x9e3779b9)>>>0);
  const g0=ctx.createLinearGradient(0,0,0,384);g0.addColorStop(0,'#6c3f20');g0.addColorStop(1,'#8a5329');
  ctx.fillStyle=g0;ctx.fillRect(0,0,384,384);
  for(let x=0;x<384;x++){
    const a=x+SEED*0.001;
    const n=(Math.sin(a*0.08)+0.6*Math.sin(a*0.021)+0.25*Math.sin(a*0.37));
    const al=0.06+0.06*(n*0.5+0.5);
    ctx.fillStyle=`rgba(0,0,0,${al})`;ctx.fillRect(x,0,1,384);
  }
  for(let i=0;i<5;i++){
    const kx=r()*384,ky=r()*384,kr=lerp(22,52,r());
    const kg=ctx.createRadialGradient(kx,ky,0,kx,ky,kr);
    kg.addColorStop(0,'rgba(0,0,0,0.20)');kg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=kg;ctx.beginPath();ctx.arc(kx,ky,kr,0,TAU);ctx.fill();
  }
  for(let i=0;i<6000;i++){const x=(r()*384)|0,y=(r()*384)|0;ctx.fillStyle=r()>0.5?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.03)';ctx.fillRect(x,y,1,1);} 
  wood=g.createPattern(c,'repeat');
}

function buildSprites(){
  const size=Math.ceil(R*2+10);
  const mk=(pal)=>{
    const c=document.createElement('canvas');c.width=c.height=size;
    const ctx=c.getContext('2d');const x=size/2,y=size/2;
    const gr=ctx.createRadialGradient(x-R*0.35,y-R*0.35,R*0.2,x,y,R);
    gr.addColorStop(0,pal[0]);gr.addColorStop(0.55,pal[1]);gr.addColorStop(1,pal[2]);
    ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,R,0,TAU);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.25)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,R-1,0,TAU);ctx.stroke();
    ctx.strokeStyle='rgba(0,0,0,0.28)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,R-2.5,0,TAU);ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.28)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x-R*0.12,y-R*0.18,R*0.78,-0.25,0.75);ctx.stroke();
    return c;
  };
  spr={
    b:mk(['rgba(255,214,160,0.98)','rgba(200,132,66,0.98)','rgba(112,64,26,0.98)']),
    s:mk(['rgba(245,248,255,0.98)','rgba(190,196,210,0.98)','rgba(110,116,130,0.98)']),
    size
  };
}

function resize(){
  const r=cv.getBoundingClientRect();
  DPR=clamp(devicePixelRatio||1,1,2.5);
  W=Math.max(320,Math.floor(r.width));
  H=Math.max(320,Math.floor(r.height));
  cv.width=Math.floor(W*DPR);cv.height=Math.floor(H*DPR);
  const padX=clamp(W*0.14,70,160),padY=clamp(H*0.12,70,140);
  const old={...table};const had=table.w>1&&coins.length;
  table={x:padX,y:padY,w:W-padX*2,h:H-padY*2,r:clamp(Math.min(W,H)*0.03,14,22)};
  if(had){
    const sx=table.w/old.w,sy=table.h/old.h;
    const adj=(o)=>{const u=(o.x-old.x)/old.w,v=(o.y-old.y)/old.h;o.x=table.x+u*table.w;o.y=table.y+v*table.h;o.vx*=sx;o.vy*=sy;};
    coins.forEach(adj);
    obs.forEach(o=>{const u=(o.x-old.x)/old.w,v=(o.y-old.y)/old.h;o.x=table.x+u*table.w;o.y=table.y+v*table.h;});
  }
  buildWood();buildSprites();
}

function clearActive(){active=null;}
function setActive(id){active=id;}
const coinById=(id)=>coins.find(c=>c.id===id)||null;

function genLayout(){
  coins=[];obs=[];clearActive();
  const t=table;
  const nObs=3+((rnd()*4)|0);
  for(let i=0;i<nObs;i++){
    const or=lerp(26,44,rnd());
    for(let k=0;k<700;k++){
      const x=lerp(t.x+or+R*1.2,t.x+t.w-or-R*1.2,rnd());
      const y=lerp(t.y+or+R*1.2,t.y+t.h-or-R*1.2,rnd());
      let ok=true;
      for(const o of obs){if(hypot(x-o.x,y-o.y)<or+o.r+22){ok=false;break;}}
      if(!ok)continue;
      obs.push({x,y,r:or});break;
    }
  }
  const clusters=[0,1,2].map(()=>({x:lerp(t.x+t.w*0.22,t.x+t.w*0.78,rnd()),y:lerp(t.y+t.h*0.22,t.y+t.h*0.78,rnd())}));
  const minD=R*2+8;
  const place=(cluster)=>{
    for(let k=0;k<1400;k++){
      let x,y;
      if(cluster){
        const c=clusters[(rnd()*clusters.length)|0];
        const a=rnd()*TAU,rad=lerp(0,Math.min(t.w,t.h)*0.12,Math.pow(rnd(),0.6));
        x=c.x+Math.cos(a)*rad;y=c.y+Math.sin(a)*rad;
      }else{
        x=lerp(t.x+R*2.2,t.x+t.w-R*2.2,rnd());
        y=lerp(t.y+R*2.2,t.y+t.h-R*2.2,rnd());
      }
      if(x<t.x+R*2||x>t.x+t.w-R*2||y<t.y+R*2||y>t.y+t.h-R*2)continue;
      let ok=true;
      for(const o of obs){if(hypot(x-o.x,y-o.y)<R+o.r+10){ok=false;break;}}
      if(!ok)continue;
      for(const c of coins){if(hypot(x-c.x,y-c.y)<minD){ok=false;break;}}
      if(!ok)continue;
      return {x,y};
    }
    return null;
  };
  for(let i=0;i<12;i++){
    const pos=place(rnd()<0.68)||place(false);
    if(!pos)break;
    coins.push({id:'c'+i,x:pos.x,y:pos.y,vx:0,vy:0,r:R,m:1,type:(i%2?'s':'b')});
  }
  let guard=0;while(coins.length<12&&guard++<2500){const pos=place(false);if(!pos)break;const i=coins.length;coins.push({id:'c'+i,x:pos.x,y:pos.y,vx:0,vy:0,r:R,m:1,type:(i%2?'s':'b')});}
}

function toast(msg,kind='neutral',sec=1.0){
  ui.toast.textContent=msg;
  ui.toast.classList.remove('good','bad','neutral');
  ui.toast.classList.add('show',kind);
  toastT=sec;
}
function hideToast(){ui.toast.classList.remove('show');}

function updateUI(){
  ui.ps.textContent=String(scores.p);
  ui.as.textContent=String(scores.a);
  ui.projBtn.textContent=`Power Projection: ${opt.proj?'On':'Off'}`;
  ui.projBtn.classList.toggle('toggleOn',opt.proj);
  ui.sndBtn.textContent=`Sound: ${S.enabled?'On':'Off'}`;
  ui.sndBtn.classList.toggle('toggleOn',S.enabled);
}

function newMatch(seed,upd=true){
  matchId++;SEED=(seed|0)||1;rand=mulberry32(SEED);if(upd)setSeedInUrl(SEED);
  scores={p:0,a:0};stack={p:[],a:[]};fly=[];fall=[];burst=[];shot=null;owner='p';firstShot=true;state='SETUP';clearActive();
  ui.ante.textContent='1';ui.pot.textContent='12';
  buildWood();genLayout();
  ui.ov.classList.add('hidden');
  state='PLAYER_AIM';
  toast('Your turn: pick a coin.','neutral',1.0);
  updateUI();
}

function offTol(c){return c.r*0.25;}

function impactSound(v,type){
  if(v<120)return;
  S.ping(clamp((v-120)/650,0,1),type==='s'?0.8:0.2);
}

function checkOff(){
  const t=table;let any=false;
  for(let i=coins.length-1;i>=0;i--){
    const c=coins[i],tol=offTol(c);
    const off=!(c.x>=t.x-tol&&c.x<=t.x+t.w+tol&&c.y>=t.y-tol&&c.y<=t.y+t.h+tol);
    if(!off)continue;
    any=true;
    const src={x:clamp(c.x,t.x,t.x+t.w),y:clamp(c.y,t.y,t.y+t.h)};
    coins.splice(i,1);
    fall.push({x:src.x,y:src.y,type:c.type,t:0,d:0.42});
    if(shot&&!shot.early){
      shot.anyOff=true;
      if(c.id===shot.id)shot.shotOff=true;
      shot.srcs.push(src);
    }
  }
  return any;
}

function solveWalls(){
  const t=table;
  for(const c of coins){
    const tol=offTol(c);
    const minX=t.x,maxX=t.x+t.w,minY=t.y,maxY=t.y+t.h;
    if(c.x<minX+c.r){if(c.x<minX-tol){}else{c.x=minX+c.r;if(c.vx<0){const imp=Math.abs(c.vx);c.vx=-c.vx*E_W;impactSound(imp,c.type);}}}
    else if(c.x>maxX-c.r){if(c.x>maxX+tol){}else{c.x=maxX-c.r;if(c.vx>0){const imp=Math.abs(c.vx);c.vx=-c.vx*E_W;impactSound(imp,c.type);}}}
    if(c.y<minY+c.r){if(c.y<minY-tol){}else{c.y=minY+c.r;if(c.vy<0){const imp=Math.abs(c.vy);c.vy=-c.vy*E_W;impactSound(imp,c.type);}}}
    else if(c.y>maxY-c.r){if(c.y>maxY+tol){}else{c.y=maxY-c.r;if(c.vy>0){const imp=Math.abs(c.vy);c.vy=-c.vy*E_W;impactSound(imp,c.type);}}}
  }
}

function collideCoins(a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const d=Math.hypot(dx,dy),md=a.r+b.r;
  if(d<=0||d>=md)return;
  const nx=dx/d,ny=dy/d,pen=md-d;
  const percent=0.85,slop=0.01;
  const invA=1/a.m,invB=1/b.m,invS=invA+invB;
  const corr=Math.max(0,pen-slop)/invS*percent;
  a.x-=nx*corr*invA;a.y-=ny*corr*invA;b.x+=nx*corr*invB;b.y+=ny*corr*invB;
  const rvx=b.vx-a.vx,rvy=b.vy-a.vy;
  const van=rvx*nx+rvy*ny;
  if(van<0){
    const j=-(1+E_CC)*van/invS;
    const ix=j*nx,iy=j*ny;
    a.vx-=ix*invA;a.vy-=iy*invA;b.vx+=ix*invB;b.vy+=iy*invB;
    impactSound(Math.abs(van),a.type);
  }
  if(shot&&!shot.early){
    const sid=shot.id;
    if(a.id===sid&&b.id!==sid){shot.t.add(b.id);if(!shot.pt)shot.pt={x:a.x+nx*a.r,y:a.y+ny*a.r};}
    else if(b.id===sid&&a.id!==sid){shot.t.add(a.id);if(!shot.pt)shot.pt={x:b.x-nx*b.r,y:b.y-ny*b.r};}
  }
}

function collideObs(c,o){
  const dx=c.x-o.x,dy=c.y-o.y;
  const d=Math.hypot(dx,dy),md=c.r+o.r;
  if(d<=0||d>=md)return;
  const nx=dx/d,ny=dy/d,pen=md-d;
  c.x+=nx*pen;c.y+=ny*pen;
  const van=c.vx*nx+c.vy*ny;
  if(van<0){const imp=Math.abs(van);c.vx-=(1+E_OB)*van*nx;c.vy-=(1+E_OB)*van*ny;impactSound(imp,c.type);} 
}

function awardPoint(who,from,type){
  fly.push({from:{x:from.x,y:from.y},to:pilePos(who),t:0,d:0.42,type,who,done:()=>stack[who].push(type)});
}

function resolveOffImmediate(){
  if(!shot||shot.early||!shot.anyOff)return;
  shot.early=true;
  const sh=shot.sh,opp=sh==='p'?'a':'p';
  scores[opp]+=1;
  awardPoint(opp,shot.srcs[0]||tableCenter(),opp==='p'?'s':'b');
  S.fall();S.buzz();toast('Foul: Off Table — Opponent +1','bad',1.2);
  if(scores.p>=6||scores.a>=6){gameOver(opp);shot=null;return;}
  owner=opp;firstShot=true;clearActive();shot=null;
}

function allRest(){for(const c of coins){if(Math.hypot(c.vx,c.vy)>REST)return false;}return true;}

function beginShot(c,vx,vy,who){
  const sp=Math.hypot(vx,vy);if(sp>MAX_V){const s=MAX_V/sp;vx*=s;vy*=s;}
  c.vx=vx;c.vy=vy;
  state='PHYSICS_RUNNING';
  shot={sh:who,id:c.id,t:new Set(),anyOff:false,shotOff:false,srcs:[],pt:null,early:false};
}

function physicsStep(dt){
  let maxV=0;for(const c of coins)maxV=Math.max(maxV,Math.hypot(c.vx,c.vy));
  const sub=maxV>900?3:(maxV>600?2:1),sdt=dt/sub;
  for(let si=0;si<sub;si++){
    for(const c of coins){c.x+=c.vx*sdt;c.y+=c.vy*sdt;}
    if(checkOff()&&shot&&!shot.early&&shot.anyOff)resolveOffImmediate();
    solveWalls();
    for(let i=0;i<coins.length;i++)for(let j=i+1;j<coins.length;j++)collideCoins(coins[i],coins[j]);
    for(const c of coins)for(const o of obs)collideObs(c,o);
    const f=Math.max(0,1-FRICTION*sdt);
    for(const c of coins){c.vx*=f;c.vy*=f;if(Math.hypot(c.vx,c.vy)<REST){c.vx=0;c.vy=0;}}
  }
}

function resolveShot(){
  if(!shot)return;
  state='RESOLVE_SHOT';
  const sh=shot.sh,opp=sh==='p'?'a':'p';
  const n=shot.t.size;
  if(n===0){S.buzz();toast('Miss','neutral',0.9);endTurn(opp);shot=null;return;}
  if(n>=2){S.buzz();toast('Foul: Multiple Coins','bad',1.2);endTurn(opp);shot=null;return;}
  // success
  scores[sh]+=1;S.chime();
  const sc=coinById(shot.id);
  const tid=shot.t.values().next().value;
  const tc=coinById(tid);
  if(sc){awardPoint(sh,{x:sc.x,y:sc.y},sc.type);coins=coins.filter(c=>c.id!==sc.id);} // capture removes only shot coin
  if(shot.pt)burst.push({x:shot.pt.x,y:shot.pt.y,t:0,d:0.33});
  if(scores.p>=6||scores.a>=6){gameOver(sh);shot=null;return;}
  if(tc){setActive(tc.id);}else{endTurn(opp);shot=null;return;}
  firstShot=false;
  toast('Clean Hit +1 (Chain!)','good',1.1);
  if(sh==='p'){state='PLAYER_AIM';}else{state='AI_THINK';scheduleAI();}
  shot=null;
}

function endTurn(next){
  owner=next;firstShot=true;clearActive();
  if(owner==='p'){state='PLAYER_AIM';toast('Your turn: pick a coin.','neutral',1.0);}else{state='AI_THINK';toast('AI thinking…','neutral',0.9);scheduleAI();}
}

function edgeDist(x,y){
  const t=table;const dx=Math.min(x-t.x,(t.x+t.w)-x);const dy=Math.min(y-t.y,(t.y+t.h)-y);return Math.min(dx,dy);
}

function predictStop(v0){
  if(v0<=REST)return 0;
  const f=clamp(1-FRICTION*DT,0.001,0.999);
  const n=Math.ceil(Math.log(REST/v0)/Math.log(f));
  return Math.max(0,DT*v0*(1-Math.pow(f,n))/(1-f));
}

function invertStop(dist){
  const target=Math.max(0,dist);
  let lo=8,hi=MAX_DRAG;
  if(predictStop(POWER*hi)<target)return hi;
  for(let i=0;i<18;i++){
    const mid=(lo+hi)*0.5;
    if(predictStop(POWER*mid)<target)lo=mid;else hi=mid;
  }
  return clamp(hi,8,MAX_DRAG);
}

function aiPlan(sc){
  const cand=[];
  for(const tg of coins){
    if(tg.id===sc.id)continue;
    const dx=tg.x-sc.x,dy=tg.y-sc.y,dist=Math.hypot(dx,dy);
    if(dist<R*3.2)continue;
    if(edgeDist(tg.x,tg.y)<R*2.2)continue;
    if(edgeDist(sc.x,sc.y)<R*2.0)continue;
    const dirx=dx/dist,diry=dy/dist;
    let blocked=false;
    const corridor=R*2.25;
    for(const o of coins){
      if(o.id===sc.id||o.id===tg.id)continue;
      const px=o.x-sc.x,py=o.y-sc.y;
      const proj=px*dirx+py*diry;
      if(proj<=0||proj>=dist)continue;
      const cx=sc.x+dirx*proj,cy=sc.y+diry*proj;
      if(Math.hypot(o.x-cx,o.y-cy)<corridor){blocked=true;break;}
    }
    if(blocked)continue;
    for(const ob of obs){
      const px=ob.x-sc.x,py=ob.y-sc.y;
      const proj=px*dirx+py*diry;
      if(proj<=0||proj>=dist)continue;
      const cx=sc.x+dirx*proj,cy=sc.y+diry*proj;
      if(Math.hypot(ob.x-cx,ob.y-cy)<ob.r+R*0.95){blocked=true;break;}
    }
    if(blocked)continue;
    const desired=Math.max(R*0.8,dist-(R+tg.r)*0.98);
    const dragLen=invertStop(desired);
    const safety=edgeDist(tg.x,tg.y);
    const score=safety*0.35-dragLen*0.9+rnd()*4;
    cand.push({dirx,diry,dragLen,score});
  }
  cand.sort((a,b)=>b.score-a.score);
  return cand[0]||null;
}

function scheduleAI(){
  const id=matchId;
  clearTimeout(aiTimer);
  aiTimer=setTimeout(()=>{
    if(matchId!==id||state!=='AI_THINK'||owner!=='a')return;
    aiShoot();
  },520+((rnd()*420)|0));
}

function aiShoot(){
  if(state!=='AI_THINK'||owner!=='a')return;
  state='AI_SHOOT';
  let sc=null;
  if(!firstShot&&active)sc=coinById(active);
  if(!sc){
    let best=null;
    for(const c of coins){const ed=edgeDist(c.x,c.y);const s=ed+rnd()*10;if(!best||s>best.s)best={c,s};}
    sc=best?best.c:null;
    if(sc)setActive(sc.id);
  }
  if(!sc){endTurn('p');return;}
  const plan=aiPlan(sc);
  if(!plan){
    const cen=tableCenter();const dx=cen.x-sc.x,dy=cen.y-sc.y;const d=Math.hypot(dx,dy)||1;
    let dirx=dx/d,diry=dy/d;
    const ang=(rnd()-0.5)*0.08,cs=Math.cos(ang),sn=Math.sin(ang);
    const jx=dirx*cs-diry*sn,jy=dirx*sn+diry*cs;
    const v0=POWER*22;
    beginShot(sc,jx*v0,jy*v0,'a');
    return;
  }
  let {dirx,diry,dragLen}=plan;
  const wob=lerp(0.02,0.09,rnd());
  const ang=(rnd()-0.5)*wob,cs=Math.cos(ang),sn=Math.sin(ang);
  const wx=dirx*cs-diry*sn,wy=dirx*sn+diry*cs;
  const v0=POWER*dragLen*lerp(0.92,1.05,rnd());
  beginShot(sc,wx*v0,wy*v0,'a');
}

function gameOver(who){
  state='GAME_OVER';clearActive();drag.on=false;drag.pid=null;
  for(const c of coins){c.vx=0;c.vy=0;}
  S.win();
  ui.ovT.textContent=who==='p'?'You Win':'AI Wins';
  ui.ovS.textContent=who==='p'?'Clean hits, clean chains. Want a rematch?':'Harsh table. Sharpen your taps and try again.';
  ui.ov.classList.remove('hidden');
  updateUI();
}

// Input
function ptrPos(e){const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function hitCoin(x,y){let best=null;for(const c of coins){if(hypot(x-c.x,y-c.y)<=c.r){best=c;if(active&&c.id===active)return c;}}return best;}

cv.addEventListener('pointerdown',e=>{
  if(state!=='PLAYER_AIM'||owner!=='p'||!ui.ov.classList.contains('hidden'))return;
  S.unlock();
  const p=ptrPos(e);const hit=hitCoin(p.x,p.y);if(!hit)return;
  if(firstShot)setActive(hit.id);else if(hit.id!==active)return;
  drag.on=true;drag.pid=e.pointerId;drag.sx=p.x;drag.sy=p.y;drag.x=p.x;drag.y=p.y;
  try{cv.setPointerCapture(e.pointerId);}catch{}
  e.preventDefault();
});
cv.addEventListener('pointermove',e=>{if(!drag.on||e.pointerId!==drag.pid)return;const p=ptrPos(e);drag.x=p.x;drag.y=p.y;e.preventDefault();});
cv.addEventListener('pointerup',e=>{
  if(!drag.on||e.pointerId!==drag.pid)return;
  drag.on=false;drag.pid=null;
  const c=active?coinById(active):null;if(!c)return;
  const dx=drag.x-drag.sx,dy=drag.y-drag.sy;
  const len=Math.min(MAX_DRAG,Math.hypot(dx,dy));
  if(len<6){toast(firstShot?'Selected coin — drag to shoot.':'Drag to shoot.','neutral',0.8);return;}
  const dirx=-(dx/(len||1)),diry=-(dy/(len||1));
  const v0=POWER*len;
  firstShot=false;
  beginShot(c,dirx*v0,diry*v0,'p');
});
cv.addEventListener('pointercancel',e=>{if(e.pointerId!==drag.pid)return;drag.on=false;drag.pid=null;});

// UI
ui.newBtn.addEventListener('click',()=>{S.unlock();ui.ov.classList.add('hidden');newMatch(((Math.random()*1e9)|0)^((performance.now()*1000)|0),true);});
ui.projBtn.addEventListener('click',()=>{S.unlock();opt.proj=!opt.proj;updateUI();});
ui.sndBtn.addEventListener('click',async()=>{await S.unlock();S.setEnabled(!S.enabled);updateUI();});
ui.again.addEventListener('click',()=>{S.unlock();ui.ov.classList.add('hidden');newMatch(((Math.random()*1e9)|0)^((performance.now()*1000)|0),true);});
ui.rematch.addEventListener('click',()=>{S.unlock();ui.ov.classList.add('hidden');newMatch(SEED,true);});
window.addEventListener('pointerdown',()=>S.unlock(),{once:true,capture:true});
window.addEventListener('resize',resize);

// Effects stepping
function stepFx(dt){
  for(let i=fly.length-1;i>=0;i--){const a=fly[i];a.t+=dt;if(a.t>=a.d){if(a.done)a.done();fly.splice(i,1);}}
  for(let i=fall.length-1;i>=0;i--){const f=fall[i];f.t+=dt;if(f.t>=f.d)fall.splice(i,1);}
  for(let i=burst.length-1;i>=0;i--){const b=burst[i];b.t+=dt;if(b.t>=b.d)burst.splice(i,1);}
}

// Rendering
function rrect(x,y,w,h,r){
  const rr=Math.max(0,Math.min(r,Math.min(w,h)/2));
  g.beginPath();g.moveTo(x+rr,y);
  g.arcTo(x+w,y,x+w,y+h,rr);g.arcTo(x+w,y+h,x,y+h,rr);
  g.arcTo(x,y+h,x,y,rr);g.arcTo(x,y,x+w,y,rr);
  g.closePath();
}

function drawTable(){
  const t=table,r=t.r;
  g.fillStyle='rgba(0,0,0,0.42)';rrect(t.x-6,t.y-6,t.w+12,t.h+12,r+8);g.fill();
  g.save();rrect(t.x,t.y,t.w,t.h,r);g.clip();
  g.fillStyle=wood||'#7b4a25';g.fillRect(t.x,t.y,t.w,t.h);
  const top=g.createLinearGradient(0,t.y,0,t.y+t.h);
  top.addColorStop(0,'rgba(255,255,255,0.08)');top.addColorStop(0.18,'rgba(255,255,255,0.02)');top.addColorStop(1,'rgba(0,0,0,0.10)');
  g.fillStyle=top;g.fillRect(t.x,t.y,t.w,t.h);
  const v=g.createRadialGradient(t.x+t.w*0.5,t.y+t.h*0.5,Math.min(t.w,t.h)*0.2,t.x+t.w*0.5,t.y+t.h*0.5,Math.max(t.w,t.h)*0.65);
  v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,0.18)');
  g.fillStyle=v;g.fillRect(t.x,t.y,t.w,t.h);
  g.restore();
  g.strokeStyle='rgba(255,255,255,0.10)';g.lineWidth=2;rrect(t.x,t.y,t.w,t.h,r);g.stroke();
  g.strokeStyle='rgba(0,0,0,0.35)';g.lineWidth=2;rrect(t.x+2,t.y+2,t.w-4,t.h-4,r-2);g.stroke();
}

function drawPiles(){
  const draw=(who)=>{
    const a=pilePos(who),st=stack[who];
    g.fillStyle='rgba(255,255,255,0.42)';
    g.font='700 12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    g.textAlign='center';g.textBaseline='bottom';
    g.fillText(who==='p'?'P1':'AI',a.x,a.y-34);
    const n=Math.min(st.length,9);
    for(let i=0;i<n;i++){
      const type=st[i];
      const img=type==='s'?spr.s:spr.b;const s=spr.size;
      const y=a.y+(n-1-i)*4;const x=a.x+(i%2?2:-2);
      g.globalAlpha=0.9;g.drawImage(img,x-s/2,y-s/2);
    }
    g.globalAlpha=1;
  };
  draw('p');draw('a');
  // flying awards/captures
  for(const a of fly){
    const t=clamp(a.t/a.d,0,1),k=easeOut(t);
    const x=lerp(a.from.x,a.to.x,k),y=lerp(a.from.y,a.to.y,k)-Math.sin(k*Math.PI)*18;
    const img=a.type==='s'?spr.s:spr.b;const s=spr.size;
    const sc=0.9+0.18*Math.sin(k*Math.PI);
    g.save();g.translate(x,y);g.scale(sc,sc);g.globalAlpha=0.95;g.drawImage(img,-s/2,-s/2);g.restore();
  }
  // falls
  for(const f of fall){
    const t=clamp(f.t/f.d,0,1),k=easeOut(t);
    const img=f.type==='s'?spr.s:spr.b;const s=spr.size;
    const sc=1-k*0.55;
    g.save();g.translate(f.x,f.y+k*30);g.scale(sc,sc);g.globalAlpha=1-k;g.drawImage(img,-s/2,-s/2);g.restore();
  }
  g.globalAlpha=1;
}

function drawObs(){
  for(const o of obs){
    g.fillStyle='rgba(0,0,0,0.22)';g.beginPath();g.ellipse(o.x+2.5,o.y+4.2,o.r*1.02,o.r*0.92,0,0,TAU);g.fill();
    const gr=g.createRadialGradient(o.x-o.r*0.25,o.y-o.r*0.25,o.r*0.2,o.x,o.y,o.r);
    gr.addColorStop(0,'rgba(235,242,255,0.22)');gr.addColorStop(0.6,'rgba(120,160,210,0.12)');gr.addColorStop(1,'rgba(10,20,30,0.18)');
    g.fillStyle=gr;g.beginPath();g.arc(o.x,o.y,o.r,0,TAU);g.fill();
    g.strokeStyle='rgba(255,255,255,0.12)';g.lineWidth=2;g.beginPath();g.arc(o.x,o.y,o.r-1,0,TAU);g.stroke();
  }
}

function drawCoins(){
  for(const c of coins){
    g.fillStyle='rgba(0,0,0,0.20)';g.beginPath();g.ellipse(c.x+2,c.y+3.8,c.r*1.02,c.r*0.90,0,0,TAU);g.fill();
    g.fillStyle='rgba(0,0,0,0.10)';g.beginPath();g.ellipse(c.x+1.2,c.y+2.8,c.r*1.18,c.r*1.05,0,0,TAU);g.fill();
    const img=c.type==='s'?spr.s:spr.b;const s=spr.size;g.drawImage(img,c.x-s/2,c.y-s/2);
    if(c.id===active){
      const pulse=0.65+0.35*Math.sin(performance.now()*0.006);
      g.strokeStyle=`rgba(255,220,150,${0.55*pulse})`;g.lineWidth=5;g.beginPath();g.arc(c.x,c.y,c.r+5,0,TAU);g.stroke();
      g.strokeStyle='rgba(255,255,255,0.18)';g.lineWidth=2;g.beginPath();g.arc(c.x,c.y,c.r+5,0,TAU);g.stroke();
    }
  }
}

function drawBurst(){
  for(const b of burst){
    const t=clamp(b.t/b.d,0,1);
    const r=lerp(10,34,t);
    g.strokeStyle=`rgba(255,235,190,${0.55*(1-t)})`;g.lineWidth=3;g.beginPath();g.arc(b.x,b.y,r,0,TAU);g.stroke();
    g.strokeStyle=`rgba(255,255,255,${0.18*(1-t)})`;g.lineWidth=2;g.beginPath();g.arc(b.x,b.y,r*0.72,0,TAU);g.stroke();
  }
}

function drawAim(){
  const c=active?coinById(active):null;if(!c)return;
  const dx=drag.x-drag.sx,dy=drag.y-drag.sy;
  const len=Math.min(MAX_DRAG,Math.hypot(dx,dy));
  if(len<2)return;
  const dirx=-(dx/(len||1)),diry=-(dy/(len||1));
  const ax=c.x+dirx*len,ay=c.y+diry*len;
  g.lineWidth=3;g.strokeStyle='rgba(255,235,190,0.75)';g.beginPath();g.moveTo(c.x,c.y);g.lineTo(ax,ay);g.stroke();
  g.beginPath();g.arc(c.x,c.y,MAX_DRAG,0,TAU);g.strokeStyle='rgba(255,255,255,0.08)';g.lineWidth=1;g.stroke();
  g.fillStyle='rgba(255,235,190,0.9)';g.beginPath();g.arc(ax,ay,5,0,TAU);g.fill();
  if(opt.proj){
    const v0=POWER*len;const dist=predictStop(v0);
    const px=c.x+dirx*dist,py=c.y+diry*dist;
    g.strokeStyle='rgba(120,190,255,0.40)';g.setLineDash([6,6]);g.lineWidth=2;g.beginPath();g.moveTo(c.x,c.y);g.lineTo(px,py);g.stroke();g.setLineDash([]);
    g.strokeStyle='rgba(120,190,255,0.75)';g.lineWidth=2;g.beginPath();g.arc(px,py,10,0,TAU);g.stroke();
  }
}

function drawDebug(){
  const t=table;
  g.strokeStyle='rgba(255,0,0,0.35)';g.lineWidth=2;g.strokeRect(t.x,t.y,t.w,t.h);
  for(const c of coins){
    g.strokeStyle='rgba(0,255,255,0.5)';g.lineWidth=2;g.beginPath();g.moveTo(c.x,c.y);g.lineTo(c.x+c.vx*0.02,c.y+c.vy*0.02);g.stroke();
    g.strokeStyle='rgba(255,255,255,0.18)';g.lineWidth=1;g.beginPath();g.arc(c.x,c.y,c.r,0,TAU);g.stroke();
  }
  for(const o of obs){g.strokeStyle='rgba(255,255,255,0.10)';g.lineWidth=1;g.beginPath();g.arc(o.x,o.y,o.r,0,TAU);g.stroke();}
  const lines=[`state: ${state}`,`seed: ${SEED}`,`turn: ${owner==='p'?'player':'ai'} (${firstShot?'first':'chain'})`,`active: ${active||'none'}`];
  if(shot){lines.push(`touchedCoinIds: ${shot.t.size}`);lines.push(`anyCoinOffTable: ${shot.anyOff}`);lines.push(`shotCoinOffTable: ${shot.shotOff}`);} 
  g.fillStyle='rgba(0,0,0,0.55)';g.fillRect(10,110,280,20+lines.length*16);
  g.fillStyle='rgba(255,255,255,0.9)';
  g.font='12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  g.textAlign='left';g.textBaseline='top';
  for(let i=0;i<lines.length;i++)g.fillText(lines[i],18,118+i*16);
}

function render(){
  g.setTransform(DPR,0,0,DPR,0,0);
  const bg=g.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#070711');bg.addColorStop(1,'#0b0b18');
  g.fillStyle=bg;g.fillRect(0,0,W,H);
  const vg=g.createRadialGradient(W*0.5,H*0.55,Math.min(W,H)*0.15,W*0.5,H*0.55,Math.max(W,H)*0.75);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,0.52)');
  g.fillStyle=vg;g.fillRect(0,0,W,H);
  drawTable();
  drawPiles();
  drawObs();
  drawCoins();
  drawBurst();
  if(state==='PLAYER_AIM'&&owner==='p'&&drag.on&&active)drawAim();
  if(DEBUG)drawDebug();
}

function stepFx(dt){
  for(let i=fly.length-1;i>=0;i--){const a=fly[i];a.t+=dt;if(a.t>=a.d){if(a.done)a.done();fly.splice(i,1);}}
  for(let i=fall.length-1;i>=0;i--){const f=fall[i];f.t+=dt;if(f.t>=f.d)fall.splice(i,1);}
  for(let i=burst.length-1;i>=0;i--){const b=burst[i];b.t+=dt;if(b.t>=b.d)burst.splice(i,1);}
}

function loop(tms){
  const t=tms*0.001;
  if(!lastT)lastT=t;
  const dt=clamp(t-lastT,0,0.033);lastT=t;
  acc+=dt;
  if(toastT>0){toastT-=dt;if(toastT<=0)hideToast();}

  if(state==='PHYSICS_RUNNING'){
    while(acc>=DT){physicsStep(DT);acc-=DT;}
    if(allRest()){
      if(!shot){
        // off-table already resolved; next turn begins now
        if(state!=='GAME_OVER'){
          if(owner==='p'){state='PLAYER_AIM';toast('Your turn: pick a coin.','neutral',1.0);}else{state='AI_THINK';toast('AI thinking…','neutral',0.9);scheduleAI();}
        }
      }else resolveShot();
    }
  }else acc=Math.min(acc,DT);

  stepFx(dt);
  updateUI();
  render();
  requestAnimationFrame(loop);
}

// Boot
resize();
newMatch(SEED,false);
requestAnimationFrame(loop);
})();
