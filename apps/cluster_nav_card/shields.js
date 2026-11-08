'use strict';
/**
 * shields.js - road numbers drawn the way each country signs them, for any number: a rounded plate in the road
 * class's colour, a ring inside a thin dark edge, the number in bold (a small gap between the letters and the
 * digits, as on the plates). Drawn, not pictures: the kit's canvas draws no SVG, and a picture for every number
 * would be thousands. The styles follow the official plates' look by eye (colour, ring, text colour).
 *
 *   split(text)             -> { shields: ['A4', 'E19'], name } the road numbers at the start of a road's text
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
const LEAD = new RegExp('^(towards\\s+|richting\\s+|via\\s+)?(' + CODE + '(?:\\s*[/,;]\\s*' + CODE + ')*)(?=$|[\\s,/;:-])[\\s,/;:-]*(.*)$');

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
    if (!m) return { shields: [], name: t };
    const shields = m[2].split(/\s*[/,;]\s*/).filter(Boolean).slice(0, 3).map(norm);
    return { shields, name: ((m[1] || '') + m[3]).replace(/\s+/g, ' ').trim() };
}

/** The road class: its letters, upper case ("A" for A4, "s" stays apart from S as Amsterdam's s-routes do). */
const classOf = (code) => (/^[A-Za-z]+/.exec(code) || [''])[0];

function style(code, region) {
    const cls = classOf(code), set = STYLES[region] || STYLES.generic;
    return set[cls] || (cls === 'E' ? E : null);
}

/** Letters and digits apart ("A", "4"), so the plate shows the gap between them. */
const parts = (code) => { const m = /^([A-Za-z]+)(.*)$/.exec(code); return m ? [m[1], m[2]] : ['', code]; };
const fontOf = (h) => Math.round(h * 0.7);

const textW = (cv, code, h) => { const fs = fontOf(h), [a, b] = parts(code); return cv.textWidth(a, fs, { font: 'bold' }) + (a && b ? h * 0.16 : 0) + cv.textWidth(b, fs, { font: 'bold' }); };
/** The pad either side of the text: more for the octagon, whose slanted ends take room. */
const padOf = (st, h) => (st && st.shape === 'octagon' ? h * 0.44 : h * 0.31);

function width(cv, code, h, region) {
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

function draw(cv, code, x, y, h, region, fallback) {
    const st = style(code, region) || fallback;
    const w = width(cv, code, h, region);
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

module.exports = { split, norm, style, width, draw, classOf, STYLES, REGIONS };
