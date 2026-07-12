// PROTOTYPE — answers: which bus-card risk model makes the chase fun rather than frustrating?
const VARIANTS = {
  A: { name: "街机冲刺", subtitle: "快节奏闪避 · 公交卡是一次保命护符", speed: 1.05, chaos: 0.7, card: "shield" },
  B: { name: "路线博弈", subtitle: "三线取舍 · 丢卡后必须捡回来", speed: 0.82, chaos: 0.45, card: "required" },
  C: { name: "喜剧乱斗", subtitle: "高密度 QTE · 卡会飞走但不会永久丢", speed: 1.18, chaos: 1.15, card: "tethered" }
};

export function createBusRushPrototype() {
  const canvas = document.getElementById("busRushCanvas");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("busRushHud");
  const overlay = document.getElementById("busRushOverlay");
  const switcher = document.getElementById("busRushSwitcher");
  const label = document.getElementById("busRushVariantLabel");
  let frame = 0;
  let last = 0;
  let running = false;
  let state;
  let variantKey;
  let variant;

  function currentVariant() {
    const key = new URLSearchParams(location.search).get("variant")?.toUpperCase();
    return VARIANTS[key] ? key : "C";
  }

  function reset() {
    variantKey = currentVariant();
    variant = VARIANTS[variantKey];
    label.textContent = `${variantKey} — ${variant.name}`;
    state = {
      phase: "intro", intro: 0, x: 0, targetX: 0, distance: 0, coins: 0, cabbage: 2,
      stamina: 100, place: 8, card: true, looseCard: 0, objects: [], spawn: 0,
      qte: null, message: "", messageTime: 0, result: null
    };
    overlay.innerHTML = "";
  }

  function start() {
    resizeCanvas();
    reset();
    running = true;
    last = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  function resizeCanvas() {
    canvas.width = Math.max(640, Math.round(innerWidth));
    canvas.height = Math.max(480, Math.round(innerHeight));
  }

  function setVariant(step) {
    const keys = Object.keys(VARIANTS);
    const next = keys[(keys.indexOf(variantKey) + step + keys.length) % keys.length];
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(history.state, "", url);
    reset();
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    update(dt);
    draw();
    frame = requestAnimationFrame(loop);
  }

  function update(dt) {
    if (state.phase === "intro") {
      state.intro += dt;
      if (state.intro > 7.2) state.phase = "ready";
      return;
    }
    if (state.phase !== "play") return;
    if (state.qte) {
      state.qte.time -= dt;
      if (state.qte.time <= 0) resolveQte(false);
      return;
    }
    state.targetX = Math.max(-0.86, Math.min(0.86, state.targetX));
    state.x += (state.targetX - state.x) * Math.min(1, dt * 9);
    state.distance += dt * 4.2 * variant.speed;
    state.stamina = Math.max(0, state.stamina - dt * (2.3 + variant.chaos));
    state.place = Math.max(1, 8 - Math.floor(state.distance / 15) - Math.floor(state.coins / 4));
    state.spawn -= dt;
    if (state.spawn <= 0) {
      spawnObject();
      state.spawn = (0.58 + Math.random() * 0.58) / variant.chaos;
    }
    for (const object of state.objects) {
      object.z -= dt * (object.type === "npc" ? object.relativeSpeed : 0.56) * variant.speed;
      if (object.type === "npc") object.x += Math.sin(performance.now() / 700 + object.wobble) * dt * 0.055;
    }
    for (const object of state.objects) {
      if (!object.hit && object.z < 0.12 && Math.abs(object.x - state.x) < 0.14) collide(object);
    }
    state.objects = state.objects.filter((object) => object.z > -0.15 && !object.remove);
    if (state.looseCard > 0) state.looseCard -= dt;
    if (state.messageTime > 0) state.messageTime -= dt;
    if (state.distance >= 100 || state.stamina <= 0) finish();
  }

  function spawnObject() {
    const roll = Math.random();
    const lanes = variantKey === "B" ? [-0.72, 0, 0.72] : [-0.8, -0.4, 0, 0.4, 0.8];
    let type = roll < 0.25 ? "coin" : roll < 0.43 ? "cabbage" : roll < 0.9 ? "npc" : "crate";
    if (!state.card && variant.card !== "shield" && Math.random() < 0.38) type = "card";
    state.objects.push({ type, x: lanes[Math.floor(Math.random() * lanes.length)], z: 1.05, hit: false, relativeSpeed: 0.28 + Math.random() * 0.23, wobble: Math.random() * 10, gait: Math.random() * 10 });
  }

  function collide(object) {
    object.hit = true;
    if (object.type === "coin") { state.coins++; object.remove = true; say("叮！菜钱 +1"); return; }
    if (object.type === "cabbage") { state.cabbage++; object.remove = true; say("获得白菜弹"); return; }
    if (object.type === "card") { state.card = true; object.remove = true; say("公交卡追回来了！"); return; }
    state.qte = { key: Math.random() < 0.5 ? "ArrowLeft" : "ArrowRight", time: variantKey === "C" ? 0.75 : 1.1, object };
  }

  function resolveQte(success) {
    const qte = state.qte;
    if (!qte) return;
    if (success) {
      qte.object.remove = true;
      state.stamina = Math.min(100, state.stamina + 5);
      say(variantKey === "C" ? "太极闪身！" : "漂亮躲开！");
    } else {
      state.stamina = Math.max(0, state.stamina - 22);
      if (state.card) loseCard();
      say("被挤了一下！");
    }
    state.qte = null;
  }

  function loseCard() {
    if (variant.card === "shield") { say("公交卡挡住冲击，裂了！"); state.card = false; return; }
    state.card = false;
    state.looseCard = variant.card === "tethered" ? 2.5 : 99;
    if (variant.card === "tethered") setTimeout(() => { if (state && !state.card) { state.card = true; say("卡从鞋底弹回来了！"); } }, 2500);
  }

  function throwCabbage() {
    if (state.phase !== "play" || state.qte || state.cabbage <= 0) return;
    state.cabbage--;
    const target = state.objects.filter((o) => o.type === "npc" && o.z > 0.1).sort((a,b) => a.z-b.z)[0];
    if (target) { target.remove = true; state.place = Math.max(1, state.place - 1); say("白菜出击！前路清空"); }
    else say("白菜飞进了绿化带……");
  }

  function finish() {
    state.phase = "result";
    const canBoard = state.stamina > 0 && (variant.card === "shield" || state.card);
    state.result = canBoard ? (state.place <= 3 ? "抢到窗边宝座！" : "赶上了，站票也算票！") : state.stamina <= 0 ? "差两步，车门关了！" : "摸遍口袋：公交卡呢？";
  }

  function say(message) { state.message = message; state.messageTime = 1.5; }

  function onKey(event) {
    if (!running) return;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target.matches?.("input,textarea,[contenteditable]")) return;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.phase !== "play" && !state.qte) {
      event.preventDefault();
      setVariant(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (state.qte && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault(); resolveQte(event.key === state.qte.key); return;
    }
    if (state.phase === "ready" && (event.key === "Enter" || event.key === " ")) { state.phase = "play"; overlay.innerHTML = ""; return; }
    if (state.phase === "result" && (event.key === "Enter" || event.key.toLowerCase() === "r")) { reset(); state.phase = "ready"; return; }
    if (state.phase !== "play") return;
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") state.targetX -= variantKey === "B" ? 0.72 : 0.32;
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") state.targetX += variantKey === "B" ? 0.72 : 0.32;
    if (event.key === " ") { event.preventDefault(); throwCabbage(); }
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    const t = performance.now() / 1000;
    ctx.clearRect(0,0,w,h);
    const intro = state.phase === "intro";
    drawWorld(w,h,t,intro);
    if (!intro) drawObjects(w,h);
    drawGranny(w,h,t,intro);
    drawUi();
  }

  function drawWorld(w,h,t,intro) {
    const sky = ctx.createLinearGradient(0,0,0,h); sky.addColorStop(0,"#8ed3df"); sky.addColorStop(.56,"#f5d894"); sky.addColorStop(.57,"#777066"); sky.addColorStop(1,"#3c3633"); ctx.fillStyle=sky; ctx.fillRect(0,0,w,h);
    ctx.fillStyle="#4d7e4b"; ctx.fillRect(0,h*.52,w,h*.08);
    ctx.fillStyle="#ddd0b2"; ctx.fillRect(0,h*.6,w,h*.4);
    ctx.fillStyle="#655d58"; ctx.beginPath(); ctx.moveTo(w*.35,h*.6); ctx.lineTo(w*.65,h*.6); ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.fill();
    ctx.strokeStyle="#f7d46799"; ctx.lineWidth=5; ctx.setLineDash([24,30]); ctx.beginPath(); ctx.moveTo(w/2,h*.62); ctx.lineTo(w/2,h); ctx.stroke(); ctx.setLineDash([]);
    // market and bus establish the destination
    ctx.fillStyle="#aa3e28"; ctx.fillRect(30,135,210,190); ctx.fillStyle="#fff0c6"; ctx.fillRect(48,165,174,54); ctx.fillStyle="#3b2821"; ctx.font="bold 27px sans-serif"; ctx.fillText("惠民菜市场",63,201);
    const busX = intro ? w - Math.min(330, state.intro*85) : w*.66;
    ctx.fillStyle="#db3e27"; roundRect(busX,165,285,142,18); ctx.fill(); ctx.fillStyle="#bde8ed"; ctx.fillRect(busX+22,185,174,52); ctx.fillStyle="#ffe47c"; ctx.font="bold 23px sans-serif"; ctx.fillText("18路",busX+213,219); ctx.fillStyle="#222"; ctx.beginPath(); ctx.arc(busX+58,307,26,0,7); ctx.arc(busX+226,307,26,0,7); ctx.fill();
    if (intro && state.intro > 2.5) { ctx.fillStyle="#16100d"; ctx.fillRect(busX+190,237,62,70); }
    // The whole crowd is already running toward the bus, seen from behind.
    for(let i=0;i<7;i++){
      const x=w*.25+i*w*.055+Math.sin(t*3+i)*4;
      drawNpcRunner(x,h*.57+(i%2)*7,.42,{ gait:i*.9, wobble:i*1.3 });
    }
  }

  function roadHalfWidth(w, z) {
    const p = Math.max(0, Math.min(1, 1 - z));
    return w * (0.12 + p * 0.36);
  }

  function projectX(w, x, z) { return w / 2 + x * roadHalfWidth(w, z); }

  function drawObjects(w,h) {
    const sorted=[...state.objects].sort((a,b)=>b.z-a.z);
    for(const o of sorted){
      const p=Math.max(0,1-o.z), y=h*.59+p*p*h*.42, scale=.26+p*1.18, x=projectX(w,o.x,o.z);
      if(o.type==="npc") { drawNpcRunner(x,y,scale,o); continue; }
      ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale); ctx.font="46px serif"; ctx.textAlign="center"; ctx.fillText(o.type==="coin"?"🪙":o.type==="cabbage"?"🥬":o.type==="card"?"💳":"📦",0,0); ctx.restore();
    }
  }

  function drawNpcRunner(x,y,scale,o) {
    const gait=Math.sin(performance.now()/105+o.gait)*12;
    ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale); ctx.lineCap="round";
    ctx.strokeStyle="#30251f"; ctx.lineWidth=11; ctx.beginPath(); ctx.moveTo(-12,44); ctx.lineTo(-16+gait,82); ctx.moveTo(12,44); ctx.lineTo(16-gait,82); ctx.stroke();
    ctx.fillStyle=o.wobble%2>1?"#3d7180":"#8b4567"; ctx.beginPath(); ctx.ellipse(0,20,28,39,0,0,7); ctx.fill();
    ctx.fillStyle="#d4aa8b"; ctx.beginPath(); ctx.arc(0,-20,20,0,7); ctx.fill(); ctx.fillStyle="#d8d2c8"; ctx.beginPath(); ctx.arc(0,-29,20,Math.PI,Math.PI*2); ctx.fill();
    ctx.strokeStyle="#d4aa8b"; ctx.lineWidth=9; ctx.beginPath(); ctx.moveTo(-21,3); ctx.lineTo(-34-gait*.3,38); ctx.moveTo(21,3); ctx.lineTo(34+gait*.3,38); ctx.stroke(); ctx.restore();
  }

  function drawGranny(w,h,t,intro) {
    if (intro && state.intro < 4.3) return;
    const x=intro?w/2+Math.sin(t*6)*2:projectX(w,state.x,0), y=h*.82;
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(t*9)*.025); ctx.fillStyle="#4f285f"; ctx.beginPath(); ctx.ellipse(0,36,58,80,0,0,7); ctx.fill(); ctx.fillStyle="#d8b092"; ctx.beginPath(); ctx.arc(0,-38,42,0,7); ctx.fill(); ctx.fillStyle="#ddd"; ctx.beginPath(); ctx.arc(0,-55,43,Math.PI,Math.PI*2); ctx.fill(); ctx.fillStyle="#816646"; ctx.fillRect(-56,20,18,105); ctx.fillRect(38,20,18,105); ctx.fillStyle="#24201d"; ctx.fillRect(-61,116,28,14); ctx.fillRect(33,116,28,14); ctx.fillStyle="#7ca33c"; ctx.beginPath(); ctx.ellipse(56,42,28,37,-.4,0,7); ctx.fill(); ctx.restore();
  }

  function drawUi() {
    hud.innerHTML = `<span>名次 ${state.place}/8</span><span>体力 ${Math.ceil(state.stamina)}</span><span>🪙 ${state.coins}</span><span>🥬 ${state.cabbage}</span><span>${state.card?"💳 在身上":"⚠️ 卡丢了"}</span>`;
    if(state.phase==="intro"){
      const lines=state.intro<2.4?["菜市场散场了……","今天的特价白菜，人人有份。"]:state.intro<4.4?["18 路进站，车门打开！","人群突然安静了半秒。"]:["下一秒——全员竞速！","抢在关门前上车！"];
      overlay.innerHTML=`<div class="bus-message"><h2>${lines[0]}</h2><p>${lines[1]}</p></div>`;
    } else if(state.phase==="ready") overlay.innerHTML=`<div class="bus-message"><p><kbd>← →</kbd> 移动　<kbd>空格</kbd> 扔白菜　<kbd>Enter</kbd> 开跑</p></div>`;
    else if(state.qte) overlay.innerHTML=`<div class="bus-message bus-qte"><h2><kbd>${state.qte.key==="ArrowLeft"?"←":"→"}</kbd> 闪！</h2></div>`;
    else if(state.phase==="result") overlay.innerHTML=`<div class="bus-message bus-result"><h2>${state.result}</h2><p>第 ${state.place} 名 · ${state.coins} 枚金币 · ${state.card?"公交卡还在":"公交卡不见了"}</p><p>按 <kbd>R</kbd> 重来</p></div>`;
    else if(state.messageTime>0) overlay.innerHTML=`<div class="bus-message bus-toast">${state.message}</div>`; else overlay.innerHTML="";
  }

  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
  switcher.addEventListener("click", (e) => { const button=e.target.closest("button[data-step]"); if(button) setVariant(Number(button.dataset.step)); });
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", resizeCanvas);
  return { start, stop, destroy(){ stop(); window.removeEventListener("keydown",onKey); window.removeEventListener("resize",resizeCanvas); } };
}

export function createGame() {
  return createBusRushPrototype();
}
