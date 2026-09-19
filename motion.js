/* ============================================================
   Reveal-on-scroll
   ------------------------------------------------------------
   Adds .js-motion to <html> synchronously, so the CSS can hide
   reveal targets before first paint and there is no flash of
   content appearing then disappearing.

   Deliberately conservative — content must never be stuck hidden:
   - Does nothing without IntersectionObserver.
   - Does nothing when the visitor asks for reduced motion.
   - An IntersectionObserver drives the normal case, and a
     rAF-throttled scroll sweep catches anything it misses when
     the viewport jumps (scrollbar drag, Cmd+End, anchor link),
     where observer callbacks get coalesced.
   - A failsafe reveals everything after 2s regardless.

   Only blocks are revealed — headings, figures, decision tables,
   stats. Body copy is left alone, because text that fades in as
   you reach it is tiring to read.
   ============================================================ */

(function () {
    var reduced = window.matchMedia &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !('IntersectionObserver' in window) || !document.documentElement) {
        return;
    }

    document.documentElement.classList.add('js-motion');

    var SELECTORS = [
        // home
        '.slabel', '.big', '.minor',
        // case study blocks
        '.cs-meta', '.cs-pao > div', '.cs-proof',
        '.cs-sec > .cs-eyebrow', '.cs-sec > h2',
        '.cs-stat', '.cs-reveal', '.cs-method', '.cs-pull',
        '.cs-list li', '.cs-spec', '.cs-decision', '.cs-explore',
        '.cs-doc figure', '.cs-close', '.cs-todo', '.cs-next',
        // about
        '.about-heading', '.about-intro', '.about-sec'
    ].join(',');

    function start() {
        var nodes;
        try {
            nodes = Array.prototype.slice.call(document.querySelectorAll(SELECTORS));
        } catch (e) {
            document.documentElement.classList.remove('js-motion');
            return;
        }
        if (!nodes.length) return;

        var pending = nodes.length;

        function reveal(el, delay) {
            if (el.classList.contains('is-in')) return;
            if (delay) el.style.setProperty('--reveal-delay', delay + 'ms');
            el.classList.add('is-in');
            pending--;
            if (pending <= 0) teardown();
        }

        // Stagger siblings slightly so a row of cards arrives in sequence.
        function staggerFor(el) {
            var parent = el.parentNode;
            if (!parent) return 0;
            var sibs = Array.prototype.filter.call(parent.children, function (c) {
                return c.classList && c.classList.contains('will-reveal');
            });
            var i = sibs.indexOf(el);
            if (i > 0 && sibs.length > 1 && sibs.length <= 6) return Math.min(i, 4) * 70;
            return 0;
        }

        nodes.forEach(function (el) { el.classList.add('will-reveal'); });

        // Anything already on the first screen is revealed straight away, so
        // the page never sits waiting for a scroll that may not come.
        var sweepQueued = false;
        function sweep() {
            sweepQueued = false;
            var fold = window.innerHeight * 0.92;
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (el.classList.contains('is-in')) continue;
                if (el.getBoundingClientRect().top < fold) reveal(el, staggerFor(el));
            }
        }
        function queueSweep() {
            if (sweepQueued) return;
            sweepQueued = true;
            requestAnimationFrame(sweep);
        }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) reveal(entry.target, staggerFor(entry.target));
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

        nodes.forEach(function (el) { observer.observe(el); });

        window.addEventListener('scroll', queueSweep, { passive: true });
        window.addEventListener('resize', queueSweep, { passive: true });

        var failsafe = setTimeout(function () {
            nodes.forEach(function (el) { reveal(el, 0); });
        }, 2000);

        function teardown() {
            clearTimeout(failsafe);
            observer.disconnect();
            window.removeEventListener('scroll', queueSweep);
            window.removeEventListener('resize', queueSweep);
        }

        sweep();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
