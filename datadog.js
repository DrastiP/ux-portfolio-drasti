/* ============================================================
   Datadog Browser RUM
   ------------------------------------------------------------
   Fill in APPLICATION_ID and CLIENT_TOKEN from:
   Datadog → Digital Experience → Manage Applications → your app

   Both values are PUBLIC by design — the Datadog browser SDK ships
   them in client-side JavaScript, so they are safe in this repo.
   Never put a Datadog API key here; that one is secret.

   Until both are filled in, this file does nothing at all: no
   network request, no console errors.
   ============================================================ */

(function () {
    var APPLICATION_ID = '4798de20-e6ea-4776-84fb-9ac89a330e13';
    var CLIENT_TOKEN   = 'pub10774b9fc75f06c1871cf29490b3cd46';

    // US1 (app.datadoghq.com). For another region change both of these
    // together — e.g. EU1 is 'datadoghq.eu' with a /eu1/ SDK path.
    var SITE    = 'datadoghq.com';
    var SDK_URL = 'https://www.datadoghq-browser-agent.com/us1/v6/datadog-rum.js';

    // Stay dormant until the real values are in place.
    if (APPLICATION_ID.indexOf('REPLACE_WITH') === 0 ||
        CLIENT_TOKEN.indexOf('REPLACE_WITH') === 0) {
        return;
    }

    (function (h, o, u, n, d) {
        h = h[d] = h[d] || { q: [], onReady: function (c) { h.q.push(c); } };
        d = o.createElement(u); d.async = 1; d.src = n;
        n = o.getElementsByTagName(u)[0]; n.parentNode.insertBefore(d, n);
    })(window, document, 'script', SDK_URL, 'DD_RUM');

    window.DD_RUM.onReady(function () {
        window.DD_RUM.init({
            applicationId: APPLICATION_ID,
            clientToken: CLIENT_TOKEN,
            site: SITE,
            service: 'drastiux-portfolio',
            env: 'prod',

            // A portfolio gets low traffic, so keep every session.
            sessionSampleRate: 100,

            // Session Replay records the screen. Off by default because it
            // carries the heaviest privacy obligations; raise to 20 if you
            // want it and are comfortable with that.
            sessionReplaySampleRate: 0,

            trackResources: true,
            trackLongTasks: true,
            trackUserInteractions: true,
            defaultPrivacyLevel: 'mask-user-input'
        });
    });
})();
