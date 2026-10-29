import { WAVELENGTHS, normalizeExports, replay, evaluate, appendProposal, appendHuman, appendCalibrationCorrection, impact, reviewStats } from './engine.js';

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { $(selector).textContent = value; };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const labels = { specification: 'Specification', calibration: 'Calibration', coating_complete: 'Coating complete', spectral_test: 'Measurement', shadow_proposal: 'Proposal', human_disposition: 'Human hold', calibration_correction: 'Correction' };
const names = { release: 'Release eligible', hold: 'Hold', abstain: 'Not established' };
let baseline = [], events = [], through = 0, selected = 'SYN-OPT-014';

async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function chart(measurement, spec) {
  if (!measurement || !spec) return '<p class="chart-empty">No measurement is visible at this point in the history.</p>';
  const x = value => 42 + (value - 450) / 750 * 560;
  const y = value => 190 - (value - 96) / 4 * 170;
  const path = values => WAVELENGTHS.map((w, i) => `${i ? 'L' : 'M'}${x(w).toFixed(2)},${y(values[w]).toFixed(2)}`).join(' ');
  const grid = [96, 97, 98, 99, 100].map(value => `<line x1="42" y1="${y(value)}" x2="602" y2="${y(value)}" stroke="#dde4e6"/><text x="30" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join('');
  const ticks = [450, 532, 700, 900, 1064, 1200].map(w => `<text x="${x(w)}" y="213" text-anchor="middle">${w}</text>`).join('');
  const points = WAVELENGTHS.map(w => `<circle cx="${x(w)}" cy="${y(measurement.transmission[w])}" r="${measurement.transmission[w] < spec.floorPct[w] ? 4.5 : 3}" fill="${measurement.transmission[w] < spec.floorPct[w] ? '#b54122' : '#25588a'}"><title>${w} nm: ${measurement.transmission[w]}%</title></circle>`).join('');
  return `<svg viewBox="0 0 630 235" aria-hidden="true" fill="none"><g fill="#546671" font-family="system-ui,sans-serif" font-size="10">${grid}${ticks}<text x="42" y="10">Transmission (%)</text><text x="602" y="232" text-anchor="end">Wavelength (nm)</text></g><path d="${path(spec.floorPct)}" stroke="#b54122" stroke-width="1.7" stroke-dasharray="5 5"/><path d="${path(measurement.transmission)}" stroke="#25588a" stroke-width="2.5"/>${points}</svg>`;
}

function sourceCard(event, filename) {
  if (!event) return `<div class="source"><a href="./data/${filename}">${filename}</a><p>No record visible yet.</p></div>`;
  return `<div class="source"><a href="./data/${filename}">${filename}</a><p><span>Raw part</span> ${escape(event.source.rawPart)}<br><span>Record</span> ${escape(event.source.rawId)}</p><code title="Full source file SHA-256">${escape(event.source.sha256)}</code></div>`;
}

function render() {
  const state = replay(events, through);
  const part = state.parts.get(selected);
  const result = evaluate(events, selected, through);
  const measurement = part?.measurement;
  const spec = measurement && state.specifications.get(measurement.specRevision);
  const proposal = part?.proposals.at(-1);
  const human = proposal && part.humans.find(action => action.proposalId === proposal.id);
  const affected = impact(events, through);
  const stats = reviewStats(events, through);
  const atHead = through === events.length;
  const corrected = state.corrections.has('SYN-CAL-022');

  text('#position', `Event ${through}`);
  text('#measurement-id', measurement?.id ?? 'No measurement');
  text('#measurement-context', measurement ? `${selected} · ${measurement.at.replace('T', ' ').replace('Z', ' UTC')} · ${measurement.instrumentClass}` : 'The playhead is before this component’s measurement.');
  $('#chart').innerHTML = chart(measurement, spec);
  $('#chart').setAttribute('aria-label', measurement ? `Transmission for ${selected}. ${result.explanation}` : 'No measurement at this point.');
  $('#measurement-table').innerHTML = measurement && spec ? `<table><caption>Invented values; transmission in percent.</caption><thead><tr><th scope="col">Wavelength (nm)</th><th scope="col">Measured (%)</th><th scope="col">Floor (%)</th></tr></thead><tbody>${WAVELENGTHS.map(w => `<tr><th scope="row">${w}</th><td>${measurement.transmission[w].toFixed(2)}</td><td>${spec.floorPct[w].toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '<p>No values visible yet.</p>';
  $('#sources').innerHTML = sourceCard(part?.coating, 'coating_export.csv') + sourceCard(measurement, 'spectral_export.csv');
  $('#verdict').dataset.kind = result.disposition;
  text('#verdict-label', names[result.disposition]);
  text('#reason', result.reasonCode);
  text('#explanation', result.explanation);
  text('#rule', result.ruleVersion);
  $('#evidence').innerHTML = result.evidenceIds.map(id => `<li>${escape(id)}</li>`).join('') || '<li>No supporting evidence yet</li>';
  text('#proposal-verdict', proposal ? names[proposal.snapshot.disposition] : 'Not proposed');
  text('#proposal-detail', proposal ? `${proposal.id} · ${proposal.snapshot.reasonCode} · ${proposal.ruleVersion}` : 'Step 1 captures the evidence and rule version.');
  $('.record.original').classList.toggle('changed', !!proposal && proposal.snapshot.reasonCode !== result.reasonCode);
  text('#human-verdict', human ? names[human.disposition] : 'Not reviewed');
  text('#human-detail', human ? `${human.id} · reviews ${human.proposalId}. ${human.note}` : 'A human hold will not overwrite the proposal.');

  $('#propose').disabled = !atHead || state.proposals.length > 0;
  $('#human').disabled = !atHead || !proposal || !!human || corrected;
  $('#correct').disabled = !atHead || !state.humanActions.length || corrected;
  text('#action-hint', !atHead ? 'Viewing earlier history. Return the slider to the end to record another action.' : corrected ? 'The correction is recorded. Compare the original proposal, inspect the impact, or replay the earlier history.' : state.humanActions.length ? 'Append the calibration finding. The earlier proposal and human action will stay in the history.' : state.proposals.length ? 'Two components were eligible; one is below the invented limit. Record a human hold for the selected component.' : 'Start with “Propose release” to capture a proposal for each component.');
  $('#playhead').max = events.length;
  $('#playhead').value = through;
  text('#event-count', `${through} / ${events.length}`);
  text('#replay-note', atHead ? 'Showing all recorded events. Scrub backward to inspect earlier evidence.' : `Historical view: ${events.length - through} later event(s) hidden. Writes are disabled.`);
  $('#events').innerHTML = events.map((event, i) => `<button class="event${i >= through ? ' future' : ''}${event.type === 'calibration_correction' ? ' correction' : ''}" data-through="${i + 1}" aria-current="${through === i + 1}" aria-label="Show history through event ${i + 1}: ${escape(labels[event.type])}, ${escape(event.id)}"><small>${String(i + 1).padStart(2, '0')}</small><strong>${escape(labels[event.type])}</strong><code>${escape(event.id)}</code></button>`).join('');
  text('#impact-count', affected.length);
  $('#impacts').innerHTML = affected.length ? affected.map(item => `<div class="impact-row"><strong>${escape(item.partId)} · ${escape(item.proposalId)}</strong><p>${escape(names[item.before.disposition])} → ${escape(names[item.now.disposition])}</p><p>Correction <code>${escape(item.correctedRecordId)}</code></p></div>`).join('') : `<p class="empty">${corrected ? 'No earlier proposal in this view needs review.' : 'No correction has been recorded at this point.'}</p>`;
  text('#proposal-count', stats.proposals);
  text('#disagreement-count', stats.disagreements);
  text('#pending-count', stats.pending);
}

function act(update, announcement) {
  try {
    events = update();
    through = events.length;
    render();
    text('#announcement', announcement);
  } catch (error) {
    text('#announcement', error.message);
    text('#load-error', error.message);
    $('#load-error').hidden = false;
  }
}

$('#propose').addEventListener('click', () => act(() => [...replay(events).parts.keys()].reduce((log, id) => appendProposal(log, id), events), 'Three proposals recorded. Two release eligible, one held.'));
$('#human').addEventListener('click', () => act(() => appendHuman(events, selected, 'hold', 'Synthetic reviewer requests an engineering check.'), `Human hold recorded for ${selected}.`));
$('#correct').addEventListener('click', () => act(() => appendCalibrationCorrection(events, 'SYN-CAL-022', '2026-09-20T00:00:00Z'), 'Calibration correction recorded. Two earlier proposals need review.'));
$('#part').addEventListener('change', event => { selected = event.target.value; render(); text('#announcement', `Selected ${selected}. ${evaluate(events, selected, through).explanation}`); });
$('#playhead').addEventListener('input', event => { through = Number(event.target.value); render(); text('#announcement', `Showing ${through} of ${events.length} events. ${evaluate(events, selected, through).explanation}`); });
$('#events').addEventListener('click', event => { const button = event.target.closest('[data-through]'); if (button) { through = Number(button.dataset.through); render(); $(`#events [data-through="${through}"]`).focus({ preventScroll: true }); text('#announcement', `Showing history through event ${through}.`); } });
$('#reset').addEventListener('click', () => act(() => { selected = 'SYN-OPT-014'; $('#part').value = selected; return structuredClone(baseline); }, 'Scenario reset to the original source events.'));
$('#export').addEventListener('click', () => {
  const payload = { notice: 'Synthetic educational demonstration. Not a production audit record.', exportedAt: new Date().toISOString(), through, selectedPart: selected, events, evaluationsAtPlayhead: [...replay(events).parts.keys()].map(partId => ({ partId, ...evaluate(events, partId, through) })), impactAtPlayhead: impact(events, through) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'decision-replay-run.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function boot() {
  try {
    const read = async name => { const response = await fetch(`./data/${name}`); if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`); return response.text(); };
    const [coatingCsv, spectralCsv, referenceText] = await Promise.all(['coating_export.csv', 'spectral_export.csv', 'reference.json'].map(read));
    const [coating, spectral, reference] = await Promise.all([coatingCsv, spectralCsv, referenceText].map(fingerprint));
    baseline = normalizeExports({ coatingCsv, spectralCsv, reference: JSON.parse(referenceText), hashes: { coating, spectral, reference } });
    events = structuredClone(baseline); through = events.length;
    for (const id of ['#part', '#playhead', '#reset', '#export']) $(id).disabled = false;
    text('#load-status', 'Two CSV fixtures loaded · three components');
    $('#load-dot').classList.add('ready');
    render();
  } catch (error) {
    text('#load-status', 'Fixtures could not be loaded');
    text('#load-error', `${error.message} Start a local server with npm start, or use the hosted demo. No decisions are available.`);
    $('#load-error').hidden = false;
  }
}
boot();
