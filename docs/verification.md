# Release verification — 29 October 2026

## Automated

`npm run check`: 19 Node tests passed, zero failures or skips; static build completed. JavaScript syntax checks passed. There are no third-party package dependencies.

Tests cover heterogeneous imports, identity joins, missing or mismatched evidence, immutable proposals, human linkage, correction scope, deterministic history prefixes, strict timestamps, malformed CSV, numeric limits, calibration interval boundaries, runtime build contents and preview-server request restrictions.

## Browser checks

Checked with Chromium using the local HTTP preview:

- Initial eligibility, all three proposals, human hold and calibration correction.
- Original proposal and human action stay visible after current eligibility changes.
- Exactly two affected earlier proposals; unrelated component remains held for its own below-limit measurement.
- Replay to before the correction restores prior eligibility; replay to zero shows missing evidence.
- Recording actions is disabled while viewing earlier history.
- JSON download completed; parsed output contains 14 events, two impacted proposals and the corrected evaluation.
- Reset returns to the imported fixture state.
- Layout checked at 320, 390, 768, 1024 and 1440 pixels; no horizontal page overflow.
- Mobile flow completed at 390 pixels.
- A simulated fixture HTTP 503 displays an error and leaves decision actions disabled.

Desktop screenshot and walkthrough are recordings of the actual synthetic app. They contain no external site or private project footage.

## Boundaries

No real equipment, metrology validation, production records or user study. Safari, Firefox, physical mobile devices and assistive technologies have not been independently verified. The fixture-load failure was simulated; physical network disconnection was not tested.

The hosted deployment and GitHub Actions results are verified separately at publication time; this local report does not claim a deployed result before it exists.
