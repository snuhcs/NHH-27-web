// Subtle parallax: orbs drift toward the pointer at different depths.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const orbs = [...document.querySelectorAll('.orb')];
  addEventListener('pointermove', e => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    orbs.forEach((o, i) => {
      const d = (i + 1) * 14;
      o.style.transform = `translate(${x * d}px, ${y * d}px)`;
    });
  });
}
