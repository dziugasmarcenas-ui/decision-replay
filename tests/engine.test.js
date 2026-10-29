import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeExports, parseCsv, replay, evaluate, appendProposal, appendHuman, appendCalibrationCorrection, impact, reviewStats } from '../src/engine.js';

const root = new URL('../data/', import.meta.url);
const inputs = {
  coatingCsv: readFileSync(new URL('coating_export.csv', root), 'utf8'),
  spectralCsv: readFileSync(new URL('spectral_export.csv', root), 'utf8'),
  reference: JSON.parse(readFileSync(new URL('reference.json', root), 'utf8')),
  hashes: { coating: 'test-coating-sha', spectral: 'test-spectral-sha', reference: 'test-reference-sha' }
};
const seed = () => normalizeExports(inputs);

test('CSV parser handles quoted commas and rejects malformed rows', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y",z\n'), [{ a: 'x,y', b: 'z' }]);
  assert.throws(() => parseCsv('a,b\nx\n'), /column/i);
  assert.throws(() => parseCsv('a, a\nx,y\n'), /header|duplicate/i);
});

test('unlike source identities join to three canonical optics with provenance', () => {
  const events = seed();
  const state = replay(events);
  assert.deepEqual([...state.parts.keys()], ['SYN-OPT-014', 'SYN-OPT-015', 'SYN-OPT-016']);
  assert.equal(state.parts.get('SYN-OPT-014').coating.source.rawId, 'SYN-JOB-041');
  assert.equal(state.parts.get('SYN-OPT-014').measurement.source.rawId, 'SYN-MEAS-014');
  assert.equal(state.parts.get('SYN-OPT-014').measurement.source.sha256, 'test-spectral-sha');
});

test('bad aliases, duplicate IDs, and non-finite spectral values fail import', () => {
  assert.throws(() => normalizeExports({ ...inputs, spectralCsv: inputs.spectralCsv.replace('OPT-014', 'OTHER-014') }), /part|alias/i);
  assert.throws(() => normalizeExports({ ...inputs, coatingCsv: inputs.coatingCsv.replace('SYN-JOB-042', 'SYN-JOB-041') }), /duplicate/i);
  assert.throws(() => normalizeExports({ ...inputs, spectralCsv: inputs.spectralCsv.replace('98.71', 'NaN') }), /transmission|finite/i);
  assert.throws(() => normalizeExports({ ...inputs, spectralCsv: inputs.spectralCsv.replace('SYN-CAL-022', 'SYN-CAL-999') }), /calibration/i);
  assert.throws(() => normalizeExports({ ...inputs, spectralCsv: inputs.spectralCsv.replace('SYN-SPEC-R4', 'SYN-SPEC-R9') }), /specification|spec revision/i);
  assert.throws(() => normalizeExports({ ...inputs, spectralCsv: inputs.spectralCsv.replace(',SYN-SPECTROMETER,SYN-CAL-022', ',,SYN-CAL-022') }), /instrument class/i);
  const blankCalClass = structuredClone(inputs.reference);
  blankCalClass.calibrations[0].instrumentClass = '';
  assert.throws(() => normalizeExports({ ...inputs, reference: blankCalClass }), /instrument class/i);
});

test('valid evidence can release while a below-limit measurement holds', () => {
  const events = seed();
  assert.equal(evaluate(events, 'SYN-OPT-014').disposition, 'release');
  const held = evaluate(events, 'SYN-OPT-016');
  assert.equal(held.disposition, 'hold');
  assert.equal(held.reasonCode, 'BELOW_LIMIT');
  assert.deepEqual(held.failedWavelengths, [532]);
});

test('missing or mismatched hard evidence cannot release', () => {
  const events = seed();
  const noCal = events.filter(e => e.id !== 'SYN-CAL-022');
  assert.equal(evaluate(noCal, 'SYN-OPT-014').disposition, 'abstain');
  const wrongSpec = structuredClone(events);
  wrongSpec.find(e => e.id === 'SYN-MEAS-014').specRevision = 'SYN-SPEC-R9';
  assert.equal(evaluate(wrongSpec, 'SYN-OPT-014').reasonCode, 'SPEC_REV_MISMATCH');
});

test('late correction changes current state and impact without mutating proposals', () => {
  let events = seed();
  for (const part of ['SYN-OPT-014', 'SYN-OPT-015', 'SYN-OPT-016']) events = appendProposal(events, part);
  const original = structuredClone(events.find(e => e.id === 'SYN-PROP-001'));
  events = appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-20T00:00:00Z');
  assert.equal(evaluate(events, 'SYN-OPT-014').reasonCode, 'CAL_RETRACTED');
  assert.equal(evaluate(events, 'SYN-OPT-014').disposition, 'abstain');
  assert.deepEqual(events.find(e => e.id === 'SYN-PROP-001'), original);
  assert.deepEqual(impact(events).map(x => x.proposalId), ['SYN-PROP-001', 'SYN-PROP-002']);
  assert.equal(evaluate(events, 'SYN-OPT-014', events.length - 1).disposition, 'release');
  assert.throws(() => appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-25T00:00:00Z'), /already corrected/i);
  const replayedDuplicate = [...events, { id: 'SYN-CORR-999', type: 'calibration_correction', calibrationId: 'SYN-CAL-022', invalidFrom: '2026-09-25T00:00:00Z' }];
  assert.equal(evaluate(replayedDuplicate, 'SYN-OPT-014').reasonCode, 'CAL_RETRACTED');
});

test('human disposition remains distinct and disagreement counts are derived', () => {
  assert.throws(() => appendHuman(seed(), 'SYN-OPT-014', 'hold'), /proposal/i);
  let events = appendProposal(seed(), 'SYN-OPT-014');
  events = appendHuman(events, 'SYN-OPT-014', 'hold', 'Requires engineer review');
  const stats = reviewStats(events);
  assert.equal(stats.proposals, 1);
  assert.equal(stats.disagreements, 1);
  assert.equal(stats.pending, 0);
  assert.equal(replay(events).parts.get('SYN-OPT-014').human.disposition, 'hold');
  events = appendProposal(events, 'SYN-OPT-014');
  const later = reviewStats(events);
  assert.equal(later.proposals, 2);
  assert.equal(later.disagreements, 1);
  assert.equal(later.pending, 1);
});

test('correction impact excludes unrelated state changes', () => {
  let events = appendProposal(seed(), 'SYN-OPT-014');
  const changed = structuredClone(events.find(e => e.id === 'SYN-MEAS-014'));
  changed.id = 'SYN-MEAS-014-REV';
  changed.transmission[532] = 96;
  events = [...events, changed];
  assert.equal(evaluate(events, 'SYN-OPT-014').disposition, 'hold');
  assert.deepEqual(impact(events), []);
});

test('correction impact excludes proposals whose original measurement predates invalidation', () => {
  let events = appendProposal(seed(), 'SYN-OPT-014');
  events = appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-25T00:00:00Z');
  assert.equal(evaluate(events, 'SYN-OPT-014').disposition, 'release');
  assert.deepEqual(impact(events), []);
});
