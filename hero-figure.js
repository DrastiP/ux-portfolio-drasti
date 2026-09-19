/* ============================================================
   Hero dot matrix
   ------------------------------------------------------------
   A background grid of dots across the top-right of the hero.
   The cursor pushes nearby dots away, swells them and warms them
   from muted toward the signal colour.

   The grid is generated rather than masked, so one weight per dot
   drives BOTH how visible it is and how strongly it reacts:

     - left half        weight 0  -> no dots, no interaction
     - top-right        weight 1  -> full visibility, full response
     - toward bottom    weight decays with depth on the 225deg axis

   Dots that would land on type or nav are dropped outright, with a
   clear buffer around each text box, so nothing ever sits behind a
   word.

   Deliberately conservative — it is decoration, so it must never
   cost anything it does not earn:
   - No pointer handling under reduced motion, on touch, or below
     the breakpoint where the whole layer is hidden.
   - One rAF per pointer burst, not one per pointermove event.
   - Only the cells inside the cursor's reach are visited each
     frame (~60 of them), found by arithmetic on the grid index
     rather than by scanning every dot.
   - Per-dot writes are skipped when the value has not changed.

   Colours come from the root custom properties so the design
   tokens stay the single source of truth.
   ============================================================ */

(function () {
    var figure = document.querySelector('.hero-figure');
    if (!figure) return;

    var svg = figure.querySelector('svg');
    var hero = figure.closest ? figure.closest('.hero') : null;
    if (!svg || !hero) return;

    var NS = 'http://www.w3.org/2000/svg';

    /* ---- grid geometry (FR-1) ---- */
    var PITCH = 30;             // uniform X and Y spacing, spec 28-32px
    var R = 1.6;                // 3.2px diameter, over the spec's 2.5 on request
    var BASE_OPACITY = 0.82;    // well above the spec's 0.5, which read too faint

    /* ---- masking (FR-2, FR-3) ---- */
    var LEFT_GATE = 0.50;       // nothing left of the half way line
    var LEFT_RAMP = 0.68;       // ramped in fully by here
    var DIAG_SPAN = 0.95;       // travel along the 225deg axis to zero

    /* ---- type dodging (FR-4) ---- */
    var BUFFER = 20;            // clear margin around text, spec 16-24px
    var EXCLUDE = '.topbar .mark, .topbar .nav a, ' +
                  '.hero .eyebrow, .hero h1, .hero .sub';

    /* ---- interaction ---- */
    var REACH = 175;            // px the cursor reaches
    var PUSH = 28;              // px a dot moves at full strength
    var SWELL = 3.4;            // extra scale at full strength
    var HEAT = 1.4;             // how fast the colour runs to the signal

    /* ---- ambient drift ---- */
    var DRIFT_MIN = 3.6;        // seconds for the fastest dot's cycle
    var DRIFT_MAX = 8.5;        // seconds for the slowest
    var DRIFT_FLOOR = 0.22;     // dots fainter than this stay still

    /* ---- ambient colour ---- */
    var ACCENT_RATE = 0.10;     // share of dots that carry the signal at rest
    var ACCENT_HEAT = 0.85;     // how far toward the signal they sit
    var PULSE_MIN = 5;          // seconds for the fastest accent's breath
    var PULSE_MAX = 13;         // seconds for the slowest

    function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
    function smoothstep(a, b, x) {
        var t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
    }

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

    /* ---- build ---- */

    var dots = [];        // every rendered dot
    var index = [];       // cols x rows lookup, holes where a dot was dropped
    var nx = 0, ny = 0, ox = 0, oy = 0;
    var built = false;

    // A block element's box is as wide as its column, not as wide as the
    // words in it -- the eyebrow is ~140px of type in a 960px box, and the
    // headline is ragged inside a solid rectangle. Reserving those boxes
    // punched big empty patches in the field. Range rects give one tightly
    // fitted rect per rendered line instead, so the gap follows the text.
    function lineRects(el) {
        var rects = [];
        try {
            var range = document.createRange();
            range.selectNodeContents(el);
            var list = range.getClientRects();
            for (var i = 0; i < list.length; i++) {
                if (list[i].width > 0.5 && list[i].height > 0.5) rects.push(list[i]);
            }
        } catch (e) { /* fall through to the element box */ }
        if (!rects.length) {
            var r = el.getBoundingClientRect();
            if (r.width && r.height) rects.push(r);
        }
        return rects;
    }

    function exclusionZones(box) {
        var zones = [];
        var nodes = document.querySelectorAll(EXCLUDE);
        for (var i = 0; i < nodes.length; i++) {
            var rects = lineRects(nodes[i]);
            for (var j = 0; j < rects.length; j++) {
                var r = rects[j];
                zones.push({
                    l: r.left - box.left - BUFFER,
                    t: r.top - box.top - BUFFER,
                    r: r.right - box.left + BUFFER,
                    b: r.bottom - box.top + BUFFER
                });
            }
        }
        return zones;
    }

    function build(animate) {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        dots = [];
        index = [];

        if (getComputedStyle(figure).display === 'none') { built = false; return; }

        // Lift the layer over the topbar so the matrix reads as one field
        // behind the whole masthead, the way the rest of the page is laid out.
        var topbar = document.querySelector('.topbar');
        figure.style.top = topbar
            ? -Math.round(topbar.getBoundingClientRect().height) + 'px'
            : '0px';

        var box = figure.getBoundingClientRect();
        var W = Math.round(box.width), H = Math.round(box.height);
        if (W < PITCH * 2 || H < PITCH * 2) { built = false; return; }

        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

        var zones = exclusionZones(box);

        nx = Math.floor(W / PITCH);
        ny = Math.floor(H / PITCH);
        ox = (W - (nx - 1) * PITCH) / 2;
        oy = (H - (ny - 1) * PITCH) / 2;

        var frag = document.createDocumentFragment();
        var drifts = !(window.matchMedia &&
                       window.matchMedia('(prefers-reduced-motion: reduce)').matches);

        for (var r = 0; r < ny; r++) {
            for (var c = 0; c < nx; c++) {
                index.push(null);

                var x = ox + c * PITCH, y = oy + r * PITCH;
                var u = x / W, v = y / H;

                // FR-3: left half off, ramped in across the middle
                var wx = smoothstep(LEFT_GATE, LEFT_RAMP, u);
                if (wx <= 0) continue;

                // FR-2: fade along the 225deg axis, brightest at top-right
                var along = ((1 - u) + v) / 2;
                var wd = clamp01(1 - along / DIAG_SPAN);

                // Visibility tapers linearly to nothing at the perimeter
                // (FR-2). Reactivity is squared on top, so the field stays
                // legible while the bottom-right still falls out of reach
                // faster than it fades (FR-3).
                var weight = wx * wd;
                var react = weight * wd;
                if (weight < 0.03) continue;

                // FR-4: never render on top of type
                var blocked = false;
                for (var z = 0; z < zones.length; z++) {
                    var zn = zones[z];
                    if (x >= zn.l && x <= zn.r && y >= zn.t && y <= zn.b) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) continue;

                var base = BASE_OPACITY * weight;
                var el = document.createElementNS(NS, 'circle');
                el.setAttribute('cx', x.toFixed(1));
                el.setAttribute('cy', y.toFixed(1));
                el.setAttribute('r', R);
                el.style.opacity = base.toFixed(3);
                if (animate) {
                    // diagonal wipe in, leading from the top right
                    el.style.animationDelay = ((nx - 1 - c) + r) * 12 + 'ms';
                } else {
                    el.style.animation = 'none';
                }

                // The cursor writes a transform onto the circle, so the
                // never-ending drift rides a wrapper instead. Two transform
                // layers, composed by the tree, neither clobbering the other.
                // A scattered few carry the signal colour at rest and
                // breathe in and out on their own clock, so the field has
                // some warmth in it without the cursor.
                var baseFill = '';
                var accent = tintable && drifts &&
                             weight > DRIFT_FLOOR && Math.random() < ACCENT_RATE;
                if (accent) {
                    baseFill = tint(ACCENT_HEAT);
                    el.style.fill = baseFill;
                }

                var g = document.createElementNS(NS, 'g');
                if (drifts && weight > DRIFT_FLOOR) {
                    g.setAttribute('class', accent ? 'drift accent' : 'drift');
                    // Each dot gets its own period, so the field never
                    // pulses in unison, and a negative delay drops it in
                    // mid-cycle rather than all starting from rest.
                    var period = DRIFT_MIN + Math.random() * (DRIFT_MAX - DRIFT_MIN);
                    if (accent) {
                        var breath = PULSE_MIN + Math.random() * (PULSE_MAX - PULSE_MIN);
                        g.style.animationDuration = period.toFixed(2) + 's, ' + breath.toFixed(2) + 's';
                        g.style.animationDelay = (-Math.random() * period).toFixed(2) + 's, ' +
                                                 (-Math.random() * breath).toFixed(2) + 's';
                    } else {
                        g.style.animationDuration = period.toFixed(2) + 's';
                        g.style.animationDelay = (-Math.random() * period).toFixed(2) + 's';
                    }
                    // fainter dots drift less, so the motion fades out with them
                    g.style.setProperty('--amp', (0.55 + weight * 0.75).toFixed(2));
                }
                g.appendChild(el);
                frag.appendChild(g);

                var dot = {
                    el: el, x: x, y: y, react: react, base: base,
                    baseFill: baseFill, tr: '', fill: '', op: '', seen: -1
                };
                index[index.length - 1] = dot;
                dots.push(dot);
            }
        }

        svg.appendChild(frag);
        built = dots.length > 0;
    }

    build(document.documentElement.classList.contains('js-motion'));

    // The exclusion zones are measured off the type, and the type MOVES:
    // swapping in a webfont shifted the headline 12px up here, which left
    // the grid holed where the text used to be and dotted where it now is.
    // document.fonts.ready is not enough on its own -- it can resolve
    // before the new metrics have settled into layout, and it never fires
    // at all for a font that fails to load. So watch the boxes themselves
    // and rebuild whenever any of them actually changes size.
    var rebuildTimer = null;
    function scheduleRebuild(delay) {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(function () {
            rebuildTimer = null;
            touched = [];
            build(false);
        }, delay || 120);
    }

    if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () { scheduleRebuild(90); });
        var watched = document.querySelectorAll('.hero, .hero h1, .hero .sub, .hero .eyebrow, .topbar');
        for (var wi = 0; wi < watched.length; wi++) ro.observe(watched[wi]);
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { scheduleRebuild(60); })
                           .catch(function () {});
    }

    // Belt and braces for anything the observer cannot see -- a font that
    // swaps without changing the box height, a late stylesheet.
    window.addEventListener('load', function () { scheduleRebuild(150); });

    window.addEventListener('resize', function () { scheduleRebuild(120); }, { passive: true });

    /* ---- interaction ---- */

    var mq = window.matchMedia;
    var reduced = mq && mq('(prefers-reduced-motion: reduce)').matches;
    var fine = mq ? mq('(hover: hover) and (pointer: fine)').matches : false;
    if (reduced || !fine) return;

    var touched = [];
    var frameId = 0;
    var queued = false;
    var settleTimer = null;
    var inside = false;
    var px = 0, py = 0;

    function reset(d) {
        if (d.tr) { d.el.style.transform = ''; d.tr = ''; }
        if (d.fill) { d.el.style.fill = d.baseFill; d.fill = ''; }
        if (d.op) { d.el.style.opacity = d.base.toFixed(3); d.op = ''; }
    }

    function clearAll() {
        for (var i = 0; i < touched.length; i++) reset(touched[i]);
        touched = [];
    }

    function apply(mx, my) {
        frameId++;
        var next = [];

        // Only the cells the cursor can actually reach are visited.
        var c0 = Math.max(0, Math.ceil((mx - REACH - ox) / PITCH));
        var c1 = Math.min(nx - 1, Math.floor((mx + REACH - ox) / PITCH));
        var r0 = Math.max(0, Math.ceil((my - REACH - oy) / PITCH));
        var r1 = Math.min(ny - 1, Math.floor((my + REACH - oy) / PITCH));

        for (var r = r0; r <= r1; r++) {
            for (var c = c0; c <= c1; c++) {
                var d = index[r * nx + c];
                if (!d) continue;

                var dx = d.x - mx, dy = d.y - my;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= REACH) continue;

                // Smoothstep rather than a raw ramp: the falloff holds its
                // strength across the middle of the radius and eases off at
                // the rim, so the whole bulge reads instead of only the dot
                // under the cursor.
                var nd = 1 - dist / REACH;
                var f = nd * nd * (3 - 2 * nd);

                // AC-3: the same weight that sets visibility damps the
                // response, so the bottom-right fades out of reach too.
                var near = f * d.react;
                if (near < 0.004) continue;

                var unit = dist || 1;

                var tr = 'translate(' + (dx / unit * near * PUSH).toFixed(2) + 'px,' +
                                        (dy / unit * near * PUSH).toFixed(2) + 'px) ' +
                         'scale(' + (1 + near * SWELL).toFixed(3) + ')';
                if (tr !== d.tr) { d.el.style.transform = tr; d.tr = tr; }

                var op = (d.base + (1 - d.base) * near).toFixed(3);
                if (op !== d.op) { d.el.style.opacity = op; d.op = op; }

                if (tintable) {
                    var fill = tint(near > 1 / HEAT ? 1 : near * HEAT);
                    if (fill !== d.fill) { d.el.style.fill = fill; d.fill = fill; }
                }

                d.seen = frameId;
                next.push(d);
            }
        }

        for (var i = 0; i < touched.length; i++) {
            if (touched[i].seen !== frameId) reset(touched[i]);
        }
        touched = next;
    }

    function frame() {
        queued = false;
        if (!built) return;
        var box = figure.getBoundingClientRect();
        apply(px - box.left, py - box.top);
    }

    function leave() {
        if (!inside) return;
        inside = false;
        figure.classList.add('is-settling');
        clearAll();
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
            figure.classList.remove('is-settling');
            settleTimer = null;
        }, 500);
    }

    // The layer is pointer-events: none so it can never intercept a click,
    // which also means it cannot receive the pointer itself. Watch the
    // document and decide by geometry instead.
    document.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' || !built) return;

        var box = figure.getBoundingClientRect();
        var within = e.clientX >= box.left - REACH && e.clientX <= box.right + REACH &&
                     e.clientY >= box.top - REACH && e.clientY <= box.bottom + REACH;

        if (!within) { leave(); return; }

        if (!inside) {
            inside = true;
            figure.classList.remove('is-settling');
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        }

        px = e.clientX;
        py = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(frame);
    }, { passive: true });

    document.addEventListener('pointerleave', leave, { passive: true });
    window.addEventListener('blur', leave, { passive: true });
})();
