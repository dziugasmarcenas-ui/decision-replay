import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeExports, parseCsv, evaluate, appendProposal, appendCalibrationCorrection, impact } from '../src/engine.js';

const read = name => readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8');
const coatingCsv = read('coating_export.csv');
const spectralCsv = read('spectral_export.csv');
const referenceText = read('reference.json');
const hash = text => createHash('sha256').update(text).digest('hex');
const inputs = () => ({ coatingCsv, spectralCsv, reference: JSON.parse(referenceText), hashes: { coating: hash(coatingCsv), spectral: hash(spectralCsv), reference: hash(referenceText) } });

test('timestamps require an explicit zone and reject nonexistent calendar dates', () => {
  for (const bad of ['2026-09-24T10:15:00', '2026-02-30T10:15:00Z', '2026-09-24', '2026-09-24T25:15:00Z']) {
    assert.throws(() => normalizeExports({ ...inputs(), spectralCsv: spectralCsv.replace('2026-09-24T10:15:00Z', bad) }), /timestamp/);
  }
});

test('equivalent explicit offsets produce the same eligibility', () => {
  const events = normalizeExports({ ...inputs(), spectralCsv: spectralCsv.replace('2026-09-24T10:15:00Z', '2026-09-24T13:15:00+03:00') });
  assert.equal(evaluate(events, 'SYN-OPT-014').disposition, 'release');
});

test('missing or blank reference limits cannot become numeric zero', () => {
  for (const bad of [null, '', ' ', false, [], {}]) {
    const input = inputs();
    input.reference.specification.floorPct[532] = bad;
    assert.throws(() => normalizeExports(input), /floor/);
  }
});

test('CSV quotes cannot open mid-field or have trailing garbage', () => {
  for (const csv of ['a,b\nx"y",z', 'a,b\n"x"oops,z', 'a,b\n"unterminated,z']) {
    assert.throws(() => parseCsv(csv), /quot|CSV/);
  }
  assert.deepEqual(parseCsv('a,b\r\n"x""y","line\nbreak"\r\n'), [{ a: 'x"y', b: 'line\nbreak' }]);
});

test('source event identities are globally unique and duplicate canonical parts are rejected', () => {
  assert.throws(() => normalizeExports({ ...inputs(), spectralCsv: spectralCsv.replace('SYN-MEAS-014', 'SYN-JOB-041') }), /duplicate/);
  assert.throws(() => normalizeExports({ ...inputs(), coatingCsv: coatingCsv.replace('opt 015', 'OPT-014') }), /Duplicate coating part/);
});

test('calibration validity ends at the exclusive upper boundary', () => {
  const input = inputs();
  input.reference.calibrations[0].validUntil = '2026-09-24T10:15:00Z';
  assert.equal(evaluate(normalizeExports(input), 'SYN-OPT-014').reasonCode, 'CAL_EXPIRED');
});

test('replay and correction do not mutate frozen input or prior proposals', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const seed = freeze(normalizeExports(inputs()));
  const originalJson = JSON.stringify(seed);
  let events = appendProposal(seed, 'SYN-OPT-014');
  const proposalJson = JSON.stringify(events.at(-1));
  events = freeze(appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-20T00:00:00Z'));
  assert.equal(evaluate(events, 'SYN-OPT-014').reasonCode, 'CAL_RETRACTED');
  assert.equal(impact(events).length, 1);
  assert.equal(JSON.stringify(seed), originalJson);
  assert.equal(JSON.stringify(events.at(-2)), proposalJson);
});

test('every history prefix replays deterministically', () => {
  let events = normalizeExports(inputs());
  events = appendProposal(events, 'SYN-OPT-014');
  events = appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-20T00:00:00Z');
  for (let i = 0; i <= events.length; i++) {
    assert.deepEqual(evaluate(events, 'SYN-OPT-014', i), evaluate(events.slice(0, i), 'SYN-OPT-014'));
    assert.deepEqual(impact(events, i), impact(events.slice(0, i)));
  }
});
