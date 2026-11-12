// ASCII 3D showcase.
// Each view renders its model into two tiny offscreen targets per frame:
// (1) lit shading -> glyph density, (2) normals+depth -> edges. Edges become directional glyphs,
// fill is split into colour tones by brightness and depth (see stage.css).
// The main view cycles research topics with a scramble-in / scramble-out ("dararak") transition
// (click to skip ahead);
// small bust views of the three professors float around it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// yaw/pitch: the pose that reads best; the model swings ±swing around it
const ASSETS = [
  { src: 'models/phone.glb', label: 'Mobile & IoT Computing',   yaw: 0.15, pitch: 0.1,  swing: 0.35 },
  { src: 'models/xr.glb',    label: 'XR & Spatial Computing',   yaw: 0.6,  pitch: 0.15, swing: 0.35 },
  { src: 'models/chip.glb',  label: 'On-Device AI',             yaw: 0.7,  pitch: 1.0,  swing: 0.35 },
  { src: 'models/watch.glb', label: 'Care & Health Computing',  yaw: 0.3,  pitch: 0.05, swing: 0.2 },
  { src: 'models/agent.glb', label: 'Human-Centered AI Agents', yaw: 0.3,  pitch: 0.1,  swing: 0.4 },
];
// busts sit left / right / left of the main view, so each is turned to face the centre
const BUSTS = [
  { src: 'models/bust-song.glb',  name: 'Junehwa Song', lab: 'NC · KAIST',    yaw: -0.15, pitch: 0.1,  swing: 0.25 },
  { src: 'models/bust-lee.glb',   name: 'Youngki Lee',  lab: 'HCS · SNU',     yaw: -0.45, pitch: 0.1,  swing: 0.25 },
  { src: 'models/bust-hwang.glb', name: 'Inseok Hwang', lab: 'HIS · POSTECH', yaw: 0.4,   pitch: 0.12, swing: 0.25 },
];
// 70-level ramp, dense -> sparse. Glyphs are light on dark, so bright surfaces take the dense end.
const RAMP = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'.';
const BANDS = 6;                     // brightness bands per depth half -> colour tones
const NOISE = '01<>/\\|_-+*#%&$@?';
const T_IN = 1100, T_HOLD = 3800, T_OUT = 800, FPS = 30;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// one <pre> per colour: near tones 0..BANDS-1, far tones 0..BANDS-1, edges, transition noise
const LAYERS = [...[...Array(BANDS)].flatMap((_, b) => [`near t${b}`, `far t${b}`]), 'edge', 'noise'];
const L_EDGE = LAYERS.indexOf('edge'), L_NOISE = LAYERS.indexOf('noise');
const toneLayer = (band, isFar) => band * 2 + (isFar ? 1 : 0);
const layerHTML = LAYERS.map(c => `<pre class="stage__layer ${c}" style="--k:${(+c.slice(-1) || 0) / (BANDS - 1)}"></pre>`).join('');
const ascii = new TextDecoder('ascii');

// --- shared three.js pieces ---
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
renderer.setClearColor(0x000000, 0);
const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, flatShading: true });
// R,G = view-space normal xy, B = depth across the model's own extent (near/far set per view)
const makeGeoMat = () => new THREE.ShaderMaterial({
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
const MODEL_V = 4;                    // bump when files in models/ change, so browsers refetch
const load = src => loader.loadAsync(`${src}?v=${MODEL_V}`).then(g => {
  const m = g.scene;
  m.traverse(o => { if (o.isMesh) { o.geometry.computeVertexNormals(); o.material = shadeMat; } });
  const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3());
  m.scale.setScalar(2.0 / Math.max(size.x, size.y, size.z));
  bb.setFromObject(m); m.position.sub(bb.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group(); holder.add(m); return holder;
}).catch(() => null);

const edgeGlyph = (gx, gy) => {                    // edge runs perpendicular to the gradient (screen y down)
  const ax = Math.abs(gx), ay = Math.abs(gy);
  if (ax > 2.2 * ay) return '|';
  if (ay > 2.2 * ax) return '-';
  return gx * gy > 0 ? '/' : '\\';
};

// --- one ASCII viewport: its own scene, camera, targets and glyph layers inside `box` ---
function makeView(box) {
  box.insertAdjacentHTML('afterbegin', layerHTML);
  const v = { box, layerEls: [...box.querySelectorAll(':scope > .stage__layer')], cols: 0, rows: 0, model: null };
  v.scene = new THREE.Scene();
  v.scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-2.5, 3, 3); v.scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(3, -1, 1.5); v.scene.add(fill);
  v.pivot = new THREE.Group(); v.scene.add(v.pivot);
  v.camera = new THREE.PerspectiveCamera(28, 1, 0.5, 20);
  v.geoMat = makeGeoMat();
  v.measure = () => {
    const cs = getComputedStyle(v.layerEls[0]), probe = document.createElement('canvas').getContext('2d');
    probe.font = `${cs.fontSize} ${cs.fontFamily}`;
    const cw = probe.measureText('M').width, lh = parseFloat(cs.lineHeight);
    const cols = Math.max(12, Math.floor(box.clientWidth / cw)), rows = Math.max(8, Math.floor(box.clientHeight / lh));
    Object.assign(v, { cols, rows });
    v.rtShade?.dispose(); v.rtGeo?.dispose();
    v.rtShade = new THREE.WebGLRenderTarget(cols, rows); v.rtGeo = new THREE.WebGLRenderTarget(cols, rows);
    v.pxShade = new Uint8Array(cols * rows * 4); v.pxGeo = new Uint8Array(cols * rows * 4);
    v.camera.aspect = (cols * cw) / (rows * lh); v.camera.updateProjectionMatrix();
    const z = v.camera.aspect < 1 ? 5 / v.camera.aspect : 5;       // keep the model inside the shorter side
    v.camera.position.set(0, 0, z); v.camera.lookAt(0, 0, 0);
    v.geoMat.uniforms.near.value = z - 1.3; v.geoMat.uniforms.far.value = z + 1.3;
    v.bufs = LAYERS.map(() => new Uint8Array(rows * (cols + 1)));
    v.order = Float32Array.from({ length: cols * rows }, (_, i) => 0.65 * Math.random() + 0.35 * (Math.floor(i / cols) / rows));
  };
  v.setModel = m => { if (v.model) v.pivot.remove(v.model); v.model = m; if (m) v.pivot.add(m); };
  new ResizeObserver(v.measure).observe(box);
  v.measure();
  return v;
}

function draw(v, p) {                                 // p: reveal progress 0..1 for the scramble transition
  const { cols, rows, pxShade, pxGeo, bufs, order } = v;
  if (!cols) return;
  v.scene.overrideMaterial = null;
  renderer.setRenderTarget(v.rtShade); renderer.render(v.scene, v.camera);
  v.scene.overrideMaterial = v.geoMat;
  renderer.setRenderTarget(v.rtGeo); renderer.render(v.scene, v.camera);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(v.rtShade, 0, 0, cols, rows, pxShade);
  renderer.readRenderTargetPixels(v.rtGeo, 0, 0, cols, rows, pxGeo);

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
      put(toneLayer(Math.min(BANDS - 1, Math.floor(l * BANDS)), pxGeo[o + 2] / 255 >= 0.5), x, y, RAMP[Math.round((1 - l) * (RAMP.length - 1))]);
    }
  }
  bufs.forEach((buf, i) => { v.layerEls[i].textContent = ascii.decode(buf); });
}

const pose = (v, a, now, phase = 0) => {
  v.pivot.rotation.set(a.pitch, a.yaw + (reduce ? 0 : Math.sin(now * 0.0006 + phase) * a.swing), 0);
  v.pivot.position.y = reduce ? 0 : Math.sin(now * 0.0016 + phase) * 0.04;
};

// --- DOM ---
const root = document.getElementById('stage');
root.innerHTML = '<div class="stage__canvas" role="button" tabindex="0">'
  + BUSTS.map((b, i) => `<figure class="stage__bust b${i}" aria-hidden="true" hidden><div class="stage__bust-view"></div>`
    + `<figcaption>${b.name}<span>${b.lab}</span></figcaption></figure>`).join('')
  + '</div>';
const canvas = root.querySelector('.stage__canvas');
const main = makeView(canvas);
// click / Enter / Space skips to the next topic (plays the scramble-out first)
const next = () => { if (reduce) go(idx + 1); else if (phase !== 'out') { phase = 'out'; t0 = performance.now(); } };
canvas.addEventListener('click', next);
canvas.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } });
const models = ASSETS.map(a => load(a.src));
const busts = BUSTS.map((b, i) => {
  const fig = root.querySelector(`.stage__bust.b${i}`);
  const v = makeView(fig.querySelector('.stage__bust-view'));
  load(b.src).then(m => { if (m) { fig.hidden = false; v.measure(); v.setModel(m); } });
  return v;
});

// --- main view state machine ---
let idx = 0, phase = 'in', t0 = performance.now(), running = true, visible = true, last = 0;
async function show(i) {
  const m = await models[i];
  if (i !== idx) return;
  main.setModel(m);
  canvas.setAttribute('aria-label', `연구 주제: ${ASSETS[i].label}. 누르면 다음 주제`);
}
function go(i) { idx = (i + ASSETS.length) % ASSETS.length; phase = 'in'; t0 = performance.now(); show(idx); }

function frame(now) {
  requestAnimationFrame(frame);
  if (!running || !visible || now - last < 1000 / FPS) return;
  last = now;
  const dt = now - t0;
  let p = 1;
  if (!reduce) {
    if (phase === 'in') { p = Math.min(1, dt / T_IN); if (dt > T_IN) { phase = 'hold'; t0 = now; } }
    else if (phase === 'hold') { if (dt > T_HOLD) { phase = 'out'; t0 = now; } }
    else { p = 1 - Math.min(1, dt / T_OUT); if (dt > T_OUT) { go(idx + 1); return; } }
  }
  pose(main, ASSETS[idx], now);
  draw(main, p);
  busts.forEach((v, i) => { if (v.model) { pose(v, BUSTS[i], now, i * 2.1); draw(v, 1); } });
}

new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
document.addEventListener('visibilitychange', () => { running = !document.hidden; });
go(0); requestAnimationFrame(frame);
