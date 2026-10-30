# Decision Replay interface

## Surface

Mode: **Operate**. A reviewer should reach the interactive measurement and decision quickly, then inspect the event history and supporting evidence. This is a restrained refinement of the existing light scientific interface.

## Visual language

- System sans for prose and controls; monospace only for identifiers, rules and numeric data.
- Neutral background `#f5f6f4`, white workspace, dark ink `#1e3039`, secondary text `#5b6c74`.
- Blue for measurement and interactive focus; green for eligibility and completed steps; amber for a measurement hold; rust for unsupported evidence or a correction.
- A compact 34 px heading, 14 px introductory prose, 13 px supporting text and 12 px evidence identifiers. Numeric data use tabular figures.
- One outlined workspace, restrained 8–12 px corners, shared dividers between related regions. No decorative shadows or page-load choreography.

## Interaction

- Sequential controls distinguish ready, complete, waiting and historical states. Completion is shown with a check and an accessible state label, not faded opacity.
- Historical proposals retain their original neutral presentation. A `Preserved` label distinguishes a snapshot from changed current eligibility; it is not styled as an error.
- Provenance opens in a native disclosure. Short hashes expand to full fingerprints. No evidence is discarded.
- The chart draws at its container width so tick labels retain readable sizing on small screens. The numeric table remains available as a text alternative.
- Timeline buttons retain their DOM identity when scrubbing or selecting a component. Focus remains visible; the range describes the event and whether the view is historical.
- Hover effects apply only to fine pointers. A short press response excludes keyboard focus and reduced-motion mode. Replay itself is immediate.

## Responsive behaviour

The measurement and current decision share a two-column workspace above 720 px. Below that, they stack. The three scenario steps retain their order in a compact row; button labels carry the actions without subtitles, while complete/ready states remain visible. Source details collapse to one column on narrow phones. Native controls have at least 44 px tap height.

Keep the synthetic-data notice and production limitations visible. Presentation changes must not alter the domain rules or imply production authority.

## Copy restraint

Use layout, sequence and enabled states to explain the flow. Omit repeated instructions, button subtitles and promotional explanation sections. Keep the decision rationale, record identities, chart legend, synthetic-data boundary and accessible names. Show historical-view context only while viewing earlier events.
