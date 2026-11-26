// Laboratorio del difuminado superior de iOS (temporal). Rellena la página y enseña los datos que importan.
(() => {
  const scroller = document.querySelector('.lab-scroll');
  const colors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= 60; i++) {
    const row = document.createElement('div');
    row.className = 'lab-row';
    row.innerHTML = `<i style="background:${colors[i % colors.length]}"></i><div><b>Fila ${i} · Texto nítido ABCabc 123</b><small>LETRA PEQUEÑA PARA VER EL DIFUMINADO · 0,25 € · +3,14 %</small></div>`;
    frag.appendChild(row);
  }
  scroller.appendChild(frag);

  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;height:env(safe-area-inset-top)';
  document.body.appendChild(probe);

  const diag = document.querySelector('.lab-diag');
  const show = () => {
    const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const ios = (navigator.userAgent.match(/OS (\d+)_(\d+)(?:_(\d+))?/) || []).slice(1).filter(Boolean).join('.');
    const hit = document.elementFromPoint(innerWidth / 2, 4);
    let fixed = null;
    for (let el = hit; el; el = el.parentElement) {
      const p = getComputedStyle(el).position;
      if (p === 'fixed' || p === 'sticky') { fixed = `${el.tagName.toLowerCase()}.${el.className} (${p})`; break; }
    }
    diag.textContent = [
      `Variante: ${document.documentElement.dataset.variant}`,
      `Instalada (standalone): ${standalone ? 'sí' : 'NO — ábrela desde el icono'}`,
      `status-bar-style: ${meta ? meta.content : '(sin meta = default)'}`,
      `safe-area-inset-top: ${probe.getBoundingClientRect().height}px`,
      `innerHeight ${innerHeight} · screen ${screen.height}`,
      `Fijo bajo el borde superior: ${fixed || 'ninguno'}`,
      `iOS ${ios || '?'}`,
    ].join('\n');
  };
  show();
  addEventListener('resize', show);
  addEventListener('scroll', show, { passive: true });
  scroller.addEventListener('scroll', show, { passive: true });
  addEventListener('orientationchange', show);
})();
