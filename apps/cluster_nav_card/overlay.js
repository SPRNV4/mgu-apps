'use strict';
/**
 * overlay.js - Cluster Nav Card's card over the phone's map in the instrument cluster.
 *
 * Needs, on the head unit, from eroobeeroo/idrive-apps (MGU Store): Waze on cluster, which puts the
 * CarPlay / Android Auto map (Waze, Google Maps, Apple Maps) in the cluster and says so in
 * /run/waze-on-cluster/status.json ({ state, target }); and the cluster render service
 * (/dev/shm/cluster-render/render.sock), which takes an app's image layers for the cluster.
 * cluster_render_client.js is its Node client (MPL-2.0, robertnisipeanu/idrive-apps).
 * Without them the card never shows and the app's page says what is missing.
 *
 * The card's layer is made hidden and shown only while the map shows in the cluster and there is guidance
 * (a route), so it never holds the cluster on its own. One layer the size of the tallest card (with lanes):
 * a card without lanes is drawn at its top, the rest transparent, so the layer is not made again as the
 * lanes come and go. Redrawn at most UPDATE_MS apart; only the rows that changed are sent.
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./kit/canvas');
const C = require('./card');

const STATUS = process.env.WOC_STATUS || '/run/waze-on-cluster/status.json';
const UPDATE_MS = 200;
const POLL_MS = 1000;
const MAP_TEX = [1088, 480];                                 // the phone map's picture
const SCENES = { map: [1088, 480], panel: [1920, 720] };     // the cluster's targets (the HUD is not one of Cluster Nav Card's)
const MARGIN = 24;
const SIZES = { small: 100, normal: 118, large: 140 };
// the card's top over the map's, by the "vpos" setting: under the cluster's model badge (default), at the very top,
// or low enough for BMW's own turn box above it
const TOPS = { badge: 84, top: 24, low: 176 };       // the card's height with lanes, by the "size" setting

/** The map's rectangle on a cluster target: its picture fitted and centred, or null. */
function mapRect(target) {
    const sc = SCENES[target];
    if (!sc) return null;
    const k = Math.min(sc[0] / MAP_TEX[0], sc[1] / MAP_TEX[1], 1);
    const w = Math.floor(MAP_TEX[0] * k / 4) * 4, h = Math.floor(MAP_TEX[1] * k / 4) * 4;
    return { x: Math.floor((sc[0] - w) / 2), y: Math.floor((sc[1] - h) / 2), w, h };
}

/** The layer's rectangle: at the top of the map, centred (default), left or right; h high (the card with lanes). */
function cardRect(r, place, h, vpos) {
    const w = Math.min(C.size(h, { lanes: [1] }), (r.w - 2 * MARGIN) & ~3);
    const x = place === 'topRight' ? r.x + r.w - w - MARGIN : place === 'topLeft' ? r.x + MARGIN : r.x + Math.floor((r.w - w) / 8) * 4;
    const top = TOPS[vpos] !== undefined ? TOPS[vpos] : MARGIN;
    return { x, y: r.y + Math.max(0, Math.min(top, r.h - h - MARGIN)), w, h };
}

/** The smallest rectangle where a and b (RGBA, w x h) differ, or null. */
function diffRect(a, b, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function cut(d, w, r) {
    const out = Buffer.alloc(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) out.set(d.subarray(((r.y + y) * w + r.x) * 4, ((r.y + y) * w + r.x + r.w) * 4), y * r.w * 4);
    return out;
}

/**
 * The card for guidance g into the layer canvas cv (w x h): the card at its own height at the top, transparent
 * below. Its width: the layer's, the card's standard width (default), or with fit as wide as its text needs (in
 * steps of 32 px) - centred in the layer, or against its left or right edge for those places.
 */
const cards = new Map();               // card canvases by size, made once
function drawLayer(cv, g, units, place, region, fit) {
    cv.clear([0, 0, 0, 0]);
    if (!g) return;
    const h = C.hasLanes(g) ? cv.h : Math.round(cv.h * C.ROW_H / C.BASE_H);
    const w = fit ? C.measure(cv, g, h, { units, region, maxW: cv.w }) : cv.w, key = w + 'x' + h;
    if (!cards.has(key)) cards.set(key, new Canvas(w, h));
    const card = cards.get(key);
    C.draw(card, g, { units, region });
    cv.blit(card, place === 'topLeft' ? 0 : place === 'topRight' ? cv.w - w : Math.floor((cv.w - w) / 2), 0);
}

/**
 * ctx: settings ("show": off | cluster, "place", "size", "units"), log. guidance(): source.js now().
 * opts (tests): statusPath, ClusterRender, setInterval, clearInterval, now.
 */
function startOverlay(ctx, guidance, opts) {
    opts = opts || {};
    const { settings, log } = ctx;
    const statusPath = opts.statusPath || STATUS, now = opts.now || Date.now;
    let CR = opts.ClusterRender;
    let cr = null, ref = 0, geo = '', cv = null, last = null, visible = false, lastT = 0;
    let map = { showing: false, target: null }, statusText = '', warned = '';
    const warnOnce = (m) => { if (m !== warned) { warned = m; log.warn('overlay: ' + m); } };
    const on = () => settings.get('show') !== 'off';

    function readStatus() {
        fs.readFile(statusPath, 'utf8', (err, txt) => {
            if (err) {
                if (map.showing) log.info('overlay: Waze on cluster status gone');
                map = { showing: false, target: null }; statusText = '';
                return tick();
            }
            if (txt === statusText) return undefined;
            statusText = txt;
            let s;
            try { s = JSON.parse(txt); } catch (e) { return undefined; }
            const tg = String(s.target || '').split('+')[0] || null;
            const next = { showing: s.state === 'showing' && !!SCENES[tg], target: tg };
            if (next.showing !== map.showing || next.target !== map.target) {
                log.info('overlay: map ' + (next.showing ? 'showing on ' + tg : 'not on the cluster (' + (s.state || '?') + (tg ? ', ' + tg : '') + ')'));
            }
            map = next;
            return tick();
        });
    }

    function client() {
        if (cr) return cr;
        if (!CR) {
            try { CR = require('./cluster_render_client').ClusterRender; } catch (e) { warnOnce('no render client: ' + e.message); return null; }
        }
        cr = new CR('cluster_nav_card');
        cr.on('ready', () => { last = null; tick(); });
        cr.on('layer', (r, state, reason) => { if (r === ref && state === 'error') warnOnce('layer: ' + (reason || state)); });
        cr.on('refused', (op, r, reason) => warnOnce(op + ' refused: ' + reason));
        cr.on('error', (e) => warnOnce(String(e && e.message || e)));
        cr.connect();
        return cr;
    }

    function hide() {
        if (cr && ref && visible) cr.set(ref, { visible: false });
        visible = false;
    }

    function layer() {
        const r = mapRect(map.target);
        if (!r) return 0;
        const b = cardRect(r, settings.get('place') || 'topCenter', SIZES[settings.get('size')] || SIZES.normal, settings.get('vpos') || 'badge');
        const key = [map.target, b.x, b.y, b.w, b.h].join(',');
        if (key === geo && ref) return ref;
        if (!client()) return 0;
        if (ref) cr.drop(ref);
        geo = key; visible = false; last = null;
        cv = new Canvas(b.w, b.h);
        ref = cr.image({ target: map.target, klass: 'overlay', z: 12, x: b.x, y: b.y, w: b.w, h: b.h, iw: b.w, ih: b.h, visible: false });
        if (!ref) warnOnce('the renderer refused a ' + b.w + 'x' + b.h + ' layer');
        else log.info('overlay: ' + b.w + 'x' + b.h + ' at ' + b.x + ',' + b.y + ' on ' + map.target);
        return ref;
    }

    function tick() {
        const g = on() && map.showing ? guidance() : null;
        if (!g) return hide();
        if (!layer()) return undefined;
        const tm = now();
        if (visible && tm - lastT < UPDATE_MS - 30) return undefined;
        lastT = tm;
        drawLayer(cv, g, settings.get('units'), settings.get('place') || 'topCenter', settings.get('shields') || 'nl', settings.get('width') === 'fit');
        const d = cv.d;
        if (!last) { cr.pixels(ref, null, Buffer.from(d.buffer, d.byteOffset, d.length)); last = Uint8Array.from(d); }
        else {
            const r = diffRect(last, d, cv.w, cv.h);
            if (r) { cr.pixels(ref, [r], cut(d, cv.w, r)); last.set(d); }
        }
        if (!visible) { cr.set(ref, { visible: true }); visible = true; }
        return undefined;
    }

    let watcher = null;
    const watch = () => {
        if (watcher) return;
        try {
            watcher = fs.watch(path.dirname(statusPath), (ev, name) => { if (!name || name === path.basename(statusPath)) readStatus(); });
            watcher.on('error', () => { try { watcher.close(); } catch (e) { /* gone */ } watcher = null; });
        } catch (e) { watcher = null; }                 // Waze on cluster not installed: polled until it is
    };
    const si = opts.setInterval || setInterval, ci = opts.clearInterval || clearInterval;
    const poll = si(() => { if (on()) { watch(); readStatus(); } }, POLL_MS);
    const draw = si(() => tick(), UPDATE_MS);
    if (on()) { watch(); readStatus(); }
    process.on('exit', () => hide());

    return {
        tick, readStatus,
        shown: () => visible,
        status: () => ({
            map: map.showing ? 'showing on the cluster (' + map.target + ')' : statusText ? 'not on the cluster' : 'no Waze on cluster status',
            renderer: cr ? (cr.ready ? 'connected' : 'connecting') : 'not needed yet',
            shown: visible,
        }),
        stop() { ci(poll); ci(draw); if (watcher) watcher.close(); hide(); if (cr) cr.close(); },
    };
}

module.exports = { startOverlay, mapRect, cardRect, diffRect, drawLayer, SCENES, SIZES, TOPS };
