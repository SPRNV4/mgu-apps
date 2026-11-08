'use strict';
/**
 * headunit.js - the turn-by-turn guidance the head unit's navigation publishes for its own cluster dart.
 *
 * With CarPlay (or Android Auto) guiding, the phone sends its manoeuvres to the head unit
 * (navigation.projectedmodeguiding.ProjectedModeGuiding: addEventsOnRoute / updateEventsOnRoute) and the
 * navigation republishes them, as it does its own route's, in de.bmw.infotainment.navigation.guiding.Guidance
 * (service 64282, instance Main_Instance), all fields with notifiers:
 *
 *   guidanceState       INACTIVE / CALCULATING_ROUTE / ACTIVE
 *   guidingProvider     NONE / CAR_PLAY / ANDROID_AUTO / CAR_LIFE / OTHER (NONE: BMW's own navigation)
 *   conclusiveDart      { maneuver: GuidanceEventUnion, bargraphProgress, ... } - the next manoeuvre:
 *                         intersection { direction: TurnDirection }, branch { branchType }, roundabout { exitAngle,
 *                         exitNumber, driveDirection }, destinationManeuver, ...; each a GuidancePanel with
 *                         formattedDistance { distance, unit, rawDistance } and description { elements: [ text |
 *                         spacer | icon { text } ] } (the road's name, its number as an icon's text)
 *   currentLaneGuiding  { rows: [{ lanes: [{ directionToFollow, directionsToFollow[], otherDirections[],
 *                         isHighlighted, additionalLaneInfo }], ... }], carPositionLaneIndex }
 *   nextIntersection    { intersection: Description, distance: FormattedDistance } - road and distance otherwise
 *
 * and a4a.carplay.CarPlayManager (CarPlayManagerInst1).projectedGuidanceMetadataAvailable / projectedGuidanceActive:
 * whether the phone guides and sends turn data at all; for diagnostics also ProjectedModeGuiding's fields (what the
 * phone side hands the navigation). Every value that comes is on the app's page (diag()).
 *
 * From the catalog only, not yet seen on a car: the native someip module gives unions as { memberName: value }
 * (the Service app reads CBS records so) and enums as numbers or names, both taken here. The roundabout's
 * exitAngle is read as the angle driven round the ring from the way in; until that is seen on a car, the exit
 * number is the fallback. The first values of each field go to the log and the latest to RAW_FILE, so a drive
 * shows what the car really sends.
 */
const fs = require('fs');
const path = require('path');

const GUIDANCE = 'de.bmw.infotainment.navigation.guiding.Guidance';
const CARPLAY = 'de.bmw.infotainment.a4a.carplay.CarPlayManager';
const PROJECTED = 'de.bmw.infotainment.navigation.projectedmodeguiding.ProjectedModeGuiding';
const EVENTS = 'de.bmw.infotainment.navigation.guiding.GuidanceEventList';
const CCP = 'de.bmw.infotainment.navigation.externalize.adasng.CCP';     // where the car is: its country, its traffic side

// countries that drive on the left (ISO 3166 alpha-2 and alpha-3), for when nothing else says
const LEFT_HAND = ('GB GBR UK IE IRL MT MLT CY CYP IM IMN JE JEY GG GGY GI GIB JP JPN AU AUS NZ NZL IN IND PK PAK BD BGD LK LKA NP NPL '
    + 'BT BTN ZA ZAF NA NAM BW BWA ZW ZWE ZM ZMB MZ MOZ MW MWI KE KEN UG UGA TZ TZA LS LSO SZ SWZ MU MUS SC SYC TH THA MY MYS '
    + 'SG SGP ID IDN BN BRN TL TLS HK HKG MO MAC JM JAM TT TTO BS BHS BB BRB GY GUY SR SUR FJ FJI PG PNG WS WSM TO TON').split(' ');
/** The traffic side a country code means: 'LEFT', 'RIGHT', or '' for no code. */
function sideOfCountry(code) {
    const c = String(code || '').trim().toUpperCase();
    return !c ? '' : LEFT_HAND.indexOf(c) >= 0 ? 'LEFT' : 'RIGHT';
}
const QUERY_MS = 1000;
const RAW_FILE = process.env.NAV_CARD_RAW || '/dev/shm/nav-card/headunit-raw.json';

const TURN = { 0: 'NONE', 1: 'STRAIGHT_ON', 2: 'LEFT', 3: 'SLIGHT_LEFT', 4: 'HARD_LEFT', 5: 'RIGHT', 6: 'SLIGHT_RIGHT', 7: 'HARD_RIGHT', 8: 'UTURN_RIGHT', 9: 'UTURN_LEFT' };
const BRANCH = { 1: 'BRANCH_LEFT', 2: 'BRANCH_RIGHT', 3: 'HIGHWAY_IN_LEFT', 4: 'HIGHWAY_IN_RIGHT', 5: 'HIGHWAY_IN_STRAIGHT', 6: 'HIGHWAY_OUT_LEFT', 7: 'HIGHWAY_OUT_RIGHT', 8: 'HIGHWAY_OUT_STRAIGHT', 9: 'FORK_LEFT', 10: 'FORK_RIGHT', 11: 'TRIPLE_FORK_LEFT', 12: 'TRIPLE_FORK_RIGHT', 13: 'TRIPLE_FORK_STRAIGHT', 14: 'OVERPASS', 15: 'UNDERPASS' };
const STATE = { 0: 'INACTIVE', 1: 'CALCULATING_ROUTE', 2: 'ACTIVE' };
const PROVIDER = { 0: 'NONE', 1: 'CAR_PLAY', 2: 'ANDROID_AUTO', 3: 'CAR_LIFE', 4: 'OTHER' };
const SIDE = { 1: 'LEFT', 2: 'RIGHT' };
const UNIT_M = { KM: 1000, METER: 1, MILE_UK: 1609.344, MILE_US: 1609.344, YARD: 0.9144, FEET: 0.3048 };
const UNIT = { 0: 'NONE', 1: 'KM', 2: 'MILE_UK', 3: 'MILE_US', 4: 'METER', 5: 'YARD', 6: 'FEET' };
const PROVIDER_NAME = { CAR_PLAY: 'CarPlay', ANDROID_AUTO: 'Android Auto', CAR_LIFE: 'CarLife', OTHER: 'another app', NONE: 'the BMW navigation' };

/** An enum's name, whether it came as its number or its name. */
function en(v, names) {
    if (v && typeof v === 'object') v = v.value !== undefined ? v.value : v.name;   // { value } / { name } wrappers
    if (typeof v === 'number') return names[v] || String(v);
    return v === undefined || v === null ? '' : String(v);
}
/** A union's member: [name, value], or [null, null]. Takes { member: v }, { type|name: member, value: v }. */
function member(u) {
    if (!u || typeof u !== 'object') return [null, null];
    if (typeof u.type === 'string' && 'value' in u) return [u.type, u.value];
    const ks = Object.keys(u);
    return ks.length === 1 ? [ks[0], u[ks[0]]] : [null, null];
}
/** A field's value: the struct itself, or wrapped in the field's name / { value }. */
function unwrap(v, field) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (field && field in v && Object.keys(v).length === 1) return v[field];
        if ('value' in v && Object.keys(v).length === 1) return v.value;
    }
    return v;
}
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const DIR = { STRAIGHT_ON: 'straight', LEFT: 'left', SLIGHT_LEFT: 'slightLeft', HARD_LEFT: 'sharpLeft', UTURN_LEFT: 'uturnLeft',
    RIGHT: 'right', SLIGHT_RIGHT: 'slightRight', HARD_RIGHT: 'sharpRight', UTURN_RIGHT: 'uturnRight' };
const BRANCH_KIND = { BRANCH_LEFT: 'slightLeft', BRANCH_RIGHT: 'slightRight', FORK_LEFT: 'slightLeft', FORK_RIGHT: 'slightRight',
    TRIPLE_FORK_LEFT: 'slightLeft', TRIPLE_FORK_RIGHT: 'slightRight', TRIPLE_FORK_STRAIGHT: 'straight',
    HIGHWAY_IN_LEFT: 'mergeLeft', HIGHWAY_IN_RIGHT: 'mergeRight', HIGHWAY_IN_STRAIGHT: 'straight',
    HIGHWAY_OUT_LEFT: 'exitLeft', HIGHWAY_OUT_RIGHT: 'exitRight', HIGHWAY_OUT_STRAIGHT: 'straight',
    OVERPASS: 'straight', UNDERPASS: 'straight' };
const dir = (v) => DIR[en(v, TURN)] || null;

/**
 * Metres in a FormattedDistance: its text in its unit ("60" METER, "1.2" KM) - what the phone app itself says.
 * rawDistance only when there is no text: on the car it is not always metres (the phone's manoeuvres carry
 * "60" METER with raw 1, and " " NONE with raw 500 for a manoeuvre with no distance yet). Null without either.
 */
function metres(fd) {
    if (!fd || typeof fd !== 'object') return null;
    const unit = en(fd.unit, UNIT), k = UNIT_M[unit], txt = String(fd.distance === undefined || fd.distance === null ? '' : fd.distance).trim();
    const n = parseFloat(txt.replace(',', '.'));
    if (txt && k && isFinite(n) && n >= 0) return n * k;
    if (!txt && k) { const raw = Number(fd.rawDistance); if (isFinite(raw) && raw > 0) return raw; }
    if (!txt && !k && unit !== 'NONE') { const raw = Number(fd.rawDistance); if (isFinite(raw) && raw > 0) return raw; }   // no unit given at all
    return null;
}

/** A Description's road name (its texts) and number (its first icon's text). */
function describe(d) {
    const out = { road: '', shield: '', shields: [] }, words = [];
    arr(d && d.elements).forEach((e) => {
        const [k, v] = member(e);
        if (k === 'text' && typeof v === 'string' && v.trim()) words.push(v.trim());
        else if (k === 'icon' && v && typeof v.text === 'string' && v.text.trim()) { out.shields.push(v.text.trim()); if (!out.shield) out.shield = v.text.trim(); }
        else if (k === 'spacer' && en(v, { 3: 'NEW_LINE', 4: 'SLASH' }) === 'SLASH') words.push('/');
    });
    out.road = words.join(' ').replace(/\s*\/\s*$/, '');
    return out;
}

/**
 * Turn angle of a roundabout exit (0 straight on, 90 right, -90 left, 180 back), from the angle driven round the
 * ring (exitAngle, read as degrees from the way in, in the direction of travel) or else the exit number.
 */
function roundaboutTurn(r) {
    const ang = Number(r.exitAngle), ccw = en(r.driveDirection, SIDE) !== 'LEFT';   // RIGHT-hand traffic goes round counter-clockwise
    if (isFinite(ang) && ang > 0 && ang <= 360) return ccw ? 180 - ang : ang - 180;
    const n = Math.max(1, Math.min(4, Number(r.exitNumber) || 2));
    return [90, 0, -90, 180][n - 1] * (ccw ? 1 : -1);
}

/** The card's manoeuvre from a conclusiveDart: { maneuver, exit?, turnDeg?, distanceM, road, shield } or null. */
function fromDart(dart) {
    const [k, m] = member(dart && dart.maneuver);
    if (!k || !m) return null;
    let maneuver = null;
    const g = {};
    if (k === 'intersection') maneuver = dir(m.direction) || 'straight';
    else if (k === 'branch') maneuver = BRANCH_KIND[en(m.branchType, BRANCH)] || 'straight';
    else if (k === 'roundabout') {
        maneuver = 'roundabout';
        const dd = en(m.driveDirection, SIDE);
        // the traffic side: the navigation's own for this roundabout; without one, sideFor() fills it in
        g.rb = { exitAngle: m.exitAngle, exitNumber: m.exitNumber, side: dd === 'LEFT' || dd === 'RIGHT' ? dd : '' };
        g.turnDeg = roundaboutTurn(m);
        g.exitNumber = Number(m.exitNumber) || undefined;
        g.clockwise = dd === 'LEFT';
    } else if (k === 'destinationManeuver') maneuver = 'arrive';
    else return null;                              // tunnels, POIs, traffic, lane rows: not a manoeuvre of their own
    const d = describe(m.description);
    return Object.assign(g, { maneuver, distanceM: metres(m.formattedDistance), road: d.road, shield: d.shield, shields: d.shields.length ? d.shields : undefined });
}

/**
 * A roundabout's way round for the traffic side: forced (setting "trafficSide" left / right) over everything;
 * else the navigation's own for it; else side (the car's: CCP trafficSide, else its country).
 */
function sideFor(g, side, forced) {
    if (!g || g.maneuver !== 'roundabout' || !g.rb) return g;
    const use = forced || g.rb.side || side || 'RIGHT';
    g.sideSrc = forced ? 'setting' : g.rb.side ? 'navigation' : side ? 'car position' : 'default';
    g.turnDeg = roundaboutTurn({ exitAngle: g.rb.exitAngle, exitNumber: g.rb.exitNumber, driveDirection: use });
    g.clockwise = use === 'LEFT';
    return g;
}

/** The card's lanes from currentLaneGuiding: the nearest row, left to right. */
function fromLanes(clg) {
    const row = arr(clg && clg.rows)[0];
    if (!row) return [];
    return arr(row.lanes).map((l) => {
        const follow = [l.directionToFollow].concat(arr(l.directionsToFollow)).map(dir).filter(Boolean);
        const all = follow.concat(arr(l.otherDirections).map(dir).filter(Boolean));
        const dirs = all.filter((x, i) => all.indexOf(x) === i);
        const lit = l.isHighlighted === true || l.isHighlighted === 1;
        return { dirs: dirs.length ? dirs : ['straight'], on: lit ? (follow.length ? follow : dirs).filter((x, i, a) => a.indexOf(x) === i) : [] };
    });
}

/**
 * The route without its turns: a phone app that guides but sends no turn data (projectedGuidanceMetadataAvailable
 * false) can still give the head unit its destination - the arrival time and the distance left, from
 * ProjectedModeGuiding.waypoints or Guidance.finalDestinationInfo. A card with the destination flag, then.
 */
function routeOnly(f) {
    const wps = arr(f.pmWaypoints).filter((w) => w && typeof w === 'object');
    const cand = [wps.filter((w) => w.isCheckeredFlag === true)[0], wps[wps.length - 1], f.finalDestinationInfo].filter(Boolean);
    for (const d of cand) {
        let m = metres(d.formattedDistance);
        const raw = Number(d.distanceFromCurrentToFinalDestination);
        if (!(m > 0) && isFinite(raw) && raw > 0) m = raw;
        const tm = d.estimatedArrivalTime && d.estimatedArrivalTime.time;
        const eta = tm && tm.invalid !== true && isFinite(tm.hour) && isFinite(tm.minute) && (tm.hour || tm.minute)
            ? tm.hour + ':' + String(tm.minute).padStart(2, '0') : '';
        if (m > 0 || eta) return { maneuver: 'arrive', distanceM: m > 0 ? m : null, road: eta ? 'Arrival ' + eta : 'Destination', shield: '', lanes: [], routeOnly: true };
    }
    return null;
}

/**
 * The view GuidanceEventList.queryContent is asked for: from the car (CCP) to the final destination, the next few
 * manoeuvres, destinations and lane guidings. names: enums as their names (else their numbers) - which the native
 * module wants on the way in is not known yet, so both are tried.
 */
function viewConfig(names) {
    const e = (name, num) => (names ? name : num);
    const at = (name, num) => ({ anchorPoint: { standardReferencePoint: e(name, num) }, offsets: [] });
    return {
        viewport: {
            startPoint: at('CCP', 1), maxElementCount: 6, endPoints: [at('FINAL_DESTINATION', 2)],
            includedTypes: [e('INCLUDE_ACTIVE_MANEUVERS', 1), e('INCLUDE_DESTINATIONS', 2), e('INCLUDE_LANE_GUIDINGS', 0)],
        },
        options: [], minimumUpdateIntervalMs: QUERY_MS, segmentItemRasterLength: 0,
    };
}

/** The value of key somewhere inside v (results may come wrapped in their output's or method's name). */
function dig(v, key, depth) {
    if (!v || typeof v !== 'object' || (depth || 0) > 4) return undefined;
    if (key in v) return v[key];
    for (const k of Object.keys(v)) { const r = dig(v[k], key, (depth || 0) + 1); if (r !== undefined) return r; }
    return undefined;
}

/**
 * The next manoeuvre from a queryContent answer: { viewContent: [{ eventsInView: [GuidanceEventUnion] }],
 * currentDistances: { carDistanceToFinalDestination } }.
 *
 * As the car gives a phone's guidance (Google Maps over CarPlay, seen 2026-11): two manoeuvres - the one the
 * phone's banner shows, its distance as text ("60" METER, counting down), and the one after it, with no distance
 * (" " NONE). currentDistances are 0 / -1 then. So: the first manoeuvre with a distance is the card; just past a
 * turn the phone has "straight on, 0 m" there - then the turn after it, without a number. The car's distance less
 * the event's (when the car gives its own) stands in for a missing distance. The lanes: those listed before.
 */
function fromEvents(res) {
    const vc = arr(dig(res, 'viewContent'));
    const events = vc.reduce((a, v) => a.concat(arr(v && v.eventsInView)), []);
    const car = Number((dig(res, 'currentDistances') || {}).carDistanceToFinalDestination);
    const found = [];
    let lanes = null;
    for (const ev of events) {
        const [k, m] = member(ev);
        if (!k || !m) continue;
        if (k === 'laneGuiding') { lanes = fromLanes({ rows: [m] }); continue; }
        const g = fromDart({ maneuver: ev });
        if (!g) continue;
        const d = Number(m.distanceToDestination), fd = m.formattedDistance || {};
        g.distSrc = 'panel: "' + (fd.distance === undefined ? '' : fd.distance) + '" ' + en(fd.unit, UNIT) + ', raw ' + fd.rawDistance;
        if (g.distanceM === null && isFinite(car) && car > 0 && isFinite(d) && car >= d) {
            g.distanceM = car - d;
            g.distSrc = 'car ' + car + ' - event toDest ' + d + ' (' + g.distSrc + ')';
        }
        g.lanes = lanes || [];
        lanes = null;
        found.push(g);
    }
    const i = found.findIndex((g) => g.distanceM !== null);
    if (i < 0) return found.filter((g) => g.maneuver !== 'straight')[0] || found[0] || null;
    const cur = found[i];
    if (cur.maneuver === 'straight' && cur.distanceM <= 5) {
        const next = found.slice(i + 1).filter((g) => g.maneuver !== 'straight')[0];
        if (next) return Object.assign({}, next, { distanceM: null, distSrc: 'after "straight on, ' + cur.distanceM + ' m": the next turn, no distance yet' });
    }
    return cur;
}

/** One line a listed event, for the app's page: kind, direction, distances, road. */
function eventLines(res) {
    const vc = arr(dig(res, 'viewContent'));
    const car = Number((dig(res, 'currentDistances') || {}).carDistanceToFinalDestination);
    const lines = ['events: car to destination ' + (isFinite(car) ? Math.round(car) + ' m' : '?')];
    vc.reduce((a, v) => a.concat(arr(v && v.eventsInView)), []).slice(0, 8).forEach((ev, i) => {
        const [k, m] = member(ev);
        if (!k || !m) { lines.push(' ' + i + ' ?' + brief(ev, 80)); return; }
        const fd = m.formattedDistance || {}, dd = Number(m.distanceToDestination);
        const what = k === 'intersection' ? en(m.direction, TURN) : k === 'branch' ? en(m.branchType, BRANCH)
            : k === 'roundabout' ? 'exit ' + m.exitNumber + ' angle ' + m.exitAngle : k === 'laneGuiding' ? arr(m.lanes).length + ' lanes' : '';
        const dsc = describe(m.description);
        lines.push(' ' + i + ' ' + k + ' ' + what + ' | fd ' + (fd.distance || '') + ' ' + en(fd.unit, UNIT) + ' raw ' + fd.rawDistance
            + ' | toDest ' + (isFinite(dd) ? Math.round(dd) : '?') + (isFinite(car) && isFinite(dd) ? ' (car+' + Math.round(car - dd) + ')' : '')
            + (dsc.road || dsc.shield ? ' | ' + [dsc.shield, dsc.road].filter(Boolean).join(' ') : ''));
    });
    return lines;
}

/** The guidance (source.js shape) from the fields as they are now; null when the navigation is not guiding. */
function combine(f, opts) {
    opts = opts || {};
    if (en(f.guidanceState, STATE) !== 'ACTIVE') {
        // the phone guides without turn data in Guidance: the navigation's event list, else its destination only
        if (!opts.phoneGuiding) return null;
        const pv = en(f.guidingProvider, PROVIDER);
        // the destination alone only while a phone app says it guides: with NONE (Waze, not supported) the car still answers
        // the last app's waypoints, an old route
        const r = (f.events && Object.assign({}, f.events)) || (pv && pv !== 'NONE' ? routeOnly(f) : null);
        if (!r) return null;
        // phoneRoute: the phone sent its route too (waypoints: arrival, distance left) - Apple Maps and Google Maps
        // do; turns without one were handed in by another program (Waze on cluster's HUD option, for Waze)
        // the lanes: the event list has none for a phone (no laneGuiding events seen), but the phone's lane hint
        // (Google Maps, seen 2026-11) comes as currentLaneGuiding - in Guidance and in ProjectedModeGuiding
        if (!r.routeOnly && !(r.lanes && r.lanes.length)) {
            const ln = fromLanes(f.currentLaneGuiding);
            r.lanes = ln.length ? ln : fromLanes(f.pmLanes);
        }
        return Object.assign(r, { from: (PROVIDER_NAME[pv] && pv !== 'NONE' ? PROVIDER_NAME[pv] : 'CarPlay') + (r.routeOnly ? ', route only' : ', event list'),
            t: f.t || 0, phoneRoute: !!routeOnly({ pmWaypoints: f.pmWaypoints }) });
    }
    const provider = en(f.guidingProvider, PROVIDER) || 'NONE';
    if (opts.phoneOnly && (provider === 'NONE' || provider === '')) return null;
    const g = fromDart(f.conclusiveDart);
    if (!g) return null;
    const ni = f.nextIntersection;
    if (ni && typeof ni === 'object') {
        if (g.distanceM === null) g.distanceM = metres(ni.distance);
        if (!g.road && !g.shield) Object.assign(g, describe(ni.intersection));
    }
    g.lanes = fromLanes(f.currentLaneGuiding);
    g.from = PROVIDER_NAME[provider] || provider;
    g.t = f.t || 0;
    return g;
}

/**
 * mkdir -p that works on the unit's Node 8: its fs.mkdirSync has no { recursive } (it ignores the option and throws
 * EEXIST for a folder that is there).
 */
function mkdirp(d) {
    try { fs.mkdirSync(d); } catch (e) {
        if (e.code === 'EEXIST') return;
        if (e.code !== 'ENOENT' || path.dirname(d) === d) throw e;
        mkdirp(path.dirname(d));
        try { fs.mkdirSync(d); } catch (e2) { if (e2.code !== 'EEXIST') throw e2; }
    }
}

const ascii = (t) => String(t).replace(/[^\x20-\x7e]/g, '?');
/** JSON for the log and the raw file: no icon data, short. */
const brief = (v, n) => {
    let s;
    try { s = JSON.stringify(v, (k, x) => (k === 'iconHandle' || k === 'serviceIcons' || k === 'symbolData' ? '[icon]' : x)); } catch (e) { s = String(v); }
    return n && s && s.length > n ? s.slice(0, n) + '...' : s;
};

/**
 * The event log: one JSON line a record in dir/cluster_nav_card-events.jsonl, the file moved to .1.jsonl past MAX_LOG
 * bytes (4 MB: about half an hour of driving). A record: { t, at, kind, ... } - kind 'query' (a queryContent answer whole, and what the card took from
 * it), 'error', 'field' (a notified field's value) or 'card' (the card's guidance when it changes).
 */
const MAX_LOG = 4000000;
function eventLog(dir, now, max) {
    max = max || MAX_LOG;
    const file = path.join(dir || '/dev/shm/nav-card', 'cluster_nav_card-events.jsonl');
    let n = 0, size = -1, err = '';
    const strip = (k, x) => (k === 'iconHandle' || k === 'serviceIcons' || k === 'symbolData' ? '[icon]' : x);
    return {
        file,
        write(rec) {
            try {
                if (size < 0) { mkdirp(path.dirname(file)); try { size = fs.statSync(file).size; } catch (e) { size = 0; } }
                const t = now(), line = JSON.stringify(Object.assign({ t, at: new Date(t).toISOString() }, rec), strip) + '\n';
                if (size + line.length > max) { try { fs.renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl')); } catch (e) { /* none yet */ } size = 0; }
                fs.appendFileSync(file, line);
                size += line.length; n++; err = '';
            } catch (e) { err = String(e.message || e); }
        },
        status: () => (err ? 'not written: ' + err.slice(0, 60) : n + ' record(s) in ' + file),
    };
}

/**
 * Subscribe to the navigation's guidance. ctx: signals, log, settings ("provider": phone | any).
 * now() -> guidance or null; status() -> { source: 'car', detail, active } for the app's page.
 */
function headunit(ctx, opts) {
    opts = opts || {};
    const { log } = ctx, sig = opts.signals || ctx.signals, now = opts.now || Date.now;
    const rawFile = opts.rawFile || RAW_FILE;
    const f = { t: 0 }, logged = {};
    const seen = {};                 // 'Iface.field' -> { n, v } : every value that came, for the page
    let sub = null, cpSub = null, pmSub = null, metadata = null, cpActive = null, error = '', stopped = false, rawTimer = null, qTimer = null;
    let evLines = [];
    let ccpSub = null, ccpCountry = '', ccpSide = '';
    /** The car's traffic side: CCP's event, else its country; '' when neither came. */
    const carSide = () => ccpSide || sideOfCountry(ccpCountry);
    const forcedSide = () => { const v = ctx.settings && ctx.settings.get('trafficSide'); return v === 'left' ? 'LEFT' : v === 'right' ? 'RIGHT' : ''; };
    const logOn = () => !ctx.settings || ctx.settings.get('eventLog') !== 'off';
    const elog = opts.eventLog || eventLog(opts.logDir || ctx.dataDir, now);
    let lastAns = '', lastAnsT = -Infinity, lastCard = '';
    const rec = (r) => { if (logOn()) elog.write(r); };
    const bool = (v) => (v === true || v === 1 ? true : v === false || v === 0 ? false : null);   // anything else: unknown

    const writeRaw = () => {
        rawTimer = null;
        try {
            mkdirp(path.dirname(rawFile));
            const tmp = rawFile + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ t: now(), fields: f, seen }, (k, x) => (k === 'iconHandle' ? '[icon]' : x), 1));
            fs.renameSync(tmp, rawFile);
        } catch (e) { /* /dev/shm not there (a host preview) */ }
    };
    const note = (iface, name, v) => {
        const key = iface.split('.').pop() + '.' + name, e = seen[key] || (seen[key] = { n: 0, v: null });
        e.n++; e.v = v;
        if (e.n <= 3) log.info('headunit ' + key + ' #' + e.n + ': ' + brief(v, 500));
        if (!/^GuidanceEventList\./.test(key)) rec({ kind: 'field', key, n: e.n, v });
        if (!rawTimer && !stopped) rawTimer = (opts.setTimeout || setTimeout)(writeRaw, 1000);
    };
    const field = (name) => (v) => {
        const x = unwrap(v, name);
        if (name === 'guidingProvider' && f.guidingProvider !== undefined && en(x, PROVIDER) !== en(f.guidingProvider, PROVIDER)) {
            f.pmWaypoints = null; f.finalDestinationInfo = null; f.events = null; f.pmLanes = null;      // another app's route: not the old one
        }
        f[name] = x; f.t = now();
        note(GUIDANCE, name, v);
    };
    const handlers = {};
    ['guidanceState', 'guidingProvider', 'conclusiveDart', 'currentLaneGuiding', 'nextIntersection', 'finalDestinationInfo'].forEach((n) => { handlers[n] = field(n); });

    if (sig && sig.watch) {
        sig.watch(GUIDANCE, 'Main_Instance', handlers, log).then((s) => {
            sub = s;
            if (s.error) { error = s.error; log.warn('headunit: ' + GUIDANCE + ': ' + s.error); }
            if (stopped) s.shutdown();
        }, (e) => { error = String(e); });
        sig.watch(CARPLAY, 'CarPlayManagerInst1', {
            projectedGuidanceMetadataAvailable: (v) => { note(CARPLAY, 'projectedGuidanceMetadataAvailable', v); metadata = bool(unwrap(v, 'projectedGuidanceMetadataAvailable')); },
            projectedGuidanceActive: (v) => {
                note(CARPLAY, 'projectedGuidanceActive', v);
                cpActive = bool(unwrap(v, 'projectedGuidanceActive'));
                // the phone stopped guiding (or another app took over): its last route is gone with it - the
                // destination card must not show the old app's arrival under the next one (Waze sends none)
                if (cpActive === false) { f.pmWaypoints = null; f.finalDestinationInfo = null; f.events = null; f.pmLanes = null; evLines = []; }
            },
        }, log).then((s) => { cpSub = s; if (stopped) s.shutdown(); }, () => {});
        // what the phone hands the navigation (diagnostics only: the manoeuvres themselves arrive there as method calls)
        const pm = {};
        ['activeRouteChange', 'currentRoad', 'currentLaneGuiding', 'waypoints'].forEach((n) => { pm[n] = (v) => note(PROJECTED, n, v); });
        pm.currentLaneGuiding = (v) => { note(PROJECTED, 'currentLaneGuiding', v); f.pmLanes = unwrap(v, 'currentLaneGuiding'); f.t = now(); };
        pm.waypoints = (v) => { note(PROJECTED, 'waypoints', v); f.pmWaypoints = unwrap(v, 'waypoints'); f.t = now(); };
        sig.watch(PROJECTED, 'Main_Instance', pm, log).then((s) => { pmSub = s; if (stopped) s.shutdown(); }, () => {});
        // where the car is: its traffic side (an event, on change) and its country (a field)
        sig.watch(CCP, '1', {
            countryCode: (v) => { note(CCP, 'countryCode', v); ccpCountry = String(unwrap(v, 'countryCode') || ''); },
        }, log).then((s) => {
            ccpSub = s;
            if (stopped) return s.shutdown();
            if (s.proxy && sig.on) {
                return sig.on(s.proxy, 'trafficSide', (v) => {
                    note(CCP, 'trafficSide', v);
                    const d = en(dig(v, 'direction') !== undefined ? dig(v, 'direction') : v, { 0: 'LEFT_HAND_SIDE', 1: 'RIGHT_HAND_SIDE' });
                    ccpSide = d === 'LEFT_HAND_SIDE' ? 'LEFT' : d === 'RIGHT_HAND_SIDE' ? 'RIGHT' : ccpSide;
                }, log).catch(() => {});
            }
            return undefined;
        }, () => {});
        // the event list, asked while the phone guides and Guidance has no manoeuvre
        let evProxy = null, names = null, busy = false, evErr = '';
        const evOpen = () => {
            if (evProxy || !sig.proxy) return;
            evProxy = 'opening';
            sig.proxy(EVENTS, 'Main_Instance').then((p) => { evProxy = p; note(EVENTS, 'proxy', 'ok'); },
                (e) => { evProxy = null; evErr = String(e); note(EVENTS, 'proxy', evErr.slice(0, 120)); });
        };
        const ask = (asNames) => sig.call(evProxy, 'queryContent', { viewConfigs: [viewConfig(asNames)] }, 3000);
        const query = () => {
            if (stopped || busy || cpActive !== true || en(f.guidanceState, STATE) === 'ACTIVE') { if (cpActive === false) f.events = null; return; }
            if (!evProxy) return evOpen();
            if (evProxy === 'opening') return;
            busy = true;
            const tryOrder = names === null ? [true, false] : [names];
            const attempt = (i) => ask(tryOrder[i]).then((res) => {
                if (names === null) { names = tryOrder[i]; log.info('headunit: queryContent takes enums as ' + (names ? 'names' : 'numbers')); }
                note(EVENTS, 'queryContent', res);
                f.events = fromEvents(res); f.t = now();
                evLines = eventLines(res);
                // the whole answer when it changed (or every 5 s), and what the card took from it
                const js = brief(res);
                if (js !== lastAns || now() - lastAnsT >= 5000) {
                    lastAns = js; lastAnsT = now();
                    const c = f.events;
                    rec({ kind: 'query', enums: names ? 'names' : 'numbers', guidanceState: en(f.guidanceState, STATE), cpActive, metadata,
                        card: c ? { maneuver: c.maneuver, distanceM: c.distanceM, distSrc: c.distSrc, road: c.road, lanes: c.lanes.length } : null,
                        waypointM: (routeOnly(f) || {}).distanceM, lines: evLines, answer: res });
                }
            }, (e) => {
                if (i + 1 < tryOrder.length) return attempt(i + 1);
                f.events = null; evErr = String(e);
                note(EVENTS, 'queryContent error', evErr.slice(0, 160));
                rec({ kind: 'error', what: 'queryContent', error: evErr });
                return undefined;
            });
            attempt(0).then(() => { busy = false; }, () => { busy = false; });
            return undefined;
        };
        qTimer = (opts.setInterval || setInterval)(query, QUERY_MS);
        if (opts.queryNow) opts.queryNow(query);
    } else error = 'no SOME/IP';

    const phoneOnly = () => !ctx.settings || ctx.settings.get('provider') !== 'any';
    const cur = () => {
        const g = sideFor(combine(f, { phoneOnly: phoneOnly(), phoneGuiding: cpActive === true }), carSide(), forcedSide());
        const key = g ? [g.maneuver, g.distanceM === null ? '' : Math.round(g.distanceM), g.road, g.from].join('|') : '';
        if (key !== lastCard) { lastCard = key; rec({ kind: 'card', card: g ? { maneuver: g.maneuver, distanceM: g.distanceM, road: g.road, shield: g.shield, from: g.from, distSrc: g.distSrc, lanes: (g.lanes || []).length } : null }); }
        return g;
    };
    return {
        now: cur,
        fields: () => f,
        trafficSide: () => ({ side: forcedSide() || carSide() || 'RIGHT', from: forcedSide() ? 'setting' : ccpSide ? 'car position' : ccpCountry ? 'country ' + ccpCountry : 'default' }),
        logStatus: () => (logOn() ? elog.status() : 'off (Settings > Event log)'),
        /** The last event-list answer, one line an event (while the card comes from it). */
        events: () => (f.events && en(f.guidanceState, STATE) !== 'ACTIVE' ? evLines.map(ascii) : []),
        /** What came from the car, one line a field: name, how many values, the last one (short, ASCII). */
        diag: () => {
            const order = (k) => (k.startsWith('GuidanceEventList') ? 0 : k.startsWith('ProjectedModeGuiding') ? 1 : k.startsWith('CarPlay') ? 2 : 3);
            return [[GUIDANCE, sub], [CARPLAY, cpSub], [PROJECTED, pmSub]]
                .map(([i, x]) => i.split('.').pop() + ' ' + (!x ? 'connecting' : x.error ? 'not reachable (' + String(x.error).slice(0, 40) + ')' : x.available ? 'available' : 'not available'))
                .join(',  ')
                .split('\n')
                .concat(evLines.map(ascii))
                .concat(Object.keys(seen).filter((k) => !(evLines.length && k === 'GuidanceEventList.queryContent'))
                    .sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))
                    .map((k) => k + ' x' + seen[k].n + ' = ' + ascii(brief(seen[k].v, 170))));
        },
        status() {
            const g = cur(), st = en(f.guidanceState, STATE), pv = en(f.guidingProvider, PROVIDER);
            let detail;
            if (g && g.routeOnly) detail = 'the phone guides but sends no turns: arrival and distance only';
            else if (g && f.events && !(en(f.guidanceState, STATE) === 'ACTIVE')) detail = 'guiding (' + g.from + ')';
            else if (g) detail = 'guiding (' + g.from + ')';
            else if (cpActive === true && !f.events && seen['GuidanceEventList.queryContent'])
                detail = 'the phone guides but sends the car nothing: no turns, no route (Waze: not supported)';
            else if (error && !(sub && sub.available)) detail = 'navigation not reachable: ' + error.slice(0, 60);
            else if (!sub || !sub.available) detail = 'waiting for the navigation';
            else if (st === 'ACTIVE' && phoneOnly() && (pv === 'NONE' || !pv)) detail = 'the BMW navigation guides (Settings > Guidance from)';
            else if (st === 'ACTIVE') detail = 'guiding, no manoeuvre yet';
            else if (st === 'CALCULATING_ROUTE') detail = 'calculating the route';
            else if (!seen['Guidance.guidanceState']) detail = 'the navigation has sent no guidance state yet';
            else detail = 'the navigation says ' + (st || '?');
            if (!g || g.routeOnly) {
                const cp = [];
                if (cpActive !== null) cp.push('CarPlay guiding: ' + (cpActive ? 'yes' : 'no'));
                if (metadata !== null) cp.push('turn data: ' + (metadata ? 'yes' : 'no'));
                if (cp.length) detail += '   ·   ' + cp.join(', ');
            }
            return { source: 'car', detail, active: !!g };
        },
        stop() {
            stopped = true;
            if (rawTimer) (opts.clearTimeout || clearTimeout)(rawTimer);
            if (qTimer) (opts.clearInterval || clearInterval)(qTimer);
            if (sub) sub.shutdown();
            if (cpSub) cpSub.shutdown();
            if (ccpSub) ccpSub.shutdown();
            if (pmSub) pmSub.shutdown();
        },
    };
}

module.exports = { sideFor, sideOfCountry, CCP, mkdirp, headunit, combine, routeOnly, fromEvents, eventLines, eventLog, viewConfig, EVENTS, fromDart, fromLanes, describe, metres, roundaboutTurn, en, member, unwrap, GUIDANCE, CARPLAY, PROJECTED, RAW_FILE };
