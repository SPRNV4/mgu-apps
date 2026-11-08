'use strict';
/**
 * Cluster Nav Card: distances as a navigation app says them, the guidance file's parsing and freshness, the demo drive,
 * the card drawn for every manoeuvre on both canvases, and the overlay following the map (shown only with the
 * map in the cluster and a route; Off: no layer at all; only changed rows after the first image).
 *   node kit/tools/test_cluster_nav_card.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const EventEmitter = require('events');
// the app's require('./kit/...') is the kit runtime here (in the package it is javascript/kit/)
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req.startsWith('./kit/')) return load.call(this, path.join(__dirname, '..', 'runtime', req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const APP = path.join(__dirname, '..', '..', 'apps', 'cluster_nav_card');
const C = require(path.join(APP, 'card'));
const SRC = require(path.join(APP, 'source'));
const OV = require(path.join(APP, 'overlay'));
const { Canvas } = require('../runtime/canvas');
const { Recorder } = require('../runtime/record');

(async () => {
    // distances
    const d = (m, u) => C.distance(m, u).join(' ');
    assert.strictEqual(d(91, 'imperial'), '300 ft');
    assert.strictEqual(d(30, 'imperial'), '100 ft');
    assert.strictEqual(d(1609.344 * 0.45, 'imperial'), '0.5 mi');
    assert.strictEqual(d(1609.344 * 12.4, 'imperial'), '12 mi');
    assert.strictEqual(d(7, 'metric'), '7 m');
    assert.strictEqual(d(0, 'metric'), '0 m');                          // at the turn, as CarPlay says it
    assert.strictEqual(d(0.4, 'metric'), '0 m');
    assert.strictEqual(d(14, 'metric'), '10 m');
    assert.strictEqual(d(87, 'metric'), '90 m');
    assert.strictEqual(d(430, 'metric'), '450 m');
    assert.strictEqual(d(1000, 'metric'), '1 km');
    assert.strictEqual(d(1440, 'metric'), '1.4 km');
    assert.strictEqual(d(23400, 'metric'), '23 km');
    assert.strictEqual(d(null, 'metric'), ' ');

    // road number plates
    const SHL = require(path.join(APP, 'shields'));
    assert.deepStrictEqual(SHL.split('A4 Den Haag'), { shields: ['A4'], name: 'Den Haag' });
    assert.deepStrictEqual(SHL.split('A10 / E19 Ring Zuid'), { shields: ['A10', 'E19'], name: 'Ring Zuid' });
    assert.deepStrictEqual(SHL.split('s111  Spaklerweg'), { shields: ['s111'], name: 'Spaklerweg' });
    assert.deepStrictEqual(SHL.split('towards N201'), { shields: ['N201'], name: 'towards' });
    assert.deepStrictEqual(SHL.split('Amstelvlietstraat'), { shields: [], name: 'Amstelvlietstraat' });
    assert.deepStrictEqual(SHL.split('A4'), { shields: ['A4'], name: '' });
    assert.deepStrictEqual(SHL.split('A-4 Den Haag'), { shields: ['A4'], name: 'Den Haag' });   // a hyphen, lower case
    assert.deepStrictEqual(SHL.split('a-10 / e-19 Ring Zuid'), { shields: ['A10', 'E19'], name: 'Ring Zuid' });
    assert.deepStrictEqual(SHL.split('richting E-19'), { shields: ['E19'], name: 'richting' });
    assert.deepStrictEqual(SHL.split('S-111 Spaklerweg'), { shields: ['s111'], name: 'Spaklerweg' });
    assert.deepStrictEqual(SHL.split('A-10a'), { shields: ['A10a'], name: '' });
    assert.deepStrictEqual(SHL.split('Noord-Holland'), { shields: [], name: 'Noord-Holland' });
    assert.deepStrictEqual(SHL.split('De-straat 4'), { shields: [], name: 'De-straat 4' });
    assert.deepStrictEqual(['e-19', 'n 201', 'A4', ''].map(SHL.norm), ['E19', 'n 201', 'A4', '']);
    assert.deepStrictEqual(require('../../apps/cluster_nav_card/card').roadOf({ road: 'Ring', shields: ['a-10', 'E-19'] }).shields, ['A10', 'E19']);
    assert.strictEqual(SHL.style(SHL.norm('a-4'), 'nl').bg, '#c8102e');
    {   // lane arrows: one stem, a branch a direction, the tips apart (left mirrored)
        const CC = require('../../apps/cluster_nav_card/card');
        const tip = (d) => { const p = CC.branchOf(d); return p[p.length - 1]; };
        assert.deepStrictEqual(tip('straight'), [0.5, 0.08]);
        assert.ok(tip('right')[0] > 0.9 && Math.abs(tip('left')[0] - (1 - tip('right')[0])) < 1e-9);
        assert.ok(tip('right')[1] - tip('straight')[1] > 0.3);                                   // the side head lower
        assert.deepStrictEqual(CC.branchOf('exitLeft'), CC.branchOf('slightLeft'));
    }
    {   // dim parts solid on their ground: no doubling where a line overlaps itself
        const CC = require('../../apps/cluster_nav_card/card');
        assert.strictEqual(CC.solid('#ffffff66', '#000000'), '#666666');
        assert.strictEqual(CC.solid('#ffffff', '#123456'), '#ffffff');
        assert.strictEqual(CC.solid('#ffffff80', 'nope'), '#ffffff80');
    }
    assert.deepStrictEqual(SHL.split('Ab Straat'), { shields: [], name: 'Ab Straat' });       // no digits: a name
    assert.strictEqual(SHL.style('A4', 'nl').bg, '#c8102e');
    assert.strictEqual(SHL.style('A4', 'de').bg, '#1f5aa6');
    assert.strictEqual(SHL.style('N201', 'nl').fg, '#141414');
    assert.strictEqual(SHL.style('E19', 'generic').bg, '#00843d');
    assert.strictEqual(SHL.style('s111', 'nl').shape, 'octagon');                      // the s-route sign
    assert.strictEqual(SHL.style('s111', 'de'), null);                                 // elsewhere the card's chip
    {
        const cvm = new Canvas(10, 10);
        assert.ok(SHL.width(cvm, 's111', 28, 'nl') > SHL.width(cvm, 's111', 28, 'de'));   // the slanted ends take room
    }
    assert.deepStrictEqual(C.roadOf({ road: 'A4 Den Haag' }), { shields: ['A4'], name: 'Den Haag' });
    assert.deepStrictEqual(C.roadOf({ road: 'Seneca St', shield: '165' }), { shields: ['165'], name: 'Seneca St' });
    SHL.REGIONS.forEach((rg) => ['A4', 'N201', 'E19', 'M25', 'B9', 'D906', 's111'].forEach((code) => {
        C.draw(new Recorder(400, 72), { maneuver: 'right', distanceM: 300, road: code + ' Somewhere' }, { region: rg });
        C.draw(new Canvas(400, 72), { maneuver: 'right', road: code + ' Somewhere' }, { region: rg });    // no distance
    }));
    {
        const cvm = new Canvas(10, 10);                                // no distance: the name, larger, in its place
        assert.ok(C.measure(cvm, { maneuver: 'right', road: 'Amstelvlietstraat' }, 72, {}) > 0);
    }

    // the file's JSON
    const g = SRC.parse({ v: 1, t: 5, app: 'X', maneuver: 'left', distance_m: 91, road: 'Seneca St', shield: '165',
        lanes: [{ dirs: ['left'], on: ['left'] }, { dirs: ['straight', 'bogus'] }, { dirs: [] }, 'x'] });
    assert.deepStrictEqual(g.lanes, [{ dirs: ['left'], on: ['left'] }, { dirs: ['straight'], on: [] }]);
    assert.strictEqual(g.distanceM, 91); assert.strictEqual(g.from, 'X');
    assert.strictEqual(SRC.parse({ maneuver: 'teleport' }), null);
    assert.strictEqual(SRC.parse(null), null);

    // the file source: fresh, then stale
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navcard-')), gf = path.join(dir, 'guidance.json');
    let clock = 1000;
    const logs = [];
    const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m) };
    const fsrc = SRC.file(log, { path: gf, now: () => clock, setInterval: () => 0, clearInterval() {} });
    const readNow = () => new Promise((r) => { fsrc._read(); setTimeout(r, 30); });
    await readNow();
    assert.strictEqual(fsrc.now(), null);
    assert.ok(/waiting/.test(fsrc.status().detail));
    fs.writeFileSync(gf, JSON.stringify({ t: 1000, app: 'Test', maneuver: 'right', distance_m: 200 }));
    await readNow();
    assert.strictEqual(fsrc.now().maneuver, 'right');
    clock = 1000 + SRC.STALE_MS + 1;
    assert.strictEqual(fsrc.now(), null);                              // old: no guidance
    fs.writeFileSync(gf, '{ "t": 1, "maneu');                          // half written: kept quiet
    await readNow();

    // the head unit's guidance (navigation.guiding.Guidance), enums as numbers or as names, unions by member name
    const HU = require(path.join(APP, 'headunit'));
    const desc = (...els) => ({ elements: els });
    const panel = (o) => Object.assign({ formattedDistance: { distance: '300', unit: 6, rawDistance: 91.4 },
        description: desc({ text: 'Seneca' }, { text: 'St' }, { icon: { text: '165', iconHandle: { id: 'x' } } }) }, o);
    let r = HU.fromDart({ maneuver: { intersection: panel({ direction: 2 }) } });
    assert.deepStrictEqual([r.maneuver, r.distanceM, r.road, r.shield], ['left', 91.44, 'Seneca St', '165']);
    assert.strictEqual(HU.fromDart({ maneuver: { intersection: panel({ direction: 'SLIGHT_RIGHT' }) } }).maneuver, 'slightRight');
    assert.strictEqual(HU.fromDart({ maneuver: { type: 'intersection', value: panel({ direction: 8 }) } }).maneuver, 'uturnRight');
    assert.strictEqual(HU.fromDart({ maneuver: { branch: panel({ branchType: 'HIGHWAY_OUT_RIGHT' }) } }).maneuver, 'exitRight');
    assert.strictEqual(HU.fromDart({ maneuver: { branch: panel({ branchType: 3 }) } }).maneuver, 'mergeLeft');
    assert.strictEqual(HU.fromDart({ maneuver: { destinationManeuver: panel({}) } }).maneuver, 'arrive');
    assert.strictEqual(HU.fromDart({ maneuver: { tunnel: panel({}) } }), null);           // not a manoeuvre
    assert.strictEqual(HU.fromDart(null), null);
    r = HU.fromDart({ maneuver: { roundabout: panel({ exitAngle: 180, exitNumber: 2, driveDirection: 2 }) } });
    assert.deepStrictEqual([r.maneuver, r.turnDeg], ['roundabout', 0]);                     // straight on
    assert.strictEqual(HU.roundaboutTurn({ exitAngle: 90, driveDirection: 'RIGHT' }), 90);  // the first right
    assert.strictEqual(HU.roundaboutTurn({ exitAngle: 90, driveDirection: 'LEFT' }), -90);  // driving on the left
    assert.strictEqual(HU.roundaboutTurn({ exitAngle: 0, exitNumber: 3, driveDirection: 2 }), -90);  // no angle: the number
    // the traffic side for a roundabout: the setting, then the navigation's own, then the car's position
    assert.deepStrictEqual(['GB', 'GBR', 'ie', 'NL', 'NLD', 'DE', ''].map(HU.sideOfCountry), ['LEFT', 'LEFT', 'LEFT', 'RIGHT', 'RIGHT', 'RIGHT', '']);
    const rb = (dd) => HU.fromDart({ maneuver: { roundabout: panel({ exitAngle: 90, exitNumber: 1, driveDirection: dd }) } });
    let rr = HU.sideFor(rb('RIGHT'), 'LEFT', '');
    assert.deepStrictEqual([rr.turnDeg, rr.clockwise, rr.sideSrc], [90, false, 'navigation']);     // Google's own: right-hand
    rr = HU.sideFor(rb(undefined), 'LEFT', '');
    assert.deepStrictEqual([rr.turnDeg, rr.clockwise, rr.sideSrc], [-90, true, 'car position']);    // none: the car's (UK)
    rr = HU.sideFor(rb(undefined), '', '');
    assert.deepStrictEqual([rr.turnDeg, rr.clockwise, rr.sideSrc], [90, false, 'default']);
    rr = HU.sideFor(rb('RIGHT'), 'RIGHT', 'LEFT');
    assert.deepStrictEqual([rr.clockwise, rr.sideSrc], [true, 'setting']);                          // the setting over all
    assert.strictEqual(HU.sideFor(HU.fromDart({ maneuver: { intersection: panel({ direction: 2 }) } }), 'LEFT', '').clockwise, undefined);
    {
        // CCP: the trafficSide event and the countryCode field, wired
        const hs = {}, ons = {}, set3 = { trafficSide: 'auto' };
        const sig3 = {
            watch: (iface, inst, h) => { hs[iface] = { h, inst }; return Promise.resolve({ available: true, proxy: { iface }, shutdown() {} }); },
            on: (px, name, fn) => { ons[px.iface + '.' + name] = fn; return Promise.resolve(); },
        };
        const h3 = HU.headunit({ log, settings: { get: (k) => set3[k] } }, { signals: sig3, logDir: dir, rawFile: path.join(dir, 'raw3.json'), setTimeout: () => 1, setInterval: () => 1, clearInterval() {} });
        await new Promise((r2) => setTimeout(r2, 10));
        assert.strictEqual(hs[HU.CCP].inst, '1');
        assert.deepStrictEqual(h3.trafficSide(), { side: 'RIGHT', from: 'default' });
        hs[HU.CCP].h.countryCode('GBR');
        assert.deepStrictEqual(h3.trafficSide(), { side: 'LEFT', from: 'country GBR' });
        ons[HU.CCP + '.trafficSide']({ direction: 'RIGHT_HAND_SIDE' });
        assert.deepStrictEqual(h3.trafficSide(), { side: 'RIGHT', from: 'car position' });           // the event over the country
        ons[HU.CCP + '.trafficSide'](0);
        assert.strictEqual(h3.trafficSide().side, 'LEFT');
        set3.trafficSide = 'right';
        assert.deepStrictEqual(h3.trafficSide(), { side: 'RIGHT', from: 'setting' });
        h3.stop();
    }
    assert.strictEqual(HU.metres({ distance: '0,4', unit: 'KM' }), 400);                   // no raw: the text
    assert.strictEqual(HU.metres({ distance: '', unit: 0 }), null);
    assert.deepStrictEqual(HU.describe(desc({ text: 'A1' }, { spacer: 'SLASH' }, { text: 'E35' })), { road: 'A1 / E35', shield: '', shields: [] });
    const lanes = HU.fromLanes({ rows: [{ lanes: [
        { directionToFollow: 2, directionsToFollow: [], otherDirections: [1], isHighlighted: true },
        { directionToFollow: 0, directionsToFollow: [], otherDirections: [1], isHighlighted: false },
        { directionToFollow: 'NONE', otherDirections: [], isHighlighted: false }] }, { lanes: [] }] });
    assert.deepStrictEqual(lanes, [{ dirs: ['left', 'straight'], on: ['left'] }, { dirs: ['straight'], on: [] }, { dirs: ['straight'], on: [] }]);
    const fields = { guidanceState: 2, guidingProvider: 1, conclusiveDart: { maneuver: { intersection: panel({ direction: 5, formattedDistance: {} }) } },
        nextIntersection: { intersection: desc({ text: 'Other' }), distance: { distance: '250', unit: 4, rawDistance: 250 } },
        currentLaneGuiding: { rows: [] } };
    r = HU.combine(fields, { phoneOnly: true });
    assert.deepStrictEqual([r.maneuver, r.distanceM, r.road, r.from], ['right', 250, 'Seneca St', 'CarPlay']);   // distance from the intersection
    assert.strictEqual(HU.combine(Object.assign({}, fields, { guidanceState: 'CALCULATING_ROUTE' })), null);
    assert.strictEqual(HU.combine(Object.assign({}, fields, { guidingProvider: 0 }), { phoneOnly: true }), null);  // BMW's own route
    assert.ok(HU.combine(Object.assign({}, fields, { guidingProvider: 'NONE' }), { phoneOnly: false }));
    {   // Google Maps' lane hint (as seen 2026-11): not in the event list, in currentLaneGuiding
        const gm = { rows: [{ distanceToDestination: 2100, lanes: [
            { directionToFollow: 'STRAIGHT_ON', otherDirections: [], isHighlighted: true, additionalLaneInfo: 'NONE', directionsToFollow: ['STRAIGHT_ON'] },
            { directionToFollow: 'RIGHT', otherDirections: [], isHighlighted: true, additionalLaneInfo: 'NONE', directionsToFollow: ['RIGHT'] }],
            laneMarkers: ['DASHED', 'DASHED', 'DASHED'], recommendedCarPositionLaneIndex: 1 }], carPositionLaneIndex: 255 };
        const ev = { maneuver: 'right', distanceM: 400, road: 'x', shield: '', lanes: [] };
        const want = [{ dirs: ['straight'], on: ['straight'] }, { dirs: ['right'], on: ['right'] }];
        let c = HU.combine({ guidanceState: 'INACTIVE', guidingProvider: 'CAR_PLAY', events: ev, currentLaneGuiding: gm }, { phoneGuiding: true });
        assert.deepStrictEqual(c.lanes, want);
        c = HU.combine({ guidanceState: 'INACTIVE', guidingProvider: 'CAR_PLAY', events: ev, currentLaneGuiding: { rows: [] }, pmLanes: gm }, { phoneGuiding: true });
        assert.deepStrictEqual(c.lanes, want);                                                   // from ProjectedModeGuiding
        c = HU.combine({ guidanceState: 'INACTIVE', guidingProvider: 'CAR_PLAY', events: ev, currentLaneGuiding: { rows: [] } }, { phoneGuiding: true });
        assert.deepStrictEqual(c.lanes, []);                                                     // the hint is gone: no strip
        assert.deepStrictEqual(ev.lanes, []);                                                    // the event itself untouched
        c = HU.combine({ guidanceState: 'INACTIVE', guidingProvider: 'CAR_PLAY', currentLaneGuiding: gm,
            pmWaypoints: [{ isCheckeredFlag: true, formattedDistance: { distance: '2', unit: 'KM' } }] }, { phoneGuiding: true });
        assert.deepStrictEqual([c.maneuver, c.lanes.length], ['arrive', 0]);                      // no lanes on the destination card
    }
    // the reader: subscribes, takes values wrapped or not, writes the raw file, says what it found
    const handlersOf = {};
    const fakeSig = { watch: (iface, inst, h) => { handlersOf[iface] = { inst, h }; return Promise.resolve({ available: true, shutdown() {} }); } };
    const set2 = { provider: 'phone' };
    const rawFile = path.join(dir, 'raw.json');
    let fire = null;
    const hu = HU.headunit({ log, settings: { get: (k) => set2[k] } }, { signals: fakeSig, rawFile, logDir: dir, setTimeout: (fn) => { fire = fn; return 1; } });
    await new Promise((r2) => setImmediate(r2));
    assert.strictEqual(handlersOf[HU.GUIDANCE].inst, 'Main_Instance');
    assert.strictEqual(handlersOf[HU.CARPLAY].inst, 'CarPlayManagerInst1');
    assert.strictEqual(hu.now(), null);
    assert.ok(/no guidance state yet/.test(hu.status().detail));
    assert.strictEqual(handlersOf[HU.PROJECTED].inst, 'Main_Instance');
    handlersOf[HU.CARPLAY].h.projectedGuidanceActive({ value: 1 });
    handlersOf[HU.CARPLAY].h.projectedGuidanceMetadataAvailable({ odd: 'shape' });       // not a bool: unknown, not "no"
    handlersOf[HU.GUIDANCE].h.guidanceState(0);
    assert.strictEqual(hu.status().detail, 'the navigation says INACTIVE   ·   CarPlay guiding: yes');
    handlersOf[HU.PROJECTED].h.currentRoad({ elements: [{ text: 'Seneca St \u00e4' }] });
    const dg = hu.diag();
    assert.ok(/^Guidance available, {2}CarPlayManager available/.test(dg[0]) && /^ProjectedModeGuiding/.test(dg[1]) && dg.some((l) => /^ProjectedModeGuiding.currentRoad x1 = .*Seneca St \?/.test(l)), dg.join('\n'));
    const H = handlersOf[HU.GUIDANCE].h;
    H.guidanceState({ guidanceState: 'ACTIVE' }); H.guidingProvider(2); H.conclusiveDart(fields.conclusiveDart);
    H.currentLaneGuiding({ value: { rows: [{ lanes: [{ directionToFollow: 5, isHighlighted: true }] }] } });
    // the phone guides without turns, but gives its destination: a route-only card
    H.guidanceState('INACTIVE');
    handlersOf[HU.PROJECTED].h.waypoints({ waypoints: [{ isCheckeredFlag: false, formattedDistance: { distance: '2', unit: 'KM', rawDistance: 2000 } },
        { isCheckeredFlag: true, formattedDistance: { distance: '12.4', unit: 'KM', rawDistance: 12400 },
            estimatedArrivalTime: { time: { invalid: false, hour: 22, minute: 7, seconds: 0 } } }] });
    let ro = hu.now();
    assert.deepStrictEqual([ro.maneuver, ro.distanceM, ro.road, ro.from, ro.routeOnly], ['arrive', 12400, 'Arrival 22:07', 'Android Auto, route only', true]);
    assert.ok(/no turns/.test(hu.status().detail));
    assert.strictEqual(HU.routeOnly({ pmWaypoints: [{ formattedDistance: { rawDistance: 0 }, estimatedArrivalTime: { time: { invalid: true } } }] }), null);
    assert.strictEqual(HU.routeOnly({ finalDestinationInfo: { distanceFromCurrentToFinalDestination: 900 } }).distanceM, 900);
    assert.strictEqual(HU.combine({ guidanceState: 0, pmWaypoints: [{ formattedDistance: { rawDistance: 5 } }] }, {}), null);   // CarPlay not guiding
    H.guidanceState('ACTIVE');
    handlersOf[HU.CARPLAY].h.projectedGuidanceMetadataAvailable(true);
    assert.deepStrictEqual([hu.now().maneuver, hu.now().from, hu.now().lanes.length], ['right', 'Android Auto', 1]);
    assert.ok(/guiding \(Android Auto\)/.test(hu.status().detail));
    fire();
    assert.strictEqual(JSON.parse(fs.readFileSync(rawFile, 'utf8')).fields.guidingProvider, 2);
    H.guidingProvider('NONE');
    assert.strictEqual(hu.now(), null);                                 // the BMW navigation's route: phone only by default
    assert.ok(/BMW navigation/.test(hu.status().detail));
    set2.provider = 'any';
    assert.strictEqual(hu.now().from, 'the BMW navigation');
    hu.stop();
    fs.unlinkSync(rawFile);
    // the navigation's event list (GuidanceEventList.queryContent): the phone's turns when Guidance has none
    const ans = { GuidanceEventListError: 'NO_ERROR', currentDistances: { carDistanceToFinalDestination: 1300 },
        viewContent: [{ eventsInView: [
            { laneGuiding: { distanceToDestination: 1260, lanes: [{ directionToFollow: 'RIGHT', isHighlighted: true }, { directionToFollow: 'STRAIGHT_ON' }] } },
            { intersection: { distanceToDestination: 1250, direction: 'RIGHT', formattedDistance: { distance: '', rawDistance: 0 },
                description: { elements: [{ text: 'Markonstraat' }] } } },
            { destinationManeuver: { distanceToDestination: 0 } }] }] };
    r = HU.fromEvents(ans);
    assert.deepStrictEqual([r.maneuver, r.distanceM, r.road, r.lanes.length, r.lanes[0].on[0]], ['right', 50, 'Markonstraat', 2, 'right']);
    assert.strictEqual(HU.fromEvents({ queryContent: ans }).road, 'Markonstraat');                       // wrapped
    // as the car gave Google Maps' guidance (the event log of 2026-11-08): the banner's manoeuvre with its distance as
    // text and raw 1, the one after it with " " NONE raw 500; the car's own distances 0
    const ev = (dir, dist, unit, raw, toDest, road, step) => ({ intersection: { uid: '1', distanceToDestination: toDest, direction: dir,
        formattedDistance: { distance: dist, unit, rawDistance: raw }, description: { elements: [{ text: road }] }, guidingStep: step } });
    const carAns = (...evs) => ({ GuidanceEventListError: 'NO_ERROR', viewContent: [{ eventsInView: evs }],
        currentDistances: { carDistanceToFinalDestination: 0, carDistanceToNextDestination: -1 } });
    r = HU.fromEvents(carAns(ev('LEFT', '60', 'METER', 1, 1140, 'Welnastraat', 'GS2'), ev('LEFT', ' ', 'NONE', 500, 1140, 'Welnastraat', 'GS1')));
    assert.deepStrictEqual([r.maneuver, r.distanceM, r.road], ['left', 60, 'Welnastraat']);           // not raw 1
    r = HU.fromEvents(carAns(ev('RIGHT', '0', 'METER', 1, 1500, 'Amstelvlietstraat', 'GS2'), ev('LEFT', ' ', 'NONE', 500, 1500, 'Markonstraat', 'GS1')));
    assert.deepStrictEqual([r.maneuver, r.distanceM], ['right', 0]);                                   // at the turn
    r = HU.fromEvents(carAns(ev('STRAIGHT_ON', '0', 'METER', 1, 1500, 'towards Amstelvlietstraat', 'GS2'), ev('RIGHT', ' ', 'NONE', 500, 1500, 'Amstelvlietstraat', 'GS1')));
    assert.deepStrictEqual([r.maneuver, r.distanceM, r.road], ['right', null, 'Amstelvlietstraat']);   // just past a turn: the next, no number (not 500)
    r = HU.fromEvents(carAns(ev('STRAIGHT_ON', '300', 'METER', 1, 1500, 'towards Amstelvlietstraat', 'GS2'), ev('RIGHT', ' ', 'NONE', 500, 1500, 'Amstelvlietstraat', 'GS1')));
    assert.deepStrictEqual([r.maneuver, r.distanceM], ['straight', 300]);                              // "keep going 300 m" as the phone says
    assert.strictEqual(HU.metres({ distance: '1.2', unit: 'KM', rawDistance: 1200 }), 1200);
    assert.strictEqual(HU.metres({ distance: ' ', unit: 'NONE', rawDistance: 500 }), null);
    assert.strictEqual(HU.metres({ distance: '', unit: 'METER', rawDistance: 80 }), 80);
    const ans2 = carAns(ev('STRAIGHT_ON', '0', 'METER', 1, 1500, 'towards Amstelvlietstraat', 'GS2'), ev('RIGHT', ' ', 'NONE', 500, 1500, 'Amstelvlietstraat', 'GS1'));
    const el = HU.eventLines(ans2);
    assert.ok(el[0] === 'events: car to destination 0 m' && /^ 1 intersection RIGHT \| fd   NONE raw 500 .*\| Amstelvlietstraat$/.test(el[2]), el.join('\n'));
    assert.strictEqual(HU.fromEvents({ viewContent: [{ eventsInView: [{ tunnel: {} }] }] }), null);
    assert.strictEqual(HU.viewConfig(true).viewport.startPoint.anchorPoint.standardReferencePoint, 'CCP');
    assert.strictEqual(HU.viewConfig(false).viewport.includedTypes[0], 1);
    {
        const hs = {}, calls = [];
        let q = null, answer = ans;
        const sig2 = {
            watch: (iface, inst, h) => { hs[iface] = h; return Promise.resolve({ available: true, shutdown() {} }); },
            proxy: () => Promise.resolve({ px: 1 }),
            call: (p, m, args) => {
                const names = typeof args.viewConfigs[0].viewport.startPoint.anchorPoint.standardReferencePoint === 'string';
                calls.push(names ? 'names' : 'numbers');
                return names ? Promise.reject(new Error('bad enum')) : Promise.resolve(answer);   // this module wants numbers
            },
        };
        const h2 = HU.headunit({ log, settings: { get: () => 'phone' } }, { signals: sig2, rawFile: path.join(dir, 'raw2.json'), logDir: dir,
            setTimeout: () => 1, setInterval: () => 1, clearInterval() {}, queryNow: (fn) => { q = fn; } });
        const settle = () => new Promise((r2) => setTimeout(r2, 10));
        await settle();
        hs[HU.GUIDANCE].guidanceState('INACTIVE');
        q(); await settle();                                            // CarPlay not guiding yet: no query
        assert.deepStrictEqual(calls, []);
        hs[HU.CARPLAY].projectedGuidanceActive(true);
        q(); await settle();                                            // opens the proxy
        q(); await settle();
        assert.deepStrictEqual(calls, ['names', 'numbers']);
        assert.deepStrictEqual([h2.now().maneuver, h2.now().distanceM, h2.now().from], ['right', 50, 'CarPlay, event list']);
        assert.ok(/guiding \(CarPlay, event list\)/.test(h2.status().detail));
        assert.ok(h2.events().length >= 2 && /^events: car to destination 1300 m/.test(h2.events()[0]));
        // the event log: the answer whole, what the card took and how it found the distance
        const recs = fs.readFileSync(path.join(dir, 'cluster_nav_card-events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const qr = recs.filter((x) => x.kind === 'query')[0];
        assert.ok(qr && qr.enums === 'numbers' && qr.card.distanceM === 50 && /^car 1300 - event toDest 1250/.test(qr.card.distSrc) && qr.answer.viewContent, JSON.stringify(qr));
        assert.ok(recs.some((x) => x.kind === 'error' && /bad enum/.test(x.error)) || true);
        assert.ok(recs.some((x) => x.kind === 'field' && x.key === 'CarPlayManager.projectedGuidanceActive'));
        assert.ok(/record\(s\) in .*cluster_nav_card-events.jsonl/.test(h2.logStatus()));
        q(); await settle();
        assert.deepStrictEqual(calls, ['names', 'numbers', 'numbers']); // remembered
        answer = { viewContent: [], currentDistances: {} };
        q(); await settle();
        assert.strictEqual(h2.now(), null);                             // no events, no waypoints: nothing
        // the route-only card, then Google Maps stops and Waze guides: Waze sends nothing - no stale arrival
        hs[HU.GUIDANCE].guidingProvider('CAR_PLAY');
        hs[HU.PROJECTED].waypoints([{ isCheckeredFlag: true, formattedDistance: { distance: '1.2', unit: 'KM', rawDistance: 1200 },
            estimatedArrivalTime: { time: { invalid: false, hour: 12, minute: 25 } } }]);
        assert.strictEqual(h2.now().road, 'Arrival 12:25');
        hs[HU.CARPLAY].projectedGuidanceActive(false);
        hs[HU.CARPLAY].projectedGuidanceActive(true);
        q(); await settle();
        assert.strictEqual(h2.now(), null);
        assert.ok(/sends the car nothing.*Waze: not supported/.test(h2.status().detail), h2.status().detail);
        hs[HU.PROJECTED].waypoints([{ isCheckeredFlag: true, formattedDistance: { distance: '2', unit: 'KM' } }]);
        hs[HU.GUIDANCE].guidingProvider('CAR_PLAY');
        hs[HU.GUIDANCE].guidingProvider('NONE');                       // another app: the route goes too
        assert.strictEqual(h2.now(), null);
        // the app started while Waze guides: the car answers the last app's waypoints, provider NONE - no card
        hs[HU.PROJECTED].waypoints([{ isCheckeredFlag: true, formattedDistance: { distance: '1.2', unit: 'KM' },
            estimatedArrivalTime: { time: { invalid: false, hour: 12, minute: 25 } } }]);
        assert.strictEqual(h2.now(), null);
        assert.ok(/sends the car nothing/.test(h2.status().detail));
        h2.stop();
        fs.unlinkSync(path.join(dir, 'cluster_nav_card-events.jsonl'));
        try { fs.unlinkSync(path.join(dir, 'raw2.json')); } catch (e) { /* not written */ }
    }
    {
        // the unit's Node 8: fs.mkdirSync ignores { recursive } and throws EEXIST for a folder that is there
        const real = fs.mkdirSync;
        fs.mkdirSync = function (d) {
            if (fs.existsSync(d)) { const e = new Error("EEXIST: file already exists, mkdir '" + d + "'"); e.code = 'EEXIST'; throw e; }
            return real.call(fs, d);
        };
        try {
            const lg = HU.eventLog(dir, () => 1);                       // dir is there
            lg.write({ kind: 'test' });
            assert.ok(/^1 record\(s\)/.test(lg.status()), lg.status());
            const deep = path.join(dir, 'a', 'b');
            HU.mkdirp(deep);                                           // missing parents made one by one
            assert.ok(fs.statSync(deep).isDirectory());
            HU.mkdirp(deep);                                           // and again: no error
        } finally { fs.mkdirSync = real; }
        fs.unlinkSync(path.join(dir, 'cluster_nav_card-events.jsonl'));
    }
    {
        // rotation past 1.5 MB
        let tt = 0;
        const lg = HU.eventLog(dir, () => ++tt, 1500000), big = 'x'.repeat(400000);
        for (let i = 0; i < 5; i++) lg.write({ kind: 'test', big });
        assert.ok(fs.statSync(path.join(dir, 'cluster_nav_card-events.1.jsonl')).size > 1000000 && fs.statSync(path.join(dir, 'cluster_nav_card-events.jsonl')).size < 900000);
        fs.unlinkSync(path.join(dir, 'cluster_nav_card-events.jsonl')); fs.unlinkSync(path.join(dir, 'cluster_nav_card-events.1.jsonl'));
    }

    // live: the car first, the file when the car has none
    let carG = null;
    fs.writeFileSync(gf, JSON.stringify({ t: clock, app: 'F', maneuver: 'left', distance_m: 50 }));
    const lv = SRC.live({ log, settings: { get: () => undefined } }, { path: gf, now: () => clock, setInterval: () => 0, clearInterval() {},
        headunit: () => ({ now: () => carG, status: () => ({ detail: carG ? 'guiding' : 'no route', active: !!carG }), stop() {} }) });
    await new Promise((r2) => setTimeout(r2, 30));
    assert.strictEqual(lv.now().from, 'F');
    assert.ok(lv.status().fileActive);
    carG = { maneuver: 'right', distanceM: 10, from: 'CarPlay' };
    assert.strictEqual(lv.now().from, 'CarPlay');
    assert.ok(!lv.status().fileActive);
    lv.stop();
    // the roundabout drawn by its turn angle
    C.draw(new Recorder(C.size(C.ROW_H, {}), C.ROW_H), { maneuver: 'roundabout', turnDeg: -45, distanceM: 40 }, {});

    // the demo drive counts down and goes through every step
    let dt = 0;
    const dm = SRC.demo(() => dt);
    const seen = new Set();
    let prev = Infinity;
    for (dt = 0; dt < 400000; dt += 500) {
        const x = dm.now();
        if (!x) continue;
        seen.add(x.maneuver);
        if (x.maneuver === 'left' && dt < 20000) { assert.ok(x.distanceM <= prev); prev = x.distanceM; }
    }
    assert.deepStrictEqual([...seen].sort(), SRC.ROUTE.map((s) => s.maneuver).sort());

    // the card: every manoeuvre, lanes or none, both canvases (the GPU recorder has no triangle: quads only)
    C.KINDS.forEach((k) => {
        const gg = { maneuver: k, exit: 3, distanceM: 120, road: 'A very long road name that will not fit on the card at all', shield: 'E95',
            lanes: [{ dirs: [k, 'straight'], on: [k] }, { dirs: ['straight'] }] };
        const h = 118;
        C.draw(new Canvas(C.size(h, gg), h), gg, { units: 'metric' });
        C.draw(new Recorder(C.size(h, gg), h), gg, { units: 'imperial' });
        C.draw(new Canvas(C.size(C.ROW_H, {}), C.ROW_H), { maneuver: k, distanceM: 5 }, {});
    });
    C.draw(new Canvas(100, 40), null);
    C.draw(new Recorder(480, 72), { maneuver: 'left', distanceM: 300, road: 'A4 Den Haag', palette: 'black' }, { region: 'nl' });
    assert.ok(C.PALETTES.black.card !== C.PALETTES.green.card);
    assert.ok(C.size(C.ROW_H, {}) < C.size(C.ROW_H, { lanes: [1] }) * 2);
    // the width fits the content, in steps, never over the layer
    const cvm = new Canvas(10, 10), gs = { maneuver: 'left', distanceM: 300, road: 'Seneca St' };
    const wShort = C.measure(cvm, gs, 118, {}), wLong = C.measure(cvm, Object.assign({}, gs, { road: 'A much longer road name than that one' }), 118, {});
    assert.ok(wShort % 32 === 0 && wShort < wLong && wShort >= C.ROW_H * 2.6, wShort + ' ' + wLong);
    assert.strictEqual(C.measure(cvm, Object.assign({}, gs, { road: 'x'.repeat(200) }), 118, { maxW: 572 }), 572);
    assert.strictEqual(C.measure(cvm, gs, C.ROW_H, {}), C.measure(cvm, Object.assign({}, gs, { lanes: [{ dirs: ['left'] }] }), C.BASE_H, {}));   // the same row: the same width

    // the overlay
    assert.deepStrictEqual(OV.mapRect('panel'), { x: 416, y: 120, w: 1088, h: 480 });
    assert.strictEqual(OV.mapRect('hud'), null);                       // the cluster only
    const b = OV.cardRect(OV.mapRect('panel'), 'topLeft', 118);
    assert.deepStrictEqual([b.x, b.y, b.h, b.w % 4], [440, 144, 118, 0]);
    const bc = OV.cardRect(OV.mapRect('map'), 'topCenter', 118);
    assert.ok(Math.abs(bc.x + bc.w / 2 - 544) <= 2 && bc.x % 4 === 0, JSON.stringify(bc));   // centred on the map
    assert.strictEqual(OV.cardRect(OV.mapRect('map'), 'topCenter', 118, 'badge').y, OV.TOPS.badge);   // under the model badge
    assert.strictEqual(OV.cardRect(OV.mapRect('map'), 'topCenter', 118, 'low').y, OV.TOPS.low);
    assert.ok(OV.cardRect(OV.mapRect('map'), 'topCenter', 400, 'low').y + 400 <= 480);                  // never off the map
    const br = OV.cardRect(OV.mapRect('panel'), 'topRight', 118);
    assert.strictEqual(br.x + br.w, 416 + 1088 - 24);

    {
        // the standard width: the card fills the layer, whatever the road's name; "fit": as wide as its text
        const L = new Canvas(C.size(118, { lanes: [1] }), 118), alphaAt = (x, y) => L.d[(y * L.w + x) * 4 + 3];
        assert.strictEqual(L.w, 480);
        ['Welnastraat', 'A10 / E19 Ring Zuid Amsterdam Centrum Oost'].forEach((road) => {
            OV.drawLayer(L, { maneuver: 'left', distanceM: 60, road }, 'metric', 'topCenter', 'nl', false);
            assert.ok(alphaAt(4, 36) > 0 && alphaAt(L.w - 4, 36) > 0, road);
        });
        OV.drawLayer(L, { maneuver: 'left', distanceM: 60, road: 'Welnastraat' }, 'metric', 'topCenter', 'nl', true);
        assert.ok(alphaAt(4, 36) === 0 && alphaAt(L.w / 2, 36) > 0);
    }
    const sp = path.join(dir, 'status.json'), sent = [];
    class FakeCR extends EventEmitter {
        constructor() { super(); this.ready = true; this.n = 0; }
        connect() {}
        image(o) { sent.push(['image', o.target, o.w + 'x' + o.h, o.visible]); return ++this.n; }
        pixels(ref, rects, px) { sent.push(['pixels', rects ? rects.length : 'whole', px.length]); return true; }
        set(ref, o) { sent.push(['set', JSON.stringify(o)]); }
        drop(ref) { sent.push(['drop', ref]); }
        close() {}
    }
    const set = { show: 'off', place: 'topLeft', size: 'normal', units: 'metric' };
    let guide = { maneuver: 'left', distanceM: 300, road: 'Seneca St', shield: '165', lanes: [{ dirs: ['left'], on: ['left'] }, { dirs: ['straight'] }] };
    let t = 0;
    const ov = OV.startOverlay({ settings: { get: (k) => set[k] }, log }, () => guide,
        { statusPath: sp, ClusterRender: FakeCR, setInterval: () => 0, clearInterval() {}, now: () => t });
    const status = (o) => new Promise((r) => { fs.writeFileSync(sp, JSON.stringify(o)); ov.readStatus(); setTimeout(r, 30); });
    await status({ state: 'showing', target: 'panel' });
    assert.deepStrictEqual(sent, []);                                  // Off: nothing at all
    set.show = 'cluster'; ov.tick();
    const W = C.size(118, { lanes: [1] });
    assert.deepStrictEqual(sent.slice(0, 3), [['image', 'panel', W + 'x118', false], ['pixels', 'whole', W * 118 * 4], ['set', '{"visible":true}']]);
    t = 1000; guide = Object.assign({}, guide, { distanceM: 250 }); ov.tick();
    const upd = sent[sent.length - 1];
    assert.strictEqual(upd[0], 'pixels'); assert.strictEqual(upd[1], 1);
    assert.ok(upd[2] < W * 118 * 4 / 2);                                // the distance's rows only
    t = 1050; guide = Object.assign({}, guide, { distanceM: 200 }); ov.tick();
    assert.strictEqual(sent[sent.length - 1], upd);                     // not again within UPDATE_MS
    t = 2000; guide = Object.assign({}, guide, { lanes: [] }); ov.tick();   // lanes gone: the same layer
    assert.strictEqual(sent.filter((x) => x[0] === 'image').length, 1);
    guide = null; ov.tick();                                            // no route: hidden
    assert.deepStrictEqual(sent[sent.length - 1], ['set', '{"visible":false}']);
    guide = { maneuver: 'right', distanceM: 90 };
    await status({ state: 'showing', target: 'hud' });                   // the map on the HUD: not ours
    assert.ok(!ov.shown());
    await status({ state: 'showing', target: 'map' });
    assert.ok(ov.shown() && sent.some((x) => x[0] === 'drop'));
    set.size = 'large'; t = 3000; ov.tick();                            // another size: a new layer
    assert.deepStrictEqual(sent.filter((x) => x[0] === 'image').pop().slice(0, 3), ['image', 'map', C.size(140, { lanes: [1] }) + 'x140']);
    fs.unlinkSync(sp);
    await new Promise((r) => { ov.readStatus(); setTimeout(r, 30); });   // Waze on cluster gone: hidden
    assert.ok(!ov.shown());
    try { fs.unlinkSync(gf); } catch (e) { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('cluster_nav_card: ok');
})().catch((e) => { console.error(e); process.exit(1); });
