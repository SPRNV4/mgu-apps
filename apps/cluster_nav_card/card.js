'use strict';
/**
 * card.js - Cluster Nav Card's turn card, drawn in the manner of a phone navigation app's: a rounded green card with
 * one low row - the next manoeuvre's arrow, the distance to it in big type, the road's number in a small green
 * chip and its name - and a darker strip along the bottom with the lanes (the ones to take lit, the others dim).
 *
 *   draw(cv, g, opts)  into a software canvas (kit/canvas.js) of any size: everything scales with its height
 *   size(h, g)         the card's width for a height
 *   g = guidance (source.js): { maneuver, distanceM, road, shield, lanes: [{ dirs: [...], on: [...] }], then }
 *   g.palette 'green' (default) | 'black'
 *   opts.units 'metric' | 'imperial'; opts.region: the road plates' style (shields.js)
 *
 * The manoeuvre symbols (MANEUVERS) are polylines in a unit box with an arrow head on the last segment, so the
 * same drawing serves the big arrow and the lane arrows. Only shapes both the GPU recorder (kit/record.js) and the
 * software canvas draw: roundRect, fillRect, arc / circle, line / polyline, quad, text. Pure: no state.
 */

// one row (arrow, distance, road), then the lanes' strip under it
const SH = require('./shields');
// BASE_W: the card's standard width at BASE_H (the same at ROW_H without lanes): 480 px at the normal size
const ROW_H = 72, LANES_H = 46, BASE_H = ROW_H + LANES_H, BASE_W = 480;
const COL = {
    card: '#1d5f4f', strip: '#184f42', line: '#ffffff29', chip: '#3e9b4f', text: '#ffffff',
    soft: '#ffffffd1', dimLane: '#ffffff61',
};
// the card's colours by g.palette: green (the default; phone apps that send their guidance) or black, in the
// manner of BMW's own turn box, for a source that asks for it
const PALETTES = {
    green: COL,
    black: { card: '#111317', strip: '#0a0b0d', line: '#ffffff21', chip: '#3b3f46', text: '#ffffff', soft: '#ffffffd1', dimLane: '#ffffff57' },
};

/* -------------------------------------------------------------- symbols -- */

// Each symbol: strokes in a unit box (x right, y down, 0..1); the last point of the first stroke gets the arrow
// head. Turns follow the familiar shapes: a stem up from the bottom, then the turn.
const MANEUVERS = {
    straight: [[[0.5, 0.95], [0.5, 0.12]]],
    left: [[[0.62, 0.95], [0.62, 0.42], [0.18, 0.42]]],
    right: [[[0.38, 0.95], [0.38, 0.42], [0.82, 0.42]]],
    slightLeft: [[[0.6, 0.95], [0.6, 0.55], [0.26, 0.2]]],
    slightRight: [[[0.4, 0.95], [0.4, 0.55], [0.74, 0.2]]],
    sharpLeft: [[[0.66, 0.95], [0.66, 0.3], [0.24, 0.72]]],
    sharpRight: [[[0.34, 0.95], [0.34, 0.3], [0.76, 0.72]]],
    uturnLeft: [[[0.7, 0.95], [0.7, 0.36], [0.62, 0.2], [0.48, 0.14], [0.34, 0.2], [0.28, 0.36], [0.28, 0.72]]],
    uturnRight: [[[0.3, 0.95], [0.3, 0.36], [0.38, 0.2], [0.52, 0.14], [0.66, 0.2], [0.72, 0.36], [0.72, 0.72]]],
    mergeLeft: [[[0.66, 0.95], [0.66, 0.62], [0.36, 0.34], [0.36, 0.1]], [[0.28, 0.95], [0.28, 0.58]]],
    mergeRight: [[[0.34, 0.95], [0.34, 0.62], [0.64, 0.34], [0.64, 0.1]], [[0.72, 0.95], [0.72, 0.58]]],
    exitLeft: [[[0.6, 0.95], [0.6, 0.6], [0.24, 0.24]], [[0.6, 0.6], [0.6, 0.1]]],
    exitRight: [[[0.4, 0.95], [0.4, 0.6], [0.76, 0.24]], [[0.4, 0.6], [0.4, 0.1]]],
};
const KINDS = Object.keys(MANEUVERS).concat(['roundabout', 'arrive']);

/** A symbol (MANEUVERS key, 'roundabout' or 'arrive') in the box x, y, s x s; t = stroke width. exit: roundabout exit 1..4, or turnDeg. */
function symbol(cv, kind, x, y, s, t, c, opts) {
    opts = opts || {};
    // see-through colours made solid on the ground they're drawn on: a translucent line doubles up wherever it
    // overlaps itself (its joints, the arrow head on its end, a dim road under the turn) and shows lighter there
    const g0 = opts.ground || COL.card, sol = (col) => solid(col, g0);
    c = sol(c);
    const P = (p) => [x + p[0] * s, y + p[1] * s];
    if (kind === 'arrive') {                                   // a map pin
        const cx = x + s / 2, cy = y + s * 0.4, r = s * 0.26;
        cv.circle(cx, cy, r, c);
        tri(cv, [cx - r * 0.86, cy + r * 0.5], [cx + r * 0.86, cy + r * 0.5], [cx, y + s * 0.95], c);
        cv.circle(cx, cy, r * 0.42, g0);
        return;
    }
    if (kind === 'roundabout') {
        // the ring thin and dim; the way taken bold, as one line: in from below, round the ring in the direction
        // of travel (counter-clockwise; clockwise where traffic keeps left), out at the exit with the arrow head.
        // turnDeg: 0 straight on, 90 right, -90 left, 180 back; else exit 1..4 (right, on, left, back)
        const cx = x + s / 2, cy = y + s * 0.5, r = s * 0.18, tt = t * 0.85;
        cv.arc(cx, cy, r - tt * 0.2, r + tt * 0.2, 0, 360, sol(opts.dim || COL.dimLane));
        const n = Math.max(1, Math.min(4, opts.exit || 2));
        const exitDeg = Number.isFinite(opts.turnDeg) ? 90 - opts.turnDeg : (n - 1) * 90;   // from the right, counter-clockwise
        const from = -90, cw = !!opts.clockwise;                   // the way in: the ring's bottom
        let to = exitDeg;
        if (!cw) { while (to <= from + 20) to += 360; while (to > from + 380) to -= 360; } else { while (to >= from - 20) to -= 360; while (to < from - 380) to += 360; }
        if (Math.abs(to - from) > 330) to = from + (cw ? -330 : 330); // back the way in: out beside it, not over it
        const pt = (deg, rr) => [cx + Math.cos(deg * Math.PI / 180) * rr, cy - Math.sin(deg * Math.PI / 180) * rr];
        const pts = [[cx, y + s * 0.98], [cx, cy + r]];
        const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 10));
        for (let i = 1; i <= steps; i++) pts.push(pt(from + (to - from) * i / steps, r));
        pts.push(pt(to, s * 0.48));
        arrowLine(cv, pts, tt, c);
        return;
    }
    const strokes = MANEUVERS[kind] || MANEUVERS.straight;
    // the road the turn leaves (an exit's straight on, a merge's other road): dim, so the turn itself stands out,
    // as the roundabout's ring is; drawn first, the turn over it
    strokes.slice(1).forEach((st) => cv.polyline(st.map(P), t, sol(opts.second || dimOf(c))));
    arrowLine(cv, strokes[0].map(P), t, c);
}

/*
 * A lane's arrows the way Google Maps paints them: one stem up from the bottom that splits into a branch for each
 * direction the lane allows, each branch ending in its own head - so the heads sit apart instead of one arrow's
 * on another's. The branches that take the route lit, the others dim; the stem lit when any branch is.
 * Branches right of the stem; the left ones mirrored. Each: the bezier from the split, [control..., end].
 */
const J = [0.5, 0.72];                                         // where the stem splits
// the tips kept apart: straight on at the top, a turn out to the side and lower, so no head meets another
const BRANCH = {
    straight: [[0.5, 0.08]],
    slightRight: [[0.5, 0.5], [0.84, 0.12]],
    right: [[0.5, 0.46], [0.62, 0.46], [1.02, 0.46]],
    sharpRight: [[0.5, 0.3], [0.88, 0.28], [0.9, 0.8]],
    uturnRight: [[0.5, 0.1], [0.9, 0.1], [0.9, 0.66]],
};
const LANE_HEAD = 0.82;                                         // a lane's heads, a little smaller than the turn's
// any other kind a lane may carry (a guidance file's): the branch nearest it
const LANE_AS = { exitRight: 'slightRight', exitLeft: 'slightLeft', mergeRight: 'straight', mergeLeft: 'straight', roundabout: 'straight', arrive: 'straight' };

function bezier(p0, ctrl, n) {
    const pts = [p0].concat(ctrl), out = [];
    for (let i = 1; i <= n; i++) {
        let q = pts.map((p) => p.slice());
        const u = i / n;
        while (q.length > 1) q = q.slice(1).map((p, k) => [q[k][0] + (p[0] - q[k][0]) * u, q[k][1] + (p[1] - q[k][1]) * u]);
        out.push(q[0]);
    }
    return out;
}

/** The lane's branch for direction d as points in the unit box, from the split to the tip. */
function branchOf(d) {
    d = LANE_AS[d] || d;
    const left = d === 'left' || /Left$/.test(d), key = d === 'left' ? 'right' : left ? d.replace(/Left$/, 'Right') : d;
    const ctrl = BRANCH[key] || BRANCH.straight;
    const pts = [J].concat(ctrl.length === 1 ? ctrl : bezier(J, ctrl, 10));
    return left ? pts.map((p) => [1 - p[0], p[1]]) : pts;
}

/** A lane's arrows in the box x, y, s x s; t = stroke width; on = the directions lit. */
function laneSymbol(cv, dirs, on, x, y, s, t, lit, dim, ground) {
    const P = (p) => [x + p[0] * s, y + p[1] * s];
    lit = solid(lit, ground); dim = solid(dim, ground);
    const ds = (dirs && dirs.length ? dirs : ['straight']).map((d) => LANE_AS[d] || d)
        .filter((d, i, a) => a.indexOf(d) === i);
    const isOn = (d) => (on || []).map((o) => LANE_AS[o] || o).indexOf(d) >= 0;
    const anyOn = ds.some(isOn);
    ds.filter((d) => !isOn(d)).forEach((d) => arrowLine(cv, branchOf(d).map(P), t, dim, LANE_HEAD));
    cv.polyline([P([0.5, 0.95]), P(J)], t, anyOn ? lit : dim);
    ds.filter(isOn).forEach((d) => arrowLine(cv, branchOf(d).map(P), t, lit, LANE_HEAD));
}

/** A colour at 40% of its opacity ('#rrggbb' or '#rrggbbaa'). */
function dimOf(c) {
    if (typeof c !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return c;
    const a = c.length === 9 ? parseInt(c.slice(7), 16) : 255;
    return c.slice(0, 7) + ('0' + Math.round(a * 0.4).toString(16)).slice(-2);
}

const rgba = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)
    ? [1, 3, 5, 7].map((i) => (i < c.length ? parseInt(c.slice(i, i + 2), 16) : 255)) : null);
/** c ('#rrggbbaa') as it shows over the solid ground: the same colour, opaque. c as it is when either won't parse. */
function solid(c, ground) {
    const a = rgba(c), b = rgba(ground);
    if (!a || !b || a[3] === 255) return c;
    const k = a[3] / 255, h = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
    return '#' + [0, 1, 2].map((i) => h(a[i] * k + b[i] * (1 - k))).join('');
}

/** A filled triangle as a quad with its last corner twice (the GPU recorder draws quads, not N-point polygons). */
function tri(cv, a, b, c, col) { cv.quad([a, b, c, c], col); }

/** A polyline ending in an arrow head (a triangle a little over twice the stroke wide). */
function arrowLine(cv, pts, t, c, head) {
    const n = pts.length, [x1, y1] = pts[n - 1], [x0, y0] = pts[n - 2];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const k = head || 1, hl = t * 2.1 * k, hw = t * 1.45 * k;  // head length, half width
    const bx = x1 - ux * hl, by = y1 - uy * hl;
    cv.polyline(pts.slice(0, -1).concat([[bx + ux * t * 0.3, by + uy * t * 0.3]]), t, c);
    tri(cv, [x1 + ux * t * 0.25, y1 + uy * t * 0.25], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw], c);
}

/* ------------------------------------------------------------- distance -- */

/** The distance the way a navigation app says it: [number, unit]. */
function distance(m, units) {
    if (typeof m !== 'number' || !isFinite(m) || m < 0) return ['', ''];
    if (units === 'imperial') {
        const ft = m * 3.28084, mi = m / 1609.344;
        if (ft < 528) return [String(ft < 100 ? Math.round(ft / 10) * 10 : Math.round(ft / 50) * 50), 'ft'];
        return [mi < 10 ? mi.toFixed(1).replace(/\.0$/, '') : String(Math.round(mi)), 'mi'];
    }
    // under 10 m as it is (down to "0 m" at the turn), then in tens, then in fifties
    if (m < 995) return [String(m < 10 ? Math.round(m) : m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50), 'm'];
    const km = m / 1000;
    return [km < 10 ? km.toFixed(1).replace(/\.0$/, '') : String(Math.round(km)), 'km'];
}

/* ----------------------------------------------------------------- card -- */

const hasLanes = (g) => !!(g && g.lanes && g.lanes.length);
/** The card's height in BASE_H units: without lanes the strip goes. */
const baseH = (g) => (hasLanes(g) ? BASE_H : ROW_H);
/** The card's width for a height h (proportions kept; a multiple of 4, as the render service wants). */
function size(h, g) { return Math.round(BASE_W * h / baseH(g) / 4) * 4; }

function draw(cv, g, opts) {
    opts = opts || {};
    const W = cv.w, H = cv.h, k = H / baseH(g), S = (n) => n * k;
    const r = S(16), P = PALETTES[g && g.palette] || COL;
    cv.clear([0, 0, 0, 0]);
    cv.roundRect(0, 0, W, H, r, P.card);
    if (!g || !g.maneuver) return;

    // the manoeuvre, the distance to it, the road's numbers on their plates, its name
    symbol(cv, g.maneuver, S(12), S(10), S(52), S(6.5), P.text, { exit: g.exit, turnDeg: g.turnDeg, clockwise: g.clockwise, ground: P.card });
    const L = row(cv, g, S, opts);
    if (L.num) {
        // a distance estimated (g.estimated), not read: dimmer
        const dc = g.estimated ? '#ffffff99' : P.text;
        cv.text(L.num, L.numX, S(51), Math.round(S(40)), dc, { font: 'bold' });
        if (L.unit) cv.text(L.unit, L.unitX, S(51), Math.round(S(28)), dc, { font: 'bold' });
    }
    L.shields.forEach((sh) => SH.draw(cv, sh.code, sh.x, S(22), S(28), opts.region, { bg: P.chip, fg: P.text, ring: P.chip }));
    const room = W - L.roadX - S(16);
    if (L.name && room > S(30)) cv.text(fit(cv, L.name, room, L.roadSize), L.roadX, L.roadY, L.roadSize, P.text, { font: 'bold' });

    // the lanes: a strip along the bottom, each lane its arrows, the ones to take lit
    if (!hasLanes(g)) return;
    const sy = S(ROW_H);
    cv.roundRect(0, sy, W, H - sy, r, P.strip);
    cv.fillRect(0, sy, W, Math.min(r, H - sy), P.strip);
    cv.fillRect(0, sy, W, Math.max(1, S(1.5)), P.line);
    const lanes = g.lanes.slice(0, 10), ls = S(34), gap = S(10);
    const lx0 = (W - (lanes.length * ls + (lanes.length - 1) * gap)) / 2;
    lanes.forEach((ln, i) => {
        laneSymbol(cv, ln.dirs, ln.on, lx0 + i * (ls + gap), sy + S(6), ls, S(4.2), P.text, P.dimLane, P.strip);
    });
}

/** The card's own chip for a road number no country style covers. */
const CHIP = { bg: COL.chip, fg: COL.text, ring: COL.chip };

/** The road's numbers: g.shields, else g.shield, else those at the start of its name; and the name without them. */
function roadOf(g) {
    const sp = SH.split(g.road);
    const given = g.shields && g.shields.length ? g.shields : g.shield ? [g.shield] : null;
    if (!given) return { shields: sp.shields.slice(0, 4), name: sp.name };
    // the car's own plates, then maybe the exit's number at the start of the name
    const shields = given.map(SH.norm).slice(0, 3), ex = SH.exitOf(g.road);
    return ex ? { shields: shields.concat([SH.EXIT_PREFIX + ex.exit]), name: ex.name } : { shields, name: String(g.road || '') };
}

/**
 * The row's layout after the arrow, for draw and measure alike: the distance (when there is one), the plates,
 * the name. Without a distance the name takes its place, in larger type.
 */
function row(cv, g, S, opts) {
    const [num, unit] = distance(g.distanceM, opts.units);
    const out = { num, unit, shields: [] };
    let x = S(76);
    if (num) {
        out.numX = x; x += cv.textWidth(num, Math.round(S(40)), { font: 'bold' });
        if (unit) { out.unitX = x + S(6); x = out.unitX + cv.textWidth(unit, Math.round(S(28)), { font: 'bold' }); }
        x += S(20);
    }
    const rd = roadOf(g);
    rd.shields.forEach((code) => { out.shields.push({ code, x }); x += SH.width(cv, code, S(28), opts.region) + S(10); });
    if (rd.shields.length) x += S(2);
    out.name = rd.name;
    out.roadX = x;
    out.roadSize = Math.round(S(num ? 23 : 30));
    out.roadY = num ? S(43.5) : S(47);
    out.end = x + (rd.name ? cv.textWidth(rd.name, out.roadSize, { font: 'bold' }) + S(4) : 0);
    return out;
}

/**
 * The width the card needs at height h for g (cv measures the text): its row and its lanes with their margins, at
 * least 2.6 times its row's height, at most maxW; a multiple of step (so the width moves only in steps).
 */
function measure(cv, g, h, opts) {
    opts = opts || {};
    const k = h / baseH(g), S = (n) => n * k, step = opts.step || 32;
    let w = S(76);
    if (g && g.maneuver) {
        w = row(cv, g, S, opts).end + S(16);
        if (hasLanes(g)) { const n = Math.min(10, g.lanes.length); w = Math.max(w, n * S(34) + (n - 1) * S(10) + S(48)); }
    }
    w = Math.ceil(Math.max(w, S(ROW_H * 2.6)) / step) * step;
    return opts.maxW ? Math.min(w, opts.maxW) : w;
}

/** str cut with an ellipsis to w px at size. */
function fit(cv, str, w, size) {
    if (cv.textWidth(str, size, { font: 'bold' }) <= w) return str;
    let s = str;
    while (s.length > 1 && cv.textWidth(s + '…', size, { font: 'bold' }) > w) s = s.slice(0, -1);
    return s.replace(/\s+$/, '') + '…';
}

module.exports = { solid, laneSymbol, branchOf, draw, size, distance, symbol, MANEUVERS, KINDS, COL, BASE_H, BASE_W, ROW_H, hasLanes, measure, roadOf, PALETTES };
