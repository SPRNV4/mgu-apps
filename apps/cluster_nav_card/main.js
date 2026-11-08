'use strict';
/**
 * Cluster Nav Card - a turn card over the phone's map in the instrument cluster, in the style of a navigation app's:
 * the next manoeuvre's arrow, the distance to it, the road (its number in a chip, its name) and the lanes.
 *
 *   card.js     draws the card (any size, GPU recorder or software canvas)
 *   source.js   the guidance: a demo drive, or the live one: headunit.js (the navigation's guidance, CarPlay's
 *               included), then /dev/shm/nav-card/guidance.json from any other program
 *   overlay.js  the card's layer in the cluster, over the map Waze on cluster shows there
 *
 * The app's page shows the card as it is now, larger, and what each part found.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const C = require('./card');
const { startSource } = require('./source');
const { startOverlay } = require('./overlay');

const W = 1600, H = 520;

/**
 * cv seen as a w x h canvas at (ox, oy), scaled by k: card.draw draws into it as into its own canvas.
 * clear() draws nothing (the page is under it).
 */
function view(cv, ox, oy, k, w, h) {
    const X = (x) => ox + x * k, Y = (y) => oy + y * k, P = (p) => [X(p[0]), Y(p[1])];
    return {
        w, h, clear() { return this; },
        roundRect: (x, y, ww, hh, r, c) => cv.roundRect(X(x), Y(y), ww * k, hh * k, r * k, c),
        fillRect: (x, y, ww, hh, c) => cv.fillRect(X(x), Y(y), ww * k, hh * k, c),
        arc: (cx, cy, r0, r1, a0, a1, c, o) => cv.arc(X(cx), Y(cy), r0 * k, r1 * k, a0, a1, c, o),
        circle: (cx, cy, r, c) => cv.circle(X(cx), Y(cy), r * k, c),
        line: (xa, ya, xb, yb, wd, c) => cv.line(X(xa), Y(ya), X(xb), Y(yb), wd * k, c),
        polyline: (pts, wd, c) => cv.polyline(pts.map(P), wd * k, c),
        quad: (pts, c) => cv.quad(pts.map(P), c),
        text: (s, x, y, size, c, o) => cv.text(s, X(x), Y(y), size * k, c, o) / k,
        textWidth: (s, size, o) => cv.textWidth(s, size * k, o) / k,
    };
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const source = startSource(ctx);
        const overlay = startOverlay(ctx, () => source.now());

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            G.frame(cv, t, ['Cluster Nav Card'], 0, [source.kind() === 'demo' ? { text: 'DEMO' } : null]);
            G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
            const g = source.now(), units = settings.get('units'), region = settings.get('shields') || 'nl';
            // the card as the cluster shows it, 1.5 times larger
            // with the navigation's event list behind it: the card at its own size on the left, the events on the right
            const evs = g && source.events ? source.events() : [];
            const k = evs.length ? 1 : 1.5, ch = g && C.hasLanes(g) ? C.BASE_H : C.ROW_H, cw = g && settings.get('width') === 'fit' ? C.measure(cv, g, ch, { units, region, maxW: C.size(ch, g) }) : C.size(ch, g || {});
            const ox = evs.length ? 64 : Math.round(W / 2 - cw * k / 2), oy = G.TOP + 34;
            if (g) {
                C.draw(view(cv, ox, oy, k, cw, ch), g, { units, region });
                evs.slice(0, 10).forEach((ln, i) => cv.text(ln.slice(0, 120), Math.max(ox + cw + 40, 700), oy + 14 + i * 21, 15, i ? t.text : t.dim, { font: 'label' }));
            }
            else if (source.diag) {
                // no route: what came from the car instead, to see why
                cv.roundRect(48, oy - 14, W - 96, C.BASE_H * k + 20, 16, G.withAlpha('#ffffff', 0.05));
                cv.text('No route now. From the car:', 72, oy + 16, 22, t.dim, { font: 'bold' });
                // as many lines as the box holds (its bottom is the status rows' top)
                const lines = source.diag(), boxH = C.BASE_H * k + 20, lh = lines.length > 10 ? 19 : 25, sz = lines.length > 10 ? 14 : 17;
                const fit = Math.max(1, Math.floor((boxH - 44 - 6) / lh));
                const shown = lines.length > fit ? lines.slice(0, fit - 1).concat(['... ' + (lines.length - fit + 1) + ' more (the event log has them all)']) : lines;
                shown.forEach((ln, i) => cv.text(ln.slice(0, 190), 72, oy + 44 + i * lh, sz, t.text, { font: 'label' }));
            } else {
                cv.roundRect(ox, oy, cw * k, ch * k, 20 * k, G.withAlpha('#ffffff', 0.05));
                cv.text('No route now', W / 2, oy + ch * k / 2 + 10, 30, t.dim, { align: 'center', font: 'bold' });
            }
            // what each part found
            const ov = overlay.status(), src = source.status();
            const rows = [
                ['Guidance', src.source === 'demo' ? 'Demo drive (Settings > Demo route)'
                    : src.fileActive ? 'Guidance file: ' + src.file : 'Navigation: ' + src.car],
                ['Map in the cluster', ov.map + (settings.get('show') === 'off' ? '   ·   card switched off in Settings' : '')],
                ['Cluster renderer', ov.renderer + (ov.shown ? '   ·   the card is on the cluster' : '')],
                ['Event log', source.logStatus() || 'only with the car\'s guidance (demo off)'],
                ['Traffic side', (() => { const ts = source.trafficSide(); return ts ? (ts.side === 'LEFT' ? 'left-hand' : 'right-hand') + ' (' + ts.from + ')   ·   a roundabout\'s own from the navigation comes first' : 'with the car\'s guidance only'; })()],
            ];
            const y0 = oy + C.BASE_H * k + 44;
            rows.forEach(([a, b], i) => {
                cv.text(a, 64, y0 + i * 34, 20, t.dim, { font: 'bold' });
                cv.text(b, 330, y0 + i * 34, 20, t.text, { font: 'label' });
            });
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 10, render);
        settings.onChange(() => overlay.tick());
        await render();
        log.info('cluster_nav_card ready (guidance ' + source.kind() + ')');
    },
});

module.exports = { view };
