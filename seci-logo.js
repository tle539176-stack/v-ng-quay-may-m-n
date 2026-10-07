// Built-in SECI logo, drawn as five layers: the core knot plus the four
// points. At rest they line up exactly like the printed banner; seci-logo.css
// only ever moves the points outward and back, so nothing appears from nowhere.
// Same geometry as assets/logo/seci-logo.svg.
(function () {
  const CORE = 'M-465 -279 -279 -279 -279 -465 279 -465 279 -279 465 -279 465 279 279 279 279 465 -279 465 -279 279 -465 279Z'
    + 'M-377 -191 -377 -44 -141 -44 -141 44 -377 44 -377 191 -279 191 -279 103 -191 103 -191 191 -103 191 -103 279 -191 279 -191 377 -44 377 -44 141 44 141 44 377 191 377 191 279 103 279 103 191 191 191 191 103 279 103 279 191 377 191 377 44 141 44 141 -44 377 -44 377 -191 279 -191 279 -103 191 -103 191 -191 103 -191 103 -279 191 -279 191 -377 44 -377 44 -141 -44 -141 -44 -377 -191 -377 -191 -279 -103 -279 -103 -191 -191 -191 -191 -103 -279 -103 -279 -191Z';

  // The grid is turned 45°, so each corner square of the grid becomes a point.
  const point = (side, x, y) =>
    `<g class="seci-logo-point" data-side="${side}"><rect transform="rotate(45)" x="${x}" y="${y}" width="116" height="116"/></g>`;

  // The viewBox leaves room around the points so they can travel without
  // being clipped by the tile that holds the logo.
  const MARKUP = '<svg class="seci-logo" viewBox="-740 -740 1480 1480" aria-hidden="true" focusable="false">'
    + `<g class="seci-logo-core"><path transform="rotate(45)" d="${CORE}"/></g>`
    + point('top', -465, -465)
    + point('right', 349, -465)
    + point('bottom', 349, 349)
    + point('left', -465, 349)
    + '</svg>';

  function mount(root) {
    (root || document).querySelectorAll('[data-seci-logo]').forEach(host => {
      if (!host.querySelector('.seci-logo')) host.innerHTML = MARKUP;
    });
  }

  window.SeciLogo = { markup: MARKUP, mount };
  mount();
})();
