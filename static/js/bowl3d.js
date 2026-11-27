/* 그릇 채우기 3D: 뚝배기 안에 손질된 재료가 떨어져 쌓이고 국물이 차오릅니다(three.js, WebGL).
   재료는 모두 코드로 만든 입체 모델입니다(사진·외부 그림 없음). 같은 조명 하나로 비추므로 한 그릇 음식처럼 보입니다.
   쓰는 법: const b = createBowl3D(el, { soup: '#a5321f' }); b.drop('kimchi', n); b.setFill(0~1); b.dispose(); */
import * as THREE from '../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const R_IN = 1.0;        // 그릇 안쪽 반지름(입구)
const DEPTH = 0.62;      // 그릇 깊이
const BOTTOM = -DEPTH;   // 안쪽 바닥 높이

/* ---------- 결정적 난수(같은 재료는 늘 같은 모양) ---------- */
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- 질감(캔버스에 그린 텍스처) ---------- */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function speckle(g, w, h, n, colors, rmin, rmax, r) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(r() * colors.length) | 0];
    g.save(); g.translate(r() * w, r() * h); g.rotate(r() * Math.PI);
    const s = rmin + r() * (rmax - rmin); g.fillRect(-s / 2, -s / 3, s, s * 0.6); g.restore();
  }
}
function blotch(g, x, y, rx, ry, color, alpha, r) {
  g.save(); g.globalAlpha = alpha; g.fillStyle = color; g.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2; const k = 0.75 + r() * 0.5;
    const px = x + Math.cos(a) * rx * k; const py = y + Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(px, py); else g.quadraticCurveTo(x + Math.cos(a - 0.35) * rx * 1.1, y + Math.sin(a - 0.35) * ry * 1.1, px, py);
  }
  g.fill(); g.restore();
}

const TEX = {};
function kimchiTex(variant) {
  const key = 'kimchi' + variant; if (TEX[key]) return TEX[key];
  const r = rng(77 + variant * 13);
  TEX[key] = canvasTex(256, 256, (g, w, h) => {
    // 양념이 고루 묻은 배추김치. 위쪽(잎)은 짙은 붉은빛에 주름, 아래쪽(줄기)은 반투명한 연노랑 위로 양념이 얼룩져 있음.
    g.fillStyle = '#a92e16'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(120,22,8,.9)'); grd.addColorStop(0.4, 'rgba(160,40,14,.5)'); grd.addColorStop(0.55, 'rgba(240,190,120,0)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // 줄기에서 양념이 덜 묻어 속살이 비치는 부분
    for (let i = 0; i < 12; i++) blotch(g, r() * w, h * (0.55 + r() * 0.45), 18 + r() * 34, 10 + r() * 18, r() < 0.5 ? '#f6dca8' : '#eec089', 0.7 + r() * 0.25, r);
    // 잎 쪽 연두빛
    for (let i = 0; i < 4; i++) blotch(g, r() * w, h * (0.3 + r() * 0.2), 18 + r() * 20, 6 + r() * 8, '#b59a3a', 0.25, r);
    // 줄기 결(세로)
    g.strokeStyle = 'rgba(250,215,160,.25)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const x = r() * w; g.beginPath(); g.moveTo(x, h * 0.6); g.bezierCurveTo(x + 8, h * 0.72, x - 6, h * 0.85, x + 4, h); g.stroke(); }
    // 잎 주름(어두운 선)
    g.strokeStyle = 'rgba(80,10,4,.35)'; g.lineWidth = 2;
    for (let x = 10; x < w; x += 34 + r() * 30) { g.beginPath(); g.moveTo(x, h * 0.5); g.quadraticCurveTo(x + (r() - 0.5) * 30, h * 0.25, x + (r() - 0.5) * 20, 0); g.stroke(); }
    // 다시 위에 양념 덩어리
    for (let i = 0; i < 12; i++) blotch(g, r() * w, r() * h, 8 + r() * 18, 5 + r() * 10, r() < 0.5 ? '#b8301a' : '#d4462a', 0.6, r);
    speckle(g, w, h, 320, ['#6e1006', '#8f1a09', '#4f0a03', '#a8220d'], 2, 6, r);
    speckle(g, w, h, 20, ['#f4e2b8', '#efe0c0'], 2, 4, r);
  });
  return TEX[key];
}
function ribTex(variant) {
  const key = 'rib' + variant; if (TEX[key]) return TEX[key]; const r = rng(101 + variant * 7);
  TEX[key] = canvasTex(256, 160, (g, w, h) => {
    // 배추 줄기: 반투명한 연노랑 바탕에 양념 물이 배어 주황빛, 그 위에 고춧가루가 촘촘히
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#e9a568'); grd.addColorStop(0.5, '#f1c78e'); grd.addColorStop(1, '#e5a066');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,248,225,.55)'; g.lineWidth = 3;
    for (let x = 8; x < w; x += 22 + r() * 16) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 5, h * 0.3, x - 4, h * 0.7, x + 2, h); g.stroke(); }
    for (let i = 0; i < 10; i++) blotch(g, r() * w, r() * h, 12 + r() * 30, 8 + r() * 16, '#cc4224', 0.5 + r() * 0.3, r);
    speckle(g, w, h, 420, ['#b3200b', '#8c1707', '#d23614', '#6a0f05'], 2, 5, r);
  });
  return TEX[key];
}
function leafTex(variant) {
  const key = 'leaf' + variant; if (TEX[key]) return TEX[key]; const r = rng(203 + variant * 11);
  TEX[key] = canvasTex(256, 160, (g, w, h) => {
    // 배추 잎: 짙은 붉은 양념, 군데군데 연둣빛, 주름진 잎맥
    g.fillStyle = '#9e2a14'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) blotch(g, r() * w, r() * h, 20 + r() * 30, 10 + r() * 20, '#a59238', 0.3, r);
    for (let i = 0; i < 10; i++) blotch(g, r() * w, r() * h, 14 + r() * 26, 8 + r() * 14, r() < 0.5 ? '#c03a1c' : '#7e1d0b', 0.5, r);
    g.strokeStyle = 'rgba(60,8,2,.3)'; g.lineWidth = 3;
    for (let i = 0; i < 3; i++) { const x = r() * w; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - 0.5) * 60, h * 0.5, x + (r() - 0.5) * 50, 0); g.stroke(); }
    speckle(g, w, h, 300, ['#5e0c03', '#7a1206', '#b3200b'], 2, 5, r);
  });
  return TEX[key];
}
function porkTex() {
  if (TEX.pork) return TEX.pork; const r = rng(5);
  TEX.pork = canvasTex(256, 256, (g, w, h) => {
    // 익은 돼지고기: 회갈색 살, 국물이 밴 붉은 기, 가장자리 쪽 연한 지방
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#d9bfa4'); grd.addColorStop(0.22, '#b88a70'); grd.addColorStop(1, '#9a6a54');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) blotch(g, r() * w, r() * h, 30 + r() * 40, 20 + r() * 30, r() < 0.5 ? '#946251' : '#bf917a', 0.35, r);
    for (let i = 0; i < 6; i++) blotch(g, r() * w, r() * h, 30 + r() * 40, 16 + r() * 24, '#b5492e', 0.3, r);
    speckle(g, w, h, 40, ['#8c1707', '#a8220d'], 3, 6, r);
  });
  return TEX.pork;
}
function tofuTex() {
  if (TEX.tofu) return TEX.tofu; const r = rng(9);
  TEX.tofu = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f6eedb'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${200 + r() * 30},${180 + r() * 30},${140 + r() * 30},${0.15 + r() * 0.2})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    // 국물이 살짝 묻은 가장자리
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.75); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(200,80,40,.35)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  return TEX.tofu;
}
function potTex() {
  if (TEX.pot) return TEX.pot; const r = rng(3);
  TEX.pot = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#3a2418'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${40 + r() * 30},${r() * 0.25})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  });
  TEX.pot.wrapS = THREE.RepeatWrapping; return TEX.pot;
}

/* ---------- 모양 ---------- */
// 얇은 판(두께 있음)을 휘고 가장자리를 물결지게: 김치·고기 조각
function slab(w, h, t, curl, wave, seed, frill) {
  const g = new THREE.BoxGeometry(w, t, h, 14, 1, 10);
  const p = g.attributes.position; const r = rng(seed); const ph = r() * 6.28; const ph2 = r() * 6.28;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i); let y = p.getY(i); let z = p.getZ(i);
    const u = x / w; const v = z / h; // -0.5~0.5
    // 가로로 둥글게 말림
    y += -curl * (u * u * 4) * w * 0.5 + curl * 0.12 * w;
    // 세로로 살짝 휨
    y += Math.sin(v * Math.PI + ph) * wave * h;
    // 잎 쪽(v<0) 가장자리 주름
    if (frill && v < -0.1) {
      const edge = Math.min(1, (-v - 0.1) / 0.4);
      y += (Math.sin(u * 13 + ph2) * 0.6 + Math.sin(u * 29 + ph) * 0.4) * 0.03 * edge * w;
      z += Math.sin(u * 11 + ph) * 0.03 * edge * h;
    }
    // 외곽선을 조금 들쭉날쭉하게
    x *= 1 + Math.sin(v * 9 + ph2) * 0.06;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); return g;
}
function halfRing(R, tube, seed) {
  const g = new THREE.TorusGeometry(R, tube, 10, 28, Math.PI * (0.8 + rng(seed)() * 0.3));
  g.scale(1, 1, 0.45); g.rotateX(Math.PI / 2); return g;
}

/* ---------- 재료 정의 ---------- */
const MAT = {};
function mats() {
  if (MAT.ok) return MAT;
  MAT.rib = [0, 1, 2].map((v) => new THREE.MeshPhysicalMaterial({ map: ribTex(v), color: '#f0d6c0', roughness: 0.35, envMapIntensity: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide }));
  MAT.leaf = [0, 1, 2].map((v) => new THREE.MeshPhysicalMaterial({ map: leafTex(v), roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, side: THREE.DoubleSide }));
  MAT.pork = new THREE.MeshPhysicalMaterial({ map: porkTex(), roughness: 0.55, envMapIntensity: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  MAT.tofu = new THREE.MeshPhysicalMaterial({ map: tofuTex(), color: '#eadcc4', roughness: 0.55, clearcoat: 0.25, sheen: 0.4, sheenColor: new THREE.Color('#fff8e8') });
  MAT.scOut = new THREE.MeshPhysicalMaterial({ color: '#3f8a22', side: THREE.DoubleSide, roughness: 0.35, clearcoat: 0.6 });
  MAT.scIn = new THREE.MeshPhysicalMaterial({ color: '#b8dc7a', side: THREE.DoubleSide, roughness: 0.5, emissive: '#2a4a10', emissiveIntensity: 0.15 });
  MAT.onion = new THREE.MeshPhysicalMaterial({ color: '#e9c9a2', roughness: 0.35, envMapIntensity: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  MAT.ok = true; return MAT;
}

const SPECS = {
  kimchi: { size: 0.3, make(r, i) {
    // 김치 한 조각 = 도톰한 줄기 + 그 끝에 붙은 주름진 잎
    const m = mats(); const g = new THREE.Group(); const w = 0.24 + r() * 0.08;
    const rib = new THREE.Mesh(slab(w, 0.15 + r() * 0.05, 0.05, 0.45 + r() * 0.3, 0.05, i * 31 + 7, false), m.rib[i % 3]);
    const leaf = new THREE.Mesh(slab(w * (1.05 + r() * 0.2), 0.17 + r() * 0.06, 0.014, 0.25, 0.22, i * 17 + 5, true), m.leaf[i % 3]);
    leaf.position.set((r() - 0.5) * 0.03, 0.02, -0.15); leaf.rotation.x = -0.25 - r() * 0.3;
    g.add(rib, leaf); return g; } },
  pork:   { size: 0.2, make(r, i) {
    // 익은 돼지고기 덩어리: 모서리가 둥근 납작한 덩어리를 울퉁불퉁하게
    const g = new RoundedBoxGeometry(0.16 + r() * 0.05, 0.06 + r() * 0.02, 0.11 + r() * 0.03, 3, 0.02);
    const p = g.attributes.position; const rr = rng(i * 13 + 1);
    const s1 = rr() * 6; const s2 = rr() * 6;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k); const y = p.getY(k); const z = p.getZ(k); const f = 1 + Math.sin(x * 31 + s1) * Math.cos(z * 27 + s2) * 0.07; p.setXYZ(k, x * f, y * (1 + Math.sin(x * 23 + z * 19 + s1) * 0.15), z * f); }
    g.computeVertexNormals(); return new THREE.Mesh(g, mats().pork); } },
  tofu:   { size: 0.16, make(r) { const s = 0.15 + r() * 0.02; return new THREE.Mesh(new RoundedBoxGeometry(s, s * 0.9, s, 3, 0.022), mats().tofu); } },
  scallion: { size: 0.09, make() {
    const m = mats(); const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 20, 1, true), m.scOut);
    const cap = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.045, 20), m.scIn); cap.rotation.x = -Math.PI / 2; cap.position.y = 0.0111;
    const cap2 = cap.clone(); cap2.rotation.x = Math.PI / 2; cap2.position.y = -0.0111;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 12, 1, true), m.scOut);
    g.add(outer, cap, cap2, inner); return g; } },
  onion: { size: 0.16, make(r, i) { return new THREE.Mesh(halfRing(0.11 + r() * 0.03, 0.02, i), mats().onion); } },
};

export function createBowl3D(el, opts = {}) {
  const W = () => el.clientWidth || 600; const H = () => el.clientHeight || 400;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.capture });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(31, W() / H(), 0.1, 50);
  camera.position.set(0, 2.75, 2.75); camera.lookAt(0, -0.32, 0.05);

  const key = new THREE.DirectionalLight('#fff1dc', 1.7); key.position.set(-2.2, 4, 1.6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -1.8, right: 1.8, top: 1.8, bottom: -1.8, near: 0.5, far: 10 });
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffd2b0', 0.8); rim.position.set(2, 2, -2); scene.add(rim);
  scene.add(new THREE.HemisphereLight('#fff4e6', '#3a2010', 0.35));

  /* 뚝배기: 바깥은 거친 흙빛, 입구 테두리는 둥글게, 안쪽은 윤기 있는 검은 유약 */
  const prof = [];
  const outerR = R_IN + 0.12;
  prof.push(new THREE.Vector2(0, BOTTOM - 0.1));
  prof.push(new THREE.Vector2(outerR * 0.7, BOTTOM - 0.1));
  prof.push(new THREE.Vector2(outerR * 0.95, BOTTOM + 0.1));
  prof.push(new THREE.Vector2(outerR * 1.04, -0.25));
  prof.push(new THREE.Vector2(outerR, -0.02));
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; prof.push(new THREE.Vector2(R_IN + 0.06 + Math.cos(a) * 0.06, 0.02 + Math.sin(a) * 0.05)); }
  prof.push(new THREE.Vector2(R_IN - 0.01, -0.05));
  prof.push(new THREE.Vector2(R_IN * 0.93, BOTTOM + 0.18));
  prof.push(new THREE.Vector2(R_IN * 0.72, BOTTOM + 0.02));
  prof.push(new THREE.Vector2(0, BOTTOM));
  const potGeo = new THREE.LatheGeometry(prof, 96);
  const pot = new THREE.Mesh(potGeo, new THREE.MeshPhysicalMaterial({ map: potTex(), color: '#6b4430', roughness: 0.55, clearcoat: 0.55, clearcoatRoughness: 0.35 }));
  pot.castShadow = true; pot.receiveShadow = true; scene.add(pot);

  // 받침 그림자
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = BOTTOM - 0.1; floor.receiveShadow = true; scene.add(floor);

  /* 국물: 물결이 살짝 이는 원판. 높이가 차오릅니다. */
  const soupGeo = new THREE.CircleGeometry(1, 72); soupGeo.rotateX(-Math.PI / 2);
  const soupTex = canvasTex(512, 512, (g, w, h) => {
    const base = new THREE.Color(opts.soup || '#a5321f');
    const c0 = base.clone().offsetHSL(0.02, 0.2, 0.01).getStyle(); const c1 = base.clone().offsetHSL(0, 0.1, -0.1).getStyle();
    const grd = g.createRadialGradient(w * 0.45, h * 0.42, w * 0.05, w / 2, h / 2, w * 0.5); grd.addColorStop(0, c0); grd.addColorStop(1, c1);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 60; i++) blotch(g, r() * w, r() * h, 10 + r() * 40, 8 + r() * 30, r() < 0.5 ? '#8a1c08' : '#e0582a', 0.12, r);   // 고춧가루 풀린 얼룩
    speckle(g, w, h, 500, ['rgba(90,12,4,.6)', 'rgba(120,20,6,.5)'], 1.5, 4, r);                               // 떠다니는 고춧가루
  });
  const soupMat = new THREE.MeshPhysicalMaterial({ map: soupTex, emissive: '#7a1a06', emissiveIntensity: 0.35, roughness: 0.25, envMapIntensity: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.1, sheen: 0.2, sheenColor: new THREE.Color('#ff9a6a') });
  const soup = new THREE.Mesh(soupGeo, soupMat); soup.receiveShadow = true; scene.add(soup); if (opts.noSoup) soup.visible = false;
  // 기름 방울
  const oil = new THREE.Group(); soup.add(oil);
  const oilMat = new THREE.MeshPhysicalMaterial({ color: '#ff9a3c', roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.35 });
  { const r = rng(42); for (let i = 0; i < 16; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.008 + r() * 0.02, 20), oilMat); d.rotation.x = -Math.PI / 2; const a = r() * 6.28; const rr = Math.sqrt(r()) * 0.85; d.position.set(Math.cos(a) * rr, 0.002, Math.sin(a) * rr); oil.add(d); } }

  /* 김: 부드러운 흰 연기 판 몇 장이 천천히 오르며 사라집니다 */
  const steamTex = canvasTex(128, 128, (g, w, h) => { const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); });
  const steam = [];
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
    sp.userData = { ph: i / 7, x: (Math.random() - 0.5) * 0.8, z: (Math.random() - 0.5) * 0.6 };
    scene.add(sp); steam.push(sp);
  }

  let fill = 0; let fillShown = 0;
  const soupY = (f) => BOTTOM + 0.16 + 0.3 * f;
  const TOP = soupY(1) + 0.02; // 재료가 쌓일 수 있는 가장 높은 곳(입구보다 한참 아래)
  const radiusAt = (y) => { const t = (y - BOTTOM) / DEPTH; return R_IN * (0.72 + 0.28 * Math.min(1, Math.max(0, t)) ** 0.7) - 0.02; };

  /* 쌓임: 바닥 격자의 높이를 기억했다가 조각이 그 위에 내려앉습니다 */
  const N = 24; const hmap = new Float32Array(N * N).fill(BOTTOM);
  const cell = (x, z) => { const i = Math.round(((x + 1) / 2) * (N - 1)); const j = Math.round(((z + 1) / 2) * (N - 1)); return Math.max(0, Math.min(N - 1, i)) + Math.max(0, Math.min(N - 1, j)) * N; };
  const pieces = [];
  let count = 0;

  function drop(kind, n = 1, from) {
    const spec = SPECS[kind]; if (!spec) return;
    for (let k = 0; k < n; k++) {
      const r = rng(++count * 9973 + kind.length * 131);
      const m = spec.make(r, count);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // 떨어질 자리: 가운데로 모이게, 무더기 근처면 그 위로
      const a = r() * Math.PI * 2; const rr = Math.min(0.42, Math.abs((r() + r() + r() - 1.5) * 0.5)) * R_IN;
      const x = (from ? from.x : 0) * 0.3 + Math.cos(a) * rr; const z = (from ? from.z : 0) * 0.3 + Math.sin(a) * rr;
      m.position.set(x, 1.3 + r() * 0.3, z);
      m.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28);
      const rest = new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5);
      scene.add(m);
      pieces.push({ m, vy: 0, rest, spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(6), size: spec.size, settled: false, x, z, t: 0 });
    }
  }

  // 높은 곳에 떨어지면 낮은 쪽으로 미끄러져 내려가 무더기가 자연스러운 산 모양이 됩니다.
  const hAt = (x, z) => hmap[cell(x, z)];
  function slide(p) {
    const st = 2 / (N - 1) * 1.5;
    for (let it = 0; it < 14; it++) {
      const h0 = hAt(p.x, p.z); let best = null; let bh = h0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2; const nx = p.x + Math.cos(a) * st; const nz = p.z + Math.sin(a) * st;
        if (Math.hypot(nx, nz) > maxR(p, hAt(nx, nz))) continue;
        const hh = hAt(nx, nz); if (hh < bh) { bh = hh; best = [nx, nz]; }
      }
      if (!best || h0 - bh < p.size * 0.22) break;
      p.x = best[0]; p.z = best[1];
    }
    keepInside(p, hAt(p.x, p.z));
    p.m.position.x = p.x; p.m.position.z = p.z;
  }
  // 그릇 벽 안쪽에만: 그 높이의 안쪽 반지름에서 조각 반 크기만큼 뺀 거리까지
  function maxR(p, y) { return Math.max(0.05, radiusAt(Math.min(y, TOP)) - p.size * 0.62); }
  function keepInside(p, y) {
    const d = Math.hypot(p.x, p.z); const m = maxR(p, y);
    if (d > m) { p.x *= m / d; p.z *= m / d; }
  }
  function settleHeight(p) {
    let base = BOTTOM; const rad = p.size * 0.45;
    for (let dx = -rad; dx <= rad; dx += rad) for (let dz = -rad; dz <= rad; dz += rad) base = Math.max(base, hmap[cell(p.x + dx, p.z + dz)]);
    return Math.min(TOP, base + p.size * 0.12);
  }
  function stamp(p) {
    // 이 조각이 차지한 칸들을 높여서 다음 조각이 위에 쌓이게
    const rad = p.size * 0.75;
    for (let dx = -rad; dx <= rad; dx += 2 / (N - 1)) for (let dz = -rad; dz <= rad; dz += 2 / (N - 1)) {
      if (dx * dx + dz * dz > rad * rad) continue;
      const c = cell(p.x + dx, p.z + dz); hmap[c] = Math.max(hmap[c], p.m.position.y + p.size * 0.1 * (1 - (dx * dx + dz * dz) / (rad * rad) * 0.6));
    }
  }

  function setFill(f) { fill = Math.max(0, Math.min(1, f)); }

  let raf = 0; let last = performance.now(); let disposed = false;
  function frame(now) {
    if (disposed) return;
    const dtAll = Math.min(0.3, (now - last) / 1000); last = now;
    const steps = Math.max(1, Math.ceil(dtAll / 0.02)); const dt = dtAll / steps;
    fillShown += (fill - fillShown) * Math.min(1, dtAll * 3);
    const sy = soupY(fillShown);
    soup.position.y = sy; const sr = radiusAt(sy); soup.scale.set(sr, 1, sr);
    // 물결
    const t = now / 1000;
    oil.children.forEach((d, i) => { d.position.x += Math.sin(t * 0.6 + i) * 0.0004; d.position.z += Math.cos(t * 0.5 + i * 1.3) * 0.0004; });
    for (const sp of steam) {
      const u = (t * 0.12 + sp.userData.ph) % 1;
      sp.position.set(sp.userData.x + Math.sin(t * 0.7 + sp.userData.ph * 9) * 0.08, sy + 0.1 + u * 1.1, sp.userData.z);
      const sc = 0.5 + u * 0.9; sp.scale.set(sc, sc, 1);
      sp.material.opacity = Math.sin(u * Math.PI) * 0.22 * (0.4 + fillShown);
    }
    for (let st = 0; st < steps; st++) for (const p of pieces) {
      if (p.settled) {
        // 국물 위에 뜬 조각은 살랑살랑
        if (p.m.position.y < sy + 0.02) p.m.position.y += (Math.max(p.restY, sy - p.size * 0.05) - p.m.position.y) * 0.05;
        continue;
      }
      p.t += dt; p.vy -= 9.8 * dt * 0.9;
      p.m.position.y += p.vy * dt;
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
      if (!p.slid && p.m.position.y < 0.4) { slide(p); p.slid = true; }
      const floorY = settleHeight(p);
      if (p.m.position.y <= floorY) {
        p.m.position.y = floorY;
        if (Math.abs(p.vy) > 1.2) { p.vy = -p.vy * 0.25; p.spin.multiplyScalar(0.3); }
        else {
          p.settled = true; p.restY = floorY;
          p.m.rotation.copy(p.rest);
          stamp(p);
        }
      }
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });
  ro.observe(el);

  return {
    drop, setFill,
    get pieces() { return pieces.length; },
    clear() { for (const p of pieces) scene.remove(p.m); pieces.length = 0; hmap.fill(BOTTOM); },
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement); },
  };
}
