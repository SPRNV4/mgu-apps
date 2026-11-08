'use strict';
/**
 * source.js - where Cluster Nav Card's turn-by-turn guidance comes from. Every source gives the same shape:
 *
 *   guidance = { maneuver, exit, distanceM, road, shield, lanes: [{ dirs: [...], on: [...] }], from, t }
 *     maneuver: a card.js KINDS name (left, right, slightLeft, ..., roundabout, arrive); exit: roundabout exit 1-4
 *     distanceM: metres to the manoeuvre; road / shield: the road it leads onto and its number (optional)
 *     lanes: left to right; dirs = the arrows painted on the lane, on = those of them that take the route
 *
 *   demo - a drive through a few manoeuvres, the distance counting down (setting "demoRoute": on)
 *   car  - the head unit's navigation (headunit.js): the guidance CarPlay or Android Auto sends the head unit,
 *          as the navigation publishes it for its own cluster dart; or BMW's own route (setting "provider": any)
 *   file - /dev/shm/nav-card/guidance.json, written by any other program on the head unit that has the guidance:
 *            { "v": 1, "t": <Date.now()>, "app": "...", "maneuver": "left", "distance_m": 91, "road": "Seneca St",
 *              "shield": "165", "lanes": [{ "dirs": ["left"], "on": ["left"] }, { "dirs": ["straight"] }] }
 *          replaced whole (written to a temporary file, then renamed over it); older than STALE_MS = no guidance.
 *   With the demo off both are read: the car's guidance first, then the file's.
 *
 * now() -> guidance or null (no route); status() -> { source, detail } for the app's page.
 */
const fs = require('fs');
const path = require('path');
const { KINDS } = require('./card');
const { headunit } = require('./headunit');

const FILE = process.env.NAV_CARD_FILE || '/dev/shm/nav-card/guidance.json';
const STALE_MS = 4000;
const READ_MS = 250;

/** A guidance object from the file's JSON (unknown manoeuvres and bad lanes left out); null when it has none. */
function parse(j) {
    if (!j || typeof j !== 'object' || KINDS.indexOf(j.maneuver) < 0) return null;
    const dist = Number(j.distance_m);
    const lanes = Array.isArray(j.lanes) ? j.lanes.filter((l) => l && Array.isArray(l.dirs) && l.dirs.length)
        .map((l) => ({ dirs: l.dirs.filter((d) => KINDS.indexOf(d) >= 0), on: Array.isArray(l.on) ? l.on : [] }))
        .filter((l) => l.dirs.length) : [];
    return {
        maneuver: j.maneuver, exit: Number(j.exit) || undefined,
        distanceM: isFinite(dist) && dist >= 0 ? dist : null,
        road: typeof j.road === 'string' ? j.road.slice(0, 60) : '', shield: typeof j.shield === 'string' ? j.shield.slice(0, 8) : '',
        lanes, from: String(j.app || 'file'), t: Number(j.t) || 0,
    };
}

/* ------------------------------------------------------------------ demo -- */

// a short drive: each step's manoeuvre, its distance when it becomes the next one, the road and the lanes
const ROUTE = [
    { maneuver: 'left', distanceM: 450, road: 'Seneca St', shield: '165',
        lanes: [{ dirs: ['left'], on: ['left'] }, { dirs: ['straight'] }, { dirs: ['straight'] }, { dirs: ['straight'] }] },
    { maneuver: 'slightRight', distanceM: 1600, road: 'Delaware Ave', shield: '384',
        lanes: [{ dirs: ['straight'] }, { dirs: ['straight'] }, { dirs: ['straight', 'slightRight'], on: ['slightRight'] }, { dirs: ['slightRight'], on: ['slightRight'] }] },
    { maneuver: 'roundabout', exit: 2, distanceM: 700, road: 'Niagara Square' },
    { maneuver: 'right', distanceM: 350, road: 'Court St',
        lanes: [{ dirs: ['left', 'straight'] }, { dirs: ['straight'] }, { dirs: ['right'], on: ['right'] }] },
    { maneuver: 'arrive', distanceM: 220, road: 'Destination on the right' },
];
const DEMO_KMH = 54;

function demo(now) {
    const t0 = now();
    const total = ROUTE.reduce((n, s) => n + s.distanceM, 0);
    return {
        now() {
            const m = ((now() - t0) / 1000 * DEMO_KMH / 3.6) % (total + 150);    // (a moment with no route at the end)
            let left = m;
            for (const s of ROUTE) {
                if (left < s.distanceM) return Object.assign({}, s, { distanceM: Math.max(0, s.distanceM - left), from: 'demo', t: now() });
                left -= s.distanceM;
            }
            return null;
        },
        status: () => ({ source: 'demo', detail: 'a demo drive' }),
        stop() {},
    };
}

/* ------------------------------------------------------------------ file -- */

function file(log, opts) {
    const p = opts.path || FILE, now = opts.now || Date.now;
    let last = null, txt = '', seen = false, bad = '';
    const read = () => fs.readFile(p, 'utf8', (err, s) => {
        if (err) { if (seen) log.info('guidance file gone: ' + p); seen = false; last = null; txt = ''; return; }
        if (s === txt) return;
        txt = s;
        let j;
        try { j = JSON.parse(s); } catch (e) { return; }                  // half written: the next read
        const g = parse(j);
        if (!g) { if (bad !== s.slice(0, 80)) { bad = s.slice(0, 80); log.warn('guidance file: nothing usable in ' + bad); } return; }
        if (!seen) { seen = true; log.info('guidance from ' + g.from + ' (' + p + ')'); }
        last = g;
    });
    const timer = (opts.setInterval || setInterval)(read, READ_MS);
    read();
    return {
        now: () => (last && now() - last.t < STALE_MS ? last : null),
        status: () => ({ source: 'file', detail: last && now() - last.t < STALE_MS ? 'from ' + last.from : seen ? 'no fresh guidance' : 'waiting for ' + p }),
        stop: () => (opts.clearInterval || clearInterval)(timer),
        _read: read,
    };
}

/** The car's guidance first; else the guidance file. */
function live(ctx, opts) {
    const car = (opts.headunit || headunit)(ctx, opts), fl = file(ctx.log, opts);
    let was = '';
    const pick = () => {
        const c = car.now();
        if (c) return ['car', c];
        const f = fl.now();
        return f ? ['file', f] : ['', null];
    };
    return {
        now() {
            const [k, g] = pick();
            if (k !== was) { was = k; ctx.log.info('guidance: ' + (k ? 'from the ' + k + ' (' + g.from + ')' : 'no route')); }
            return g;
        },
        status() {
            const c = car.status(), f = fl.status(), k = pick()[0];
            return { source: 'live', detail: c.detail, car: c.detail, file: f.detail, using: k, fileActive: k === 'file' };
        },
        diag: () => (car.diag ? car.diag() : []),
        logStatus: () => (car.logStatus ? car.logStatus() : ''),
        trafficSide: () => (car.trafficSide ? car.trafficSide() : null),
        events: () => (car.events && car.now() ? car.events() : []),
        stop() { car.stop(); fl.stop(); },
    };
}

/**
 * The source the "demoRoute" setting asks for, switched when it changes: demo on -> the demo drive; else live
 * (the car's navigation, then the guidance file).
 */
function startSource(ctx, opts) {
    opts = opts || {};
    const now = opts.now || Date.now;
    let cur = null, kind = null;
    const pick = () => {
        const want = ctx.settings.get('demoRoute') === 'on' ? 'demo' : 'live';
        if (want === kind) return;
        if (cur) cur.stop();
        kind = want;
        cur = want === 'demo' ? demo(now) : live(ctx, Object.assign({ now }, opts));
        ctx.log.info('guidance source: ' + want);
    };
    pick();
    if (ctx.settings.onChange) ctx.settings.onChange((k) => { if (k === 'demoRoute') pick(); });
    return { now: () => cur.now(), status: () => cur.status(), kind: () => kind, diag: () => (cur.diag ? cur.diag() : ['(demo drive)']), events: () => (cur.events ? cur.events() : []), logStatus: () => (cur.logStatus ? cur.logStatus() : ''), trafficSide: () => (cur.trafficSide ? cur.trafficSide() : null) };
}

module.exports = { startSource, parse, demo, file, live, ROUTE, FILE, STALE_MS };
