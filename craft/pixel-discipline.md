# Pixel discipline

Universal geometry and raster-fit rules for HTML artifacts, decks, previews,
and exports. The active design system owns spacing tokens and visual style.
This reference governs whether the final pixels preserve those decisions.
It complements typography and hierarchy; it does not choose fonts or a scale.

## Establish the rendering frame

- Declare the intended viewport or export dimensions before composing. A deck
  has a fixed aspect ratio; a document reflows. Do not stretch either into the
  other's geometry.
- Use CSS pixels for layout. Device pixel ratio changes raster resolution,
  not the logical spacing or size of controls.
- Apply `box-sizing: border-box` consistently. Include padding and borders
  when checking whether a grid or row fits its containing block.
- Let containers determine width. Use `min-width: 0` for flexible children
  that must shrink, and allow long URLs and identifiers to wrap deliberately.

## Align visible edges

- Align related elements to a shared container or grid. Avoid independent
  magic offsets that happen to match in one screenshot.
- Use the design system's spacing steps. A deliberate optical adjustment
  should correct a visible misalignment, not introduce a second spacing scale.
- Check the visible mark, not only the asset box: transparent image padding
  and asymmetric icon paths can make numerically aligned content look uneven.
- Keep repeated border widths and corner radii consistent. Inspect fine
  dividers at the target scale; transforms and fractional raster positions can
  blur thin edges. Do not globally round text or layout dimensions to fix one
  divider.

## Preserve content at every supported size

- Reflow columns when their content cannot fit. Scaling an entire interface
  down makes text and controls unusable even if the screenshot still fits.
- Do not hide overflow globally to conceal a layout bug. Clip only intentional
  crops or bounded visual effects; keep focus rings and essential text visible.
- Test the longest real heading, mixed-language text, empty states, and dense
  content. A layout that fits only the shortest sample is incomplete.
- For fixed-frame decks, fit each slide's content inside its safe area before
  applying a single proportional frame scale. Keep the same safe area across
  slides rather than shrinking individual dense slides.

## Use assets at their real aspect ratio

- Set image dimensions or `aspect-ratio` so loading does not move the layout.
  Use `object-fit: contain` when all information must remain visible, and
  `cover` only when cropping is intentional.
- Preserve source proportions. Do not stretch logos, screenshots, or diagrams.
  Prefer SVG for line art; provide sufficient raster resolution for the actual
  export dimensions and device scale.
- Wait for fonts and images before capturing. A fallback font can change line
  breaks and invalidate an otherwise correct fit check.

## Inspect the delivered artifact

Check narrow and wide supported viewports, the intended deck frame, and the
actual exported image/PDF. Inspect at 100% as well as fit-to-window: a reduced
preview can conceal clipping, blurred dividers, and undersized type. Confirm
that all pages/slides remain present, charts keep their labels, and no content
depends on a hover state to appear in a static export. Fix the source layout
and repeat the capture; do not paint over the exported pixels.
