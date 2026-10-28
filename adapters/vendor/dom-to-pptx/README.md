# dom-to-pptx 2.0.1

Unmodified compressed browser UMD bundle and MIT license copied from the
OpenDesign desktop vendor directory. This is the same pinned converter used by
the desktop editable PowerPoint exporter. It exposes
`window.domToPptx.exportToPptx(elements, options)`.

Only the isolated renderer loads this bundle, directly from the checked-in
gzip file. No install-time browser download, external script loading, or user
credential access is required. The converter emits editable shapes and text;
unsupported CSS may differ from Chromium screenshots. Screenshot PPTX remains
a separate explicit mode.
