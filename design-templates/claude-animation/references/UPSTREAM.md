# Upstream provenance

- Repository: https://github.com/JohnHeibel/ClaudeAnimationBase
- Commit: `0ac8bf2b31942376cb6b8c4074715595d512acd2`
- Author: John Heibel
- License: MIT; original license preserved at `../LICENSE`.

`assets/runtime/core.js`, `clawd.js`, and `timeline.js` are copied verbatim
from upstream `src/`. The animation guide and the two reference images are
also unmodified. Their upstream paths and rendering commands are informative;
the Open Design SKILL.md owns the integrated execution workflow.

The starter HTML is an Open Design composition using the upstream browser API.
The daemon injects p5 2.3.3 and p5.brush 2.2.3 from its pinned dependencies.
Puppeteer, Chrome discovery, and upstream `render.mjs` are not bundled.
