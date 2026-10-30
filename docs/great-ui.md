# Great UI reference

Adapted interaction patterns from [Great UI](https://www.great-ui.com/), specifically [Revision Timeline](https://www.great-ui.com/components/revision-timeline) and [Accordion](https://www.great-ui.com/components/accordion).

This is a local vanilla JavaScript/CSS implementation for this end-user application. No upstream React or Motion source is included, and no component library is redistributed. The reference uses a custom license; its README's MIT wording should not be treated as the authoritative license.

The event dial retains every recorded event in append order. It does not use the reference's per-day revision deduplication. Previous/next buttons and the native range input share the same playhead. Tick targets are at least 44 px wide; keyboard focus and reduced-motion behaviour remain native and immediate. Native details elements retain keyboard and screen-reader disclosure semantics with plus/minus affordances.
