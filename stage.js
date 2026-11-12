// ASCII 3D showcase: renders each GLB into a tiny offscreen target, maps shading to glyphs,
// and swaps topics with a scramble-in / scramble-out ("dararak") transition.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const ASSETS = [
  { src: 'models/phone.glb', label: 'Mobile & IoT Computing' },
  { src: 'models/xr.glb',    label: 'XR & Spatial Computing' },
  { src: 'models/chip.glb',  label: 'On-Device AI' },
  { src: 'models/watch.glb', label: 'Care & Health Computing' },
  { src: 'models/agent.glb', label: 'Human-Centered AI Agents' },
];
const RAMP = '.:-=+*%#@';           // light -> dense (shadow side gets more ink)
const NOISE = '01<>/\\|_-+*#%&$@?';
const T_IN = 1100, T_HOLD = 3600, T_OUT = 800;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const root = document.getElementById('stage');
root.innerHTML = '<pre class="stage__ascii" aria-hidden="true"></pre>'
  + '<div class="stage__meta"><p class="stage__label" aria-live="polite"></p><div class="stage__dots"></div></div>';
const pre = root.querySelector('.stage__ascii');
const labelEl = root.querySelector('.stage__label');
const dots = ASSETS.map((a, i) => {
  const b = document.createElement('button');
  b.className = 'stage__dot'; b.type = 'button'; b.setAttribute('aria-label', `${i + 1}. ${a.label}`);
  b.onclick = () => go(i);
  root.querySelector('.stage__dots').append(b);
  return b;
});

// --- three.js offscreen scene ---
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.3, 4); camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-2, 3, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(3, -1, -2); scene.add(rim);
const pivot = new THREE.Group(); scene.add(pivot);
const shade = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const models = ASSETS.map(a => loader.loadAsync(a.src).then(g => {
  const m = g.scene;
  m.traverse(o => { if (o.isMesh) o.material = shade; });
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
  m.scale.setScalar(2.1 / Math.max(size.x, size.y, size.z));
  box.setFromObject(m); m.position.sub(box.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group(); holder.add(m); return holder;
}).catch(() => null));

// --- grid sizing ---
let cols = 0, rows = 0, target, pixels, order;
function measure() {
  const cs = getComputedStyle(pre), probe = document.createElement('canvas').getContext('2d');
  probe.font = `${cs.fontSize} ${cs.fontFamily}`;
  const cw = probe.measureText('M').width, lh = parseFloat(cs.lineHeight);
  const w = root.clientWidth, h = pre.clientHeight || w * 0.78;
  cols = Math.max(20, Math.floor(w / cw)); rows = Math.max(10, Math.floor(h / lh));
  target?.dispose();
  target = new THREE.WebGLRenderTarget(cols, rows);
  pixels = new Uint8Array(cols * rows * 4);
  camera.aspect = (cols * cw) / (rows * lh); camera.updateProjectionMatrix();
  // reveal order: mostly random, biased top-to-bottom so it "types" in
  order = Float32Array.from({ length: cols * rows }, (_, i) => 0.65 * Math.random() + 0.35 * (Math.floor(i / cols) / rows));
}

// --- state machine ---
let idx = 0, phase = 'in', t0 = performance.now(), current = null, running = true, visible = true;
async function show(i) {
  const m = await models[i];
  if (current) pivot.remove(current);
  current = m; if (m) pivot.add(m);
  scramble(ASSETS[i].label);
  dots.forEach((d, k) => d.toggleAttribute('aria-current', k === i));
}
function go(i) { idx = (i + ASSETS.length) % ASSETS.length; phase = 'in'; t0 = performance.now(); show(idx); }

function scramble(text) {
  if (reduce) { labelEl.textContent = text; return; }
  const start = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - start) / 700);
    labelEl.textContent = [...text].map((c, i) => c === ' ' || i / text.length < p ? c
      : NOISE[(Math.random() * NOISE.length) | 0]).join('');
    if (p < 1) requestAnimationFrame(step);
  })(start);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !visible || !cols) return;
  const dt = now - t0;
  let p = 1;
  if (!reduce) {
    if (phase === 'in') { p = Math.min(1, dt / T_IN); if (dt > T_IN) { phase = 'hold'; t0 = now; } }
    else if (phase === 'hold') { if (dt > T_HOLD) { phase = 'out'; t0 = now; } }
    else { p = 1 - Math.min(1, dt / T_OUT); if (dt > T_OUT) { go(idx + 1); return; } }
    pivot.rotation.y = now * 0.0005;
    pivot.position.y = Math.sin(now * 0.0016) * 0.05;
  }
  renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(target, 0, 0, cols, rows, pixels);

  let out = '';
  for (let y = rows - 1; y >= 0; y--) {          // GL rows are bottom-up
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, o = i * 4, cell = (rows - 1 - y) * cols + x;
      if (pixels[o + 3] < 40) { out += ' '; continue; }
      const t = order[cell];
      if (p <= t) { out += ' '; continue; }
      if (p < t + 0.12) { out += NOISE[(Math.random() * NOISE.length) | 0]; continue; }
      const lum = (pixels[o] * 0.3 + pixels[o + 1] * 0.59 + pixels[o + 2] * 0.11) / 255;
      out += RAMP[Math.min(RAMP.length - 1, Math.floor((1 - lum) * RAMP.length))];
    }
    out += '\n';
  }
  pre.textContent = out;
}

new ResizeObserver(measure).observe(root);
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
document.addEventListener('visibilitychange', () => { running = !document.hidden; });
measure(); go(0); requestAnimationFrame(frame);
