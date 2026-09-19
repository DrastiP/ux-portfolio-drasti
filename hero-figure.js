/* ============================================================
   Hero dot field
   ------------------------------------------------------------
   Builds the 9x9 grid inside .hero-figure and pushes dots away
   from the cursor, swelling them and warming them toward the
   signal colour as it gets close.

   Deliberately conservative — it is decoration, so it must never
   cost anything it does not earn:
   - The grid is built in JS, so the markup stays a single empty
     <svg> instead of 81 hand-written circles.
   - No pointer handling at all under reduced motion, on touch,
     or below the breakpoint where the figure is hidden anyway.
   - One rAF per pointer burst, not one per pointermove event.
   - Per-dot writes are skipped when the value has not changed,
     which is most dots on most frames.

   Colours are read off the root custom properties so the design
   tokens stay the single source of truth.
   ============================================================ */

(function () {
    var figure = document.querySelector('.hero-figure');
    if (!figure) return;

    var svg = figure.querySelector('svg');
    if (!svg) return;

    var NS = 'http://www.w3.org/2000/svg';
    var COLS = 9, ROWS = 9;
    var ORIGIN = 60, STEP = 35;   // 60..340 across a 400 viewBox
    var R = 2.5;                  // resting radius
    var REACH = 150;              // viewBox units the cursor reaches
    var PUSH = 26;                // units a dot moves at full strength
    var SWELL = 1;                // extra scale at full strength
    var REST_OPACITY = 0.5;       // must match .hero-figure circle in styles.css

    /* ---- colours, straight off the tokens ---- */

    function parseColor(value) {
        value = (value || '').trim();
        var m = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (m) {
            var h = m[1];
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            return [parseInt(h.slice(0, 2), 16),
                    parseInt(h.slice(2, 4), 16),
                    parseInt(h.slice(4, 6), 16)];
        }
        m = value.match(/^rgba?\(([^)]+)\)$/i);
        if (m) {
            var parts = m[1].split(/[,\s/]+/).slice(0, 3).map(Number);
            if (parts.length === 3 && parts.every(isFinite)) return parts;
        }
        return null;
    }

    var root = getComputedStyle(document.documentElement);
    var REST = parseColor(root.getPropertyValue('--muted'));
    var HOT = parseColor(root.getPropertyValue('--signal'));
    var tintable = !!(REST && HOT);

    function tint(f) {
        return 'rgb(' +
            Math.round(REST[0] + (HOT[0] - REST[0]) * f) + ',' +
            Math.round(REST[1] + (HOT[1] - REST[1]) * f) + ',' +
            Math.round(REST[2] + (HOT[2] - REST[2]) * f) + ')';
    }

    /* ---- build the grid ---- */

    var staggered = document.documentElement.classList.contains('js-motion');
    var STAGGER = 26, ENTRANCE = 500;
    var dots = [];

    if (staggered) figure.classList.add('is-entering');

    for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
            var el = document.createElementNS(NS, 'circle');
            var x = ORIGIN + c * STEP;
            var y = ORIGIN + r * STEP;
            el.setAttribute('cx', x);
            el.setAttribute('cy', y);
            el.setAttribute('r', R);
            // a diagonal wipe in, top-left first
            if (staggered) el.style.animationDelay = (r + c) * STAGGER + 'ms';
            svg.appendChild(el);
            dots.push({ el: el, x: x, y: y, transform: '', fill: '', opacity: '' });
        }
    }

    if (staggered) {
        setTimeout(function () {
            figure.classList.remove('is-entering');
            for (var i = 0; i < dots.length; i++) dots[i].el.style.animationDelay = '';
        }, (COLS - 1 + ROWS - 1) * STAGGER + ENTRANCE + 120);
    }

    /* ---- interaction ---- */

    var mq = window.matchMedia;
    var reduced = mq && mq('(prefers-reduced-motion: reduce)').matches;
    var fine = mq ? mq('(hover: hover) and (pointer: fine)').matches : false;
    if (reduced || !fine) return;

    // The figure sits behind the type (z-index: -1) so it can never steal a
    // click, which also means it cannot reliably receive the pointer itself.
    // Listen on the hero and measure against the figure's own box.
    var hero = figure.closest ? figure.closest('.hero') : null;
    if (!hero) return;

    var settleTimer = null;
    var queued = false;
    var px = 0, py = 0;

    function apply(mx, my) {
        for (var i = 0; i < dots.length; i++) {
            var d = dots[i];
            var dx = d.x - mx, dy = d.y - my;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var near = dist < REACH ? 1 - dist / REACH : 0;

            // Displacement falls off fast so the bulge stays tight and local;
            // colour and opacity ride the linear falloff so the red is
            // actually visible on the way in, not just under the cursor.
            var f = near * near;

            var transform = '';
            if (f > 0.002) {
                var unit = dist || 1;
                transform = 'translate(' + (dx / unit * f * PUSH).toFixed(2) + 'px,' +
                                           (dy / unit * f * PUSH).toFixed(2) + 'px) ' +
                            'scale(' + (1 + f * SWELL).toFixed(3) + ')';
            }
            if (transform !== d.transform) {
                d.el.style.transform = transform;
                d.transform = transform;
            }

            var opacity = near > 0.004 ? (REST_OPACITY + (1 - REST_OPACITY) * near).toFixed(3) : '';
            if (opacity !== d.opacity) {
                d.el.style.opacity = opacity;
                d.opacity = opacity;
            }

            if (tintable) {
                var fill = near > 0.004 ? tint(near) : '';
                if (fill !== d.fill) {
                    d.el.style.fill = fill;
                    d.fill = fill;
                }
            }
        }
    }

    function frame() {
        queued = false;
        var box = figure.getBoundingClientRect();
        if (!box.width || !box.height) return;
        apply((px - box.left) / box.width * 400,
              (py - box.top) / box.height * 400);
    }

    hero.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        px = e.clientX;
        py = e.clientY;
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        figure.classList.remove('is-settling');
        if (queued) return;
        queued = true;
        requestAnimationFrame(frame);
    }, { passive: true });

    hero.addEventListener('pointerleave', function () {
        figure.classList.add('is-settling');
        apply(-9999, -9999);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
            figure.classList.remove('is-settling');
            settleTimer = null;
        }, 500);
    }, { passive: true });
})();
