const STAGE_ASSETS = window.STAGE_ASSETS || [
  { src: "models/phone.glb", poster: "models/phone.webp", label: "Mobile & IoT Computing" },
  { src: "models/xr.glb",    poster: "models/xr.webp",    label: "XR & Spatial Computing" },
  { src: "models/chip.glb",  poster: "models/chip.webp",  label: "On-Device AI" },
  { src: "models/watch.glb", poster: "models/watch.webp", label: "Care & Health Computing" },
  { src: "models/agent.glb", poster: "models/agent.webp", label: "Human-Centered AI Agents" },
];

(() => {
  const root = document.getElementById("stage");
  if (!root) return;
  const INTERVAL = 4500;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const mv = document.createElement("script");
  mv.type = "module";
  mv.src = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
  document.head.appendChild(mv);

  root.innerHTML = `
    <span class="stage__blob stage__blob--blue"></span>
    <span class="stage__blob stage__blob--pink"></span>
    <div class="stage__card">
      <div class="stage__pill">
        <span class="stage__label" aria-live="polite"></span>
        <div class="stage__dots"></div>
      </div>
    </div>`;
  const card = root.querySelector(".stage__card");
  const label = root.querySelector(".stage__label");
  const dotsEl = root.querySelector(".stage__dots");
  const dots = STAGE_ASSETS.map((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stage__dot";
    b.setAttribute("aria-label", `${i + 1}. ${a.label}`);
    b.addEventListener("click", () => { show(i); restart(); });
    dotsEl.appendChild(b);
    return b;
  });

  // Two layers: the active one and a hidden one preloading the next item.
  const makeLayer = () => {
    const layer = document.createElement("div");
    layer.className = "stage__layer";
    layer.innerHTML = `<div class="stage__float"><img class="stage__img" alt="" decoding="async"><model-viewer
      environment-image="neutral" shadow-intensity="0.6" interaction-prompt="none" disable-zoom disable-pan
      loading="eager" ${reduced ? "" : 'auto-rotate rotation-per-second="18deg" auto-rotate-delay="0"'}></model-viewer></div>`;
    const img = layer.querySelector("img");
    const viewer = layer.querySelector("model-viewer");
    img.addEventListener("error", () => img.hidden = true);  // no PNG either: label only
    viewer.addEventListener("load", () => layer.classList.add("is-loaded"));
    viewer.addEventListener("error", () => layer.classList.remove("is-loaded"));  // GLB failed: PNG stays
    card.prepend(layer);
    return { layer, img, viewer, idx: -1 };
  };
  const layers = [makeLayer(), makeLayer()];

  const load = (L, i) => {
    if (L.idx === i) return;
    const a = STAGE_ASSETS[i];
    L.idx = i;
    L.layer.classList.remove("is-loaded");
    L.img.hidden = !a.poster;
    if (a.poster) L.img.src = a.poster; else L.img.removeAttribute("src");
    L.viewer.setAttribute("alt", a.label);
    L.viewer.src = a.src;
  };

  let cur = -1, active = 0;
  function show(i) {
    if (i === cur) return;
    const next = layers[1 - active];
    load(next, i);
    active = layers.indexOf(next);
    layers.forEach(L => L.layer.classList.toggle("is-active", L === next));
    const back = layers[1 - active];
    cur = i;
    label.textContent = STAGE_ASSETS[i].label;
    dots.forEach((d, j) => d.setAttribute("aria-current", j === i));
    // Preload the following item into the hidden layer once the fade is done.
    setTimeout(() => { if (cur === i) load(back, (i + 1) % STAGE_ASSETS.length); }, 1000);
  }

  let timer = 0, visible = true;
  function restart() {
    clearInterval(timer);
    const run = !reduced && visible && !document.hidden && STAGE_ASSETS.length > 1;
    root.classList.toggle("is-paused", !run);
    if (run) timer = setInterval(() => show((cur + 1) % STAGE_ASSETS.length), INTERVAL);
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; restart(); }).observe(root);
  document.addEventListener("visibilitychange", restart);

  show(0);
  restart();
})();
