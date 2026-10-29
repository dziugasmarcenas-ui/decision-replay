export const RULE_VERSION = 'synthetic-qc-rules/1.0';
export const WAVELENGTHS = Object.freeze([450, 500, 532, 600, 700, 800, 900, 1064, 1200]);

export function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV is empty');
  const rows = [];
  let row = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closedQuote = true; }
      else if (cell === '' && !closedQuote) quoted = true;
      else throw new Error('CSV quote must begin at the start of a field');
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = ''; closedQuote = false;
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = []; closedQuote = false;
    } else {
      if (closedQuote) throw new Error('CSV has characters after a closing quote');
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header?.length || header.some(name => !name.trim()) || new Set(header.map(name => name.trim())).size !== header.length) throw new Error('CSV header is invalid');
  return body.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((name, j) => [name.trim(), values[j].trim()]));
  });
}

function requiredColumns(rows, columns, label) {
  if (!rows.length) throw new Error(`${label} contains no records`);
  for (const column of columns) if (!(column in rows[0])) throw new Error(`${label} missing column ${column}`);
}

export function canonicalPartId(alias) {
  const match = String(alias ?? '').trim().match(/^(?:SYN[- ]?)?OPT[- ]?0*(\d{1,3})$/i);
  if (!match) throw new Error(`Unknown part alias: ${alias}`);
  return `SYN-OPT-${match[1].padStart(3, '0')}`;
}

function validTime(value, label) {
  // Date.parse alone accepts local times and normalizes invalid dates such as 30 February.
  const fields = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!fields) throw new Error(`${label} has malformed timestamp`);
  const [, year, month, day, hour, minute, second, zone] = fields;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw new Error(`${label} has malformed timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} has malformed timestamp`);
  return ms;
}

function uniqueId(set, id) {
  if (!id || set.has(id)) throw new Error(`Missing or duplicate raw ID: ${id}`);
  set.add(id);
}

export function normalizeExports({ coatingCsv, spectralCsv, reference, hashes }) {
  const coating = parseCsv(coatingCsv);
  const spectral = parseCsv(spectralCsv);
  requiredColumns(coating, ['job_ref', 'optic_serial', 'coating_run', 'finished_at', 'recipe_revision'], 'Coating export');
  requiredColumns(spectral, ['specimen', 'measurement_ref', 'measured_at', 'instrument_class', 'calibration_id', 'spec_revision', ...WAVELENGTHS.map(w => `t_${w}`)], 'Spectral export');
  if (!reference?.specification?.id || !Array.isArray(reference?.calibrations)) throw new Error('Reference records are incomplete');
  for (const key of ['coating', 'spectral', 'reference']) if (!hashes?.[key]) throw new Error(`Source hash missing: ${key}`);

  const ids = new Set();
  const spec = reference.specification;
  validTime(spec.effectiveAt, 'Specification');
  uniqueId(ids, spec.id);
  const floorPct = {};
  for (const wavelength of WAVELENGTHS) {
    const floor = spec.floorPct?.[wavelength];
    if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0 || floor > 100) throw new Error(`Specification floor invalid at ${wavelength} nm`);
    floorPct[wavelength] = floor;
  }
  const events = [{ id: spec.id, type: 'specification', at: spec.effectiveAt, floorPct, source: { file: 'reference.json', rawId: spec.id, sha256: hashes.reference } }];
  const calibrations = new Map();
  for (const cal of reference.calibrations) {
    uniqueId(ids, cal.id);
    if (!String(cal.instrumentClass ?? '').trim()) throw new Error(`Calibration instrument class missing: ${cal.id}`);
    if (validTime(cal.validFrom, cal.id) >= validTime(cal.validUntil, cal.id)) throw new Error(`Calibration interval invalid: ${cal.id}`);
    calibrations.set(cal.id, cal);
    events.push({ id: cal.id, type: 'calibration', at: cal.validFrom, validFrom: cal.validFrom, validUntil: cal.validUntil, instrumentClass: cal.instrumentClass, source: { file: 'reference.json', rawId: cal.id, sha256: hashes.reference } });
  }
  const coatParts = new Set();
  for (const row of coating) {
    uniqueId(ids, row.job_ref);
    validTime(row.finished_at, row.job_ref);
    const partId = canonicalPartId(row.optic_serial);
    if (coatParts.has(partId)) throw new Error(`Duplicate coating part: ${partId}`);
    coatParts.add(partId);
    events.push({ id: row.job_ref, type: 'coating_complete', at: row.finished_at, partId, coatingRun: row.coating_run, recipeRevision: row.recipe_revision, source: { file: 'coating_export.csv', rawId: row.job_ref, rawPart: row.optic_serial, sha256: hashes.coating } });
  }
  const measuredParts = new Set();
  for (const row of spectral) {
    uniqueId(ids, row.measurement_ref);
    validTime(row.measured_at, row.measurement_ref);
    const partId = canonicalPartId(row.specimen);
    if (!coatParts.has(partId)) throw new Error(`Spectral part alias does not join coating export: ${row.specimen}`);
    if (measuredParts.has(partId)) throw new Error(`Duplicate spectral part: ${partId}`);
    measuredParts.add(partId);
    if (!String(row.instrument_class ?? '').trim()) throw new Error(`Measurement instrument class missing: ${row.measurement_ref}`);
    if (!calibrations.has(row.calibration_id)) throw new Error(`Unknown calibration: ${row.calibration_id}`);
    if (row.spec_revision !== spec.id) throw new Error(`Unknown specification revision: ${row.spec_revision}`);
    const transmission = {};
    for (const wavelength of WAVELENGTHS) {
      const raw = row[`t_${wavelength}`];
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Non-finite or invalid transmission at ${wavelength} nm for ${row.measurement_ref}`);
      transmission[wavelength] = value;
    }
    events.push({ id: row.measurement_ref, type: 'spectral_test', at: row.measured_at, partId, instrumentClass: row.instrument_class, calibrationId: row.calibration_id, specRevision: row.spec_revision, transmission, source: { file: 'spectral_export.csv', rawId: row.measurement_ref, rawPart: row.specimen, sha256: hashes.spectral } });
  }
  return events;
}

export function replay(events, through = events.length) {
  const state = { parts: new Map(), specifications: new Map(), calibrations: new Map(), corrections: new Map(), proposals: [], humanActions: [] };
  for (const event of events.slice(0, through)) {
    if (event.type === 'specification') state.specifications.set(event.id, event);
    if (event.type === 'calibration') state.calibrations.set(event.id, event);
    if (event.type === 'calibration_correction') {
      const prior = state.corrections.get(event.calibrationId);
      if (!prior || validTime(event.invalidFrom, event.id) < validTime(prior.invalidFrom, prior.id)) state.corrections.set(event.calibrationId, event);
    }
    if (event.partId) {
      if (!state.parts.has(event.partId)) state.parts.set(event.partId, { id: event.partId, coating: null, measurement: null, proposals: [], human: null, humans: [] });
      const part = state.parts.get(event.partId);
      if (event.type === 'coating_complete') part.coating = event;
      if (event.type === 'spectral_test') part.measurement = event;
      if (event.type === 'shadow_proposal') { part.proposals.push(event); state.proposals.push(event); }
      if (event.type === 'human_disposition') { part.human = event; part.humans.push(event); state.humanActions.push(event); }
    }
  }
  return state;
}

export function evaluate(events, partId, through = events.length) {
  const state = replay(events, through);
  const part = state.parts.get(partId);
  const evidenceIds = [];
  const result = (disposition, reasonCode, explanation, failedWavelengths = []) => ({ disposition, reasonCode, explanation, evidenceIds: [...evidenceIds], failedWavelengths, ruleVersion: RULE_VERSION });
  if (!part?.coating) return result('abstain', 'COATING_MISSING', 'No coating completion is linked to this optic.');
  evidenceIds.push(part.coating.id);
  if (!part.measurement) return result('abstain', 'MEASUREMENT_MISSING', 'No spectral result is linked to this optic.');
  const measurement = part.measurement;
  evidenceIds.push(measurement.id);
  if (measurement.partId !== partId) return result('abstain', 'PART_MISMATCH', 'Measurement belongs to another optic.');
  if (validTime(measurement.at, measurement.id) < validTime(part.coating.at, part.coating.id)) return result('abstain', 'ORDER_INVALID', 'Measurement predates coating completion.');
  const spec = state.specifications.get(measurement.specRevision);
  if (!spec) return result('abstain', 'SPEC_REV_MISMATCH', 'The referenced specification revision is unavailable.');
  evidenceIds.push(spec.id);
  if (validTime(measurement.at, measurement.id) < validTime(spec.at, spec.id)) return result('abstain', 'SPEC_NOT_EFFECTIVE', 'Specification was not effective at measurement time.');
  const cal = state.calibrations.get(measurement.calibrationId);
  if (!cal) return result('abstain', 'CAL_MISSING', 'Calibration evidence is unavailable.');
  evidenceIds.push(cal.id);
  if (!String(cal.instrumentClass ?? '').trim() || !String(measurement.instrumentClass ?? '').trim() || cal.instrumentClass !== measurement.instrumentClass) return result('abstain', 'CAL_INSTRUMENT_MISMATCH', 'Calibration does not cover this instrument class.');
  const measuredAt = validTime(measurement.at, measurement.id);
  if (measuredAt < validTime(cal.validFrom, cal.id) || measuredAt >= validTime(cal.validUntil, cal.id)) return result('abstain', 'CAL_EXPIRED', 'Calibration did not cover the measurement time.');
  const correction = state.corrections.get(cal.id);
  if (correction && measuredAt >= validTime(correction.invalidFrom, correction.id)) {
    evidenceIds.push(correction.id);
    return result('abstain', 'CAL_RETRACTED', 'A later correction invalidated calibration coverage for this measurement.');
  }
  const failed = [];
  for (const wavelength of WAVELENGTHS) {
    const value = measurement.transmission[wavelength];
    const floor = spec.floorPct[wavelength];
    if (!Number.isFinite(value) || !Number.isFinite(floor)) return result('abstain', 'MEASUREMENT_INCOMPLETE', 'A required transmission or limit value is unavailable.');
    if (value < floor) failed.push(wavelength);
  }
  if (failed.length) return result('hold', 'BELOW_LIMIT', `Synthetic transmission is below the synthetic floor at ${failed.join(', ')} nm.`, failed);
  return result('release', 'WITHIN_LIMIT', 'All required synthetic transmission points meet the synthetic floor.');
}

export function appendProposal(events, partId) {
  const snapshot = evaluate(events, partId);
  const number = events.filter(event => event.type === 'shadow_proposal').length + 1;
  return [...events, { id: `SYN-PROP-${String(number).padStart(3, '0')}`, type: 'shadow_proposal', at: '2026-09-29T12:00:00Z', partId, snapshot, basisEventIds: [...snapshot.evidenceIds], ruleVersion: RULE_VERSION }];
}

export function appendHuman(events, partId, disposition, note = '') {
  if (!['release', 'hold', 'rework', 'abstain'].includes(disposition)) throw new Error('Unknown human disposition');
  const part = replay(events).parts.get(partId);
  if (!part) throw new Error('Unknown optic');
  const proposal = part.proposals.at(-1);
  if (!proposal) throw new Error('Human disposition requires a shadow proposal');
  if (part.humans.some(action => action.proposalId === proposal.id)) throw new Error('Proposal already has a human disposition');
  const number = events.filter(event => event.type === 'human_disposition').length + 1;
  return [...events, { id: `SYN-HUM-${String(number).padStart(3, '0')}`, type: 'human_disposition', at: '2026-09-29T12:10:00Z', partId, proposalId: proposal.id, disposition, note }];
}

export function appendCalibrationCorrection(events, calibrationId, invalidFrom) {
  const state = replay(events);
  if (!state.calibrations.has(calibrationId)) throw new Error('Unknown calibration');
  if (state.corrections.has(calibrationId)) throw new Error('Calibration already corrected');
  validTime(invalidFrom, 'Calibration correction');
  const number = events.filter(event => event.type === 'calibration_correction').length + 1;
  return [...events, { id: `SYN-CORR-${String(number).padStart(3, '0')}`, type: 'calibration_correction', at: '2026-09-29T12:20:00Z', calibrationId, invalidFrom, note: 'Synthetic backdated calibration finding' }];
}

export function impact(events, through = events.length) {
  const state = replay(events, through);
  return state.proposals.flatMap(proposal => {
    const calibrationId = proposal.basisEventIds.find(id => state.calibrations.has(id));
    const correction = calibrationId && state.corrections.get(calibrationId);
    if (!correction) return [];
    const basisMeasurement = events.slice(0, through).find(event => event.type === 'spectral_test' && proposal.basisEventIds.includes(event.id));
    if (!basisMeasurement || validTime(basisMeasurement.at, basisMeasurement.id) < validTime(correction.invalidFrom, correction.id)) return [];
    const current = evaluate(events, proposal.partId, through);
    if (current.reasonCode !== 'CAL_RETRACTED' || !current.evidenceIds.includes(correction.id)) return [];
    if (current.disposition === proposal.snapshot.disposition && current.reasonCode === proposal.snapshot.reasonCode) return [];
    return [{ proposalId: proposal.id, partId: proposal.partId, before: proposal.snapshot, now: current, correctedRecordId: correction.id }];
  });
}

export function reviewStats(events, through = events.length) {
  const state = replay(events, through);
  let agreements = 0, disagreements = 0, pending = 0, candidateFalseReleases = 0;
  for (const proposal of state.proposals) {
    const human = state.parts.get(proposal.partId)?.humans.find(action => action.proposalId === proposal.id);
    if (!human) { pending++; continue; }
    if (human.disposition === proposal.snapshot.disposition) agreements++;
    else {
      disagreements++;
      if (proposal.snapshot.disposition === 'release' && human.disposition !== 'release') candidateFalseReleases++;
    }
  }
  return { proposals: state.proposals.length, agreements, disagreements, pending, candidateFalseReleases };
}
