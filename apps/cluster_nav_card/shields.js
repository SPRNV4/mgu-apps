'use strict';
/**
 * shields.js - road numbers drawn the way each country signs them, for any number: a rounded plate in the road
 * class's colour, a ring inside a thin dark edge, the number in bold (a small gap between the letters and the
 * digits, as on the plates). Drawn, not pictures: the kit's canvas draws no SVG, and a picture for every number
 * would be thousands. The styles follow the official plates' look by eye (colour, ring, text colour).
 *
 *   split(text)             -> { shields: ['A4', 'E19'], name } the road numbers at the start of a road's text;
 *                              an exit number after them ("A4 E19 3 Leiden") as 'exit:3', drawn as the exit's plate
 *   norm(code)              -> the number as the plates write it ('A-4' -> 'A4', 'e-19' -> 'E19')
 *   style(code, region)     -> the plate's colours, or null (then the card's own chip)
 *   width(cv, code, h)      the plate's width at height h
 *   draw(cv, code, x, y, h, region)  -> its width
 *
 * region: the setting "shields" - nl, de, fr, uk, or generic (E-roads only). E-roads are green everywhere.
 */

const RED = '#c8102e', YELLOW = '#f6c400', GREEN = '#00843d', BLUE = '#1f5aa6', WHITE = '#ffffff', BLACK = '#141414';
const plate = (bg, fg, ring, shape) => ({ bg, fg, ring: ring || fg, shape });
const E = plate(GREEN, WHITE);
const STYLES = {
    // s: the cities' s-routes (Amsterdam, Rotterdam, Den Haag): an elongated octagon, white, a thick black ring
    nl: { A: plate(RED, WHITE), N: plate(YELLOW, BLACK), E, s: plate(WHITE, BLACK, BLACK, 'octagon') },
    de: { A: plate(BLUE, WHITE), B: plate(YELLOW, BLACK), E },
    fr: { A: plate(RED, WHITE), N: plate(RED, WHITE), D: plate(YELLOW, BLACK), E },
    uk: { M: plate('#0071bc', WHITE), A: plate('#00703c', '#ffd200', WHITE), B: plate(WHITE, BLACK), E },
    generic: { E },
};
const REGIONS = Object.keys(STYLES);

// a road number: one or two letters, maybe a hyphen, then 1-3 digits and maybe a letter (A4, N201, E19, s111,
// A10a; A-4, e-19 as some names have them)
const CODE = '(?:[A-Za-z]{1,2}-?\\d{1,3}[a-z]?)';
// codes apart by / , ; or just a space ("A4 E19", "a-4 e-19")
const SEP = '(?:\\s*[/,;]\\s*|\\s+)';
const LEAD = new RegExp('^(towards\\s+|richting\\s+|via\\s+)?(' + CODE + '(?:' + SEP + CODE + ')*)(?=$|[\\s,/;:-])[\\s,/;:-]*(.*)$');
// an exit's number at the start of a name, on a motorway ("3 Leiden", "8a", "Exit 12 ..."): 1-3 digits and maybe a
// letter - not a Dutch ordinal ("1e Jan Steenstraat", "2de ...", "3e ..."), whose e / de / ste goes with the number
const EXIT = /^(?:(?:exit|afrit|ausfahrt|sortie|junction)\s+)?(\d{1,3}[a-df-z]?)(?=$|[\s,:-])[\s,:-]*(.*)$/i;
const EXIT_PREFIX = 'exit:';
const isExit = (code) => String(code).indexOf(EXIT_PREFIX) === 0;

/** The exit's number at the start of a name, and the rest: { exit: '3', name: 'Leiden' }, or null. */
function exitOf(name) {
    const m = EXIT.exec(String(name || '').trim());
    return m ? { exit: m[1].toLowerCase(), name: m[2].replace(/\s+/g, ' ').trim() } : null;
}

/**
 * A road number as the plates write it: no hyphen, the letters upper case ("A-4" -> "A4", "e-19" -> "E19") -
 * except the Dutch cities' s-routes, lower case on their signs ("s111", "S-111" too). Anything else as it was.
 */
function norm(code) {
    const m = /^\s*([A-Za-z]{1,2})-?(\d{1,3}[A-Za-z]?)\s*$/.exec(String(code || ''));
    if (!m) return String(code || '').trim();
    const cls = m[1].toLowerCase() === 's' ? 's' : m[1].toUpperCase();
    return cls + m[2].replace(/[A-Z]$/, (c) => c.toLowerCase());
}

/** The road numbers at the start of a road's text (after "towards"), and the rest as its name. */
function split(text) {
    const t = String(text || '').trim();
    const m = LEAD.exec(t);
    const shields = m ? m[2].split(/\s*[/,;]\s*|\s+/).filter(Boolean).slice(0, 3).map(norm) : [];
    let name = m ? m[3] : t;
    const ex = exitOf(name);
    if (ex) { shields.push(EXIT_PREFIX + ex.exit); name = ex.name; }
    return { shields, name: ((m && m[1] || '') + name).replace(/\s+/g, ' ').trim() };
}

/** The road class: its letters, upper case ("A" for A4, "s" stays apart from S as Amsterdam's s-routes do). */
const classOf = (code) => (/^[A-Za-z]+/.exec(code) || [''])[0];

// the exit's plate, as the Dutch motorway signs: blue, a white ring, the exit pictogram, the number
const EXIT_PLATE = { bg: '#1f4ab4', fg: WHITE, ring: WHITE, shape: 'exit' };

function style(code, region) {
    if (isExit(code)) return EXIT_PLATE;
    const cls = classOf(code), set = STYLES[region] || STYLES.generic;
    return set[cls] || (cls === 'E' ? E : null);
}

/** Letters and digits apart ("A", "4"), so the plate shows the gap between them. */
const parts = (code) => { const m = /^([A-Za-z]+)(.*)$/.exec(code); return m ? [m[1], m[2]] : ['', code]; };
const fontOf = (h) => Math.round(h * 0.7);

const textW = (cv, code, h) => { const fs = fontOf(h), [a, b] = parts(code); return cv.textWidth(a, fs, { font: 'bold' }) + (a && b ? h * 0.16 : 0) + cv.textWidth(b, fs, { font: 'bold' }); };
/** The pad either side of the text: more for the octagon, whose slanted ends take room. */
const padOf = (st, h) => (st && st.shape === 'octagon' ? h * 0.44 : h * 0.31);

const exitPic = (h) => h * 0.6;                                    // the pictogram's height (its width: PIC_W times)
function width(cv, code, h, region) {
    if (isExit(code)) return Math.round(h * 0.3 + exitPic(h) * PIC_W + h * 0.2 + cv.textWidth(code.slice(EXIT_PREFIX.length), fontOf(h), { font: 'bold' }) + h * 0.3);
    return Math.round(textW(cv, code, h) + 2 * padOf(style(code, region), h));
}

/**
 * An elongated octagon (flat top and bottom, the ends slanting in to short upright sides), filled: three convex
 * quads - the middle and the two ends - as the GPU recorder draws no other polygon.
 */
function octagon(cv, x, y, w, h, c, col) {
    const o = 0.6;                                                  // a hair of overlap: no seam between the quads
    cv.quad([[x + c - o, y], [x + w - c + o, y], [x + w - c + o, y + h], [x + c - o, y + h]], col);
    cv.quad([[x, y + c], [x + c, y], [x + c, y + h], [x, y + h - c]], col);
    cv.quad([[x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h]], col);
}

/**
 * The exit pictogram in the box x, y, (PIC_W * s) x s, as on the Dutch signs: the motorway's two lanes running up
 * into the distance, and the exit leaving the right one with a big arrow head aimed up and right. Measured off a
 * sign: 1.44 times as wide as tall. Quads only (the GPU recorder's shapes).
 */
const PIC_W = 1.44;
function exitPictogram(cv, x, y, s, col) {
    const P = (u, v) => [x + u * s, y + v * s];
    // the left lane: a wide foot, the outer edge leaning in hard, the inner one upright
    cv.quad([P(0, 1), P(0.48, 1), P(0.48, 0), P(0.34, 0)], col);
    // the right lane: upright on the inside, widening out to the right as it comes down
    cv.quad([P(0.55, 1), P(1.0, 1), P(1.0, 0.5), P(0.55, 0.5)], col);
    cv.quad([P(0.55, 0.52), P(0.55, 0), P(0.67, 0), P(0.9, 0.52)], col);
    // the exit: out of the right lane, up and to the right, and its head (a right angle, the tip in the corner)
    const pts = [];
    for (let i = 0; i <= 10; i++) {
        const u = i / 10, a = [0.86, 0.74], b = [0.9, 0.4], c = [1.16, 0.22];
        pts.push(P((1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * b[0] + u * u * c[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * b[1] + u * u * c[1]));
    }
    cv.polyline(pts, s * 0.24, col);
    cv.quad([P(1.44, 0), P(1.44, 0), P(0.98, 0), P(1.44, 0.46)], col);
}

function draw(cv, code, x, y, h, region, fallback) {
    const st = style(code, region) || fallback;
    const w = width(cv, code, h, region);
    if (st.shape === 'exit') {
        const r = h * 0.16, e = Math.max(1, h * 0.08), rg = Math.max(1.2, h * 0.055);
        cv.roundRect(x, y, w, h, r, st.bg);
        cv.roundRect(x + e, y + e, w - 2 * e, h - 2 * e, Math.max(1, r - e), st.ring);
        cv.roundRect(x + e + rg, y + e + rg, w - 2 * (e + rg), h - 2 * (e + rg), Math.max(1, r - e - rg), st.bg);
        const p = exitPic(h), px = x + h * 0.3;
        exitPictogram(cv, px, y + (h - p) / 2, p, st.fg);
        cv.text(code.slice(EXIT_PREFIX.length), px + p * PIC_W + h * 0.2, y + h * 0.75, fontOf(h), st.fg, { font: 'bold' });
        return w;
    }
    if (st.shape === 'octagon') {
        // as the s-route signs: a thin grey edge, a white rim, a thick black ring, the white field
        const c = h * 0.27, e = Math.max(1, h * 0.03), rim = Math.max(1, h * 0.06), ring = Math.max(1.5, h * 0.11);
        const k = (d) => d * 0.41;                                  // how far a slanted end moves in for an inset d
        octagon(cv, x, y, w, h, c, '#8c8c8c');
        let d = e;
        octagon(cv, x + d, y + d, w - 2 * d, h - 2 * d, c - k(d), WHITE);
        d += rim;
        octagon(cv, x + d, y + d, w - 2 * d, h - 2 * d, c - k(d), st.ring);
        d += ring;
        octagon(cv, x + d, y + d, w - 2 * d, h - 2 * d, Math.max(1, c - k(d)), st.bg);
    } else {
        const r = h * 0.2, e = Math.max(1, h * 0.045), rg = Math.max(1, h * 0.07);
        cv.roundRect(x, y, w, h, r, BLACK);                                      // the thin dark edge
        cv.roundRect(x + e, y + e, w - 2 * e, h - 2 * e, r - e, st.ring);       // the ring
        cv.roundRect(x + e + rg, y + e + rg, w - 2 * (e + rg), h - 2 * (e + rg), Math.max(1, r - e - rg), st.bg);
    }
    const fs = fontOf(h), [a, b] = parts(code), by = y + h * 0.75;
    let tx = x + padOf(st, h);
    if (a) tx += cv.text(a, tx, by, fs, st.fg, { font: 'bold' }) + (b ? h * 0.16 : 0);
    cv.text(b, tx, by, fs, st.fg, { font: 'bold' });
    return w;
}

module.exports = { split, norm, exitOf, isExit, EXIT_PREFIX, style, width, draw, classOf, STYLES, REGIONS };
