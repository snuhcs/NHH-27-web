// ASCII 3D showcase.
// Two tiny offscreen passes per frame: (1) lit shading -> glyph density, (2) normals+depth -> edges.
// Edges become directional glyphs (| / - \), fill is colored by depth (near / far layers),
// and topics swap with a scramble-in / scramble-out ("dararak") transition.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// yaw/pitch: the pose that reads best; the model swings ±swing around it
const ASSETS = [
  { src: 'models/phone.glb', label: 'Mobile & IoT Computing',   yaw: 0.35, pitch: 0.1,  swing: 0.45 },
  { src: 'models/xr.glb',    label: 'XR & Spatial Computing',   yaw: 0.6,  pitch: 0.15, swing: 0.35 },
  { src: 'models/chip.glb',  label: 'On-Device AI',             yaw: 0.7,  pitch: 1.0,  swing: 0.35 },
  { src: 'models/watch.glb', label: 'Care & Health Computing',  yaw: 0.3,  pitch: 0.05, swing: 0.2 },
  { src: 'models/agent.glb', label: 'Human-Centered AI Agents', yaw: 0.3,  pitch: 0.1,  swing: 0.4 },
];
// 70-level ramp, dense -> sparse. Glyphs are light on dark, so bright surfaces take the dense end.
const RAMP = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'.';
const BANDS = 6;                     // brightness bands per depth half -> colour tones (see stage.css)
const NOISE = '01<>/\\|_-+*#%&$@?';
const T_IN = 1100, T_HOLD = 3800, T_OUT = 800, FPS = 30;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const root = document.getElementById('stage');
// one <pre> per colour: near tones 0..BANDS-1, far tones 0..BANDS-1, edges, transition noise
const TONES = [...Array(BANDS)].flatMap((_, b) => [`near t${b}`, `far t${b}`]);
const LAYERS = [...TONES, 'edge', 'noise'];
root.innerHTML = '<div class="stage__canvas" aria-hidden="true">'
  + LAYERS.map(c => `<pre class="stage__layer ${c}" style="--k:${(+c.slice(-1) || 0) / (BANDS - 1)}"></pre>`).join('')
  + '</div><div class="stage__meta"><p class="stage__label" aria-live="polite"></p><div class="stage__dots"></div></div>';
const box = root.querySelector('.stage__canvas');
const layerEls = [...root.querySelectorAll('.stage__layer')];
const edgeEl = layerEls[LAYERS.indexOf('edge')];
const L_EDGE = LAYERS.indexOf('edge'), L_NOISE = LAYERS.indexOf('noise');
const toneLayer = (band, isFar) => band * 2 + (isFar ? 1 : 0);
const ascii = new TextDecoder('ascii');
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
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 20);
scene.add(new THREE.AmbientLight(0xffffff, 0.12));
const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-2.5, 3, 3); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(3, -1, 1.5); scene.add(fill);
const pivot = new THREE.Group(); scene.add(pivot);

const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, flatShading: true });
// R,G = view-space normal xy, B = depth across the model's own extent
const geoMat = new THREE.ShaderMaterial({
  uniforms: { near: { value: 3 }, far: { value: 7 } },
  vertexShader: `varying vec3 vN; varying float vZ;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float near, far; varying vec3 vN; varying float vZ;
    void main(){ vec3 n = normalize(gl_FrontFacing ? vN : -vN);
      gl_FragColor = vec4(n.xy * .5 + .5, clamp((vZ - near) / (far - near), 0., 1.), 1.); }`,
  side: THREE.DoubleSide,
});

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const models = ASSETS.map(a => loader.loadAsync(a.src).then(g => {
  const m = g.scene;
  m.traverse(o => { if (o.isMesh) { o.geometry.computeVertexNormals(); o.material = shadeMat; } });
  const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3());
  m.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z));
  bb.setFromObject(m); m.position.sub(bb.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group(); holder.add(m); return holder;
}).catch(() => null));

// --- grid sizing ---
let cols = 0, rows = 0, rtShade, rtGeo, pxShade, pxGeo, order, bufs;
function measure() {
  const cs = getComputedStyle(edgeEl), probe = document.createElement('canvas').getContext('2d');
  probe.font = `${cs.fontSize} ${cs.fontFamily}`;
  const cw = probe.measureText('M').width, lh = parseFloat(cs.lineHeight);
  cols = Math.max(24, Math.floor(box.clientWidth / cw)); rows = Math.max(12, Math.floor(box.clientHeight / lh));
  rtShade?.dispose(); rtGeo?.dispose();
  rtShade = new THREE.WebGLRenderTarget(cols, rows); rtGeo = new THREE.WebGLRenderTarget(cols, rows);
  pxShade = new Uint8Array(cols * rows * 4); pxGeo = new Uint8Array(cols * rows * 4);
  camera.aspect = (cols * cw) / (rows * lh); camera.updateProjectionMatrix();
  const z = camera.aspect < 1 ? 5 / camera.aspect : 5;           // keep the model inside the shorter side
  camera.position.set(0, 0, z); camera.lookAt(0, 0, 0);
  geoMat.uniforms.near.value = z - 1.3; geoMat.uniforms.far.value = z + 1.3;
  bufs = LAYERS.map(() => new Uint8Array(rows * (cols + 1)));
  order = Float32Array.from({ length: cols * rows }, (_, i) => 0.65 * Math.random() + 0.35 * (Math.floor(i / cols) / rows));
}

// --- state machine ---
let idx = 0, phase = 'in', t0 = performance.now(), current = null, running = true, visible = true, last = 0;
async function show(i) {
  const m = await models[i];
  if (i !== idx) return;
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

const edgeGlyph = (gx, gy) => {                    // edge runs perpendicular to the gradient (screen y down)
  const ax = Math.abs(gx), ay = Math.abs(gy);
  if (ax > 2.2 * ay) return '|';
  if (ay > 2.2 * ax) return '-';
  return gx * gy > 0 ? '/' : '\\';
};

function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !visible || !cols || now - last < 1000 / FPS) return;
  last = now;
  const dt = now - t0, a = ASSETS[idx];
  let p = 1;
  if (!reduce) {
    if (phase === 'in') { p = Math.min(1, dt / T_IN); if (dt > T_IN) { phase = 'hold'; t0 = now; } }
    else if (phase === 'hold') { if (dt > T_HOLD) { phase = 'out'; t0 = now; } }
    else { p = 1 - Math.min(1, dt / T_OUT); if (dt > T_OUT) { go(idx + 1); return; } }
  }
  pivot.rotation.set(a.pitch, a.yaw + (reduce ? 0.35 : Math.sin(now * 0.0006) * a.swing), 0);
  pivot.position.y = reduce ? 0 : Math.sin(now * 0.0016) * 0.04;

  scene.overrideMaterial = null;
  renderer.setRenderTarget(rtShade); renderer.render(scene, camera);
  scene.overrideMaterial = geoMat;
  renderer.setRenderTarget(rtGeo); renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(rtShade, 0, 0, cols, rows, pxShade);
  renderer.readRenderTargetPixels(rtGeo, 0, 0, cols, rows, pxGeo);

  // screen-space accessors (row 0 = top; GL rows are bottom-up)
  const gi = (x, y) => ((rows - 1 - y) * cols + x) * 4;
  const cov = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && pxGeo[gi(x, y) + 3] > 128;
  const lum = o => (pxShade[o] * .3 + pxShade[o + 1] * .59 + pxShade[o + 2] * .11) / 255;
  const val = (x, y) => cov(x, y) ? 2 - pxGeo[gi(x, y) + 2] / 255 : 0;   // coverage + nearness
  const nrm = (x, y) => [pxGeo[gi(x, y)] / 127.5 - 1, pxGeo[gi(x, y) + 1] / 127.5 - 1];

  // per-frame contrast stretch over covered cells
  let lo = 1, hi = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (cov(x, y)) {
    const l = lum(gi(x, y)); if (l < lo) lo = l; if (l > hi) hi = l;
  }
  const span = Math.max(0.05, hi - lo);

  for (const buf of bufs) { buf.fill(32); for (let y = 0; y < rows; y++) buf[y * (cols + 1) + cols] = 10; }
  const put = (layer, x, y, ch) => { bufs[layer][y * (cols + 1) + x] = ch.charCodeAt(0); };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!cov(x, y)) continue;
      const t = order[y * cols + x];
      if (p <= t) continue;
      if (p < t + 0.12) { put(L_NOISE, x, y, NOISE[(Math.random() * NOISE.length) | 0]); continue; }
      const gx = val(x + 1, y) - val(x - 1, y), gy = val(x, y + 1) - val(x, y - 1);
      const [nx, ny] = nrm(x, y);
      const [rx, ry] = cov(x + 1, y) ? nrm(x + 1, y) : [nx, ny];
      const [dx, dy] = cov(x, y + 1) ? nrm(x, y + 1) : [nx, ny];
      const crease = Math.hypot(nx - rx, ny - ry) + Math.hypot(nx - dx, ny - dy);
      if (Math.abs(gx) + Math.abs(gy) > 0.18 || crease > 0.55) { put(L_EDGE, x, y, edgeGlyph(gx || rx - nx, gy || dy - ny)); continue; }
      const o = gi(x, y);
      const l = Math.min(1, Math.max(0, (lum(o) - lo) / span));
      const g = RAMP[Math.round((1 - l) * (RAMP.length - 1))];
      put(toneLayer(Math.min(BANDS - 1, Math.floor(l * BANDS)), pxGeo[o + 2] / 255 >= 0.5), x, y, g);
    }
  }
  bufs.forEach((buf, i) => { layerEls[i].textContent = ascii.decode(buf); });
}

new ResizeObserver(measure).observe(box);
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
document.addEventListener('visibilitychange', () => { running = !document.hidden; });
measure(); go(0); requestAnimationFrame(frame);
