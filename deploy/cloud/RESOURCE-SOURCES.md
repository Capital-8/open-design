# Official resource repair provenance

Tracking: OPEND-4356 / GitHub #9161. These are checked-in source resources for
the normal pinned `resources:prepare` path, not a relaxed local bundle.

| Bundled sample | Existing canonical source |
| --- | --- |
| `examples/guizang-ppt/example.html` | The same plugin's `assets/template.html`, inserting `assets/example-slides.html` at `SLIDES_HERE` and supplying its OpenDesign product title |
| `examples/html-ppt/example.html` | `examples/html-ppt-pitch-deck/example.html`, a complete authored deck in the same HTML-PPT system |
| `examples/replit-deck/example.html` | `design-templates/replit-deck/examples/example-atlas.html`, unchanged |
| `scenarios/od-plugin-authoring/examples/generated-plugin/` | `plugins/spec/examples/refine-critique-loop/{SKILL.md,open-design.json}`, normalized trailing newline only |

The first three paths are relative to `plugins/_official/`; their preview,
example output and context asset references all point to `example.html`.
Samples remain HTML with their actual slide content. External font URLs in
the canonical samples remain external; offline capture needs a font fallback.

The authoring sample is scenario-owned fixture data, not an independently
installed plugin. Both official metadata and SQLite catalog builders register
only plugin-root manifests (one legacy directory level or the tier/id layout),
not manifests inside a plugin's examples/assets. The fixture remains included
in that plugin's resource package. The portable upstream example stays in
`plugins/spec/examples/` and is not installed.

Existing consumers of the planned `motion-discipline` slug use the shipped
`animation-discipline` instead, as `craft/README.md` already directs. Consumers
of `typographic-rhythm` use `typography` plus `typography-hierarchy`, preserving
type metrics and hierarchy/rhythm guidance without introducing a duplicate
rulebook. Both planned slugs remain reserved in `FUTURE_SECTIONS.md` for other
future consumers. `pixel-discipline` now ships its own narrow geometry,
responsive-fit and raster-export rules, consumed by the existing landing/deck
resources. No missing reference is ignored by publication.
