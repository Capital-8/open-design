# Generated-plugin source example

This scenario fixture copies the portable `refine-critique-loop` example from
`plugins/spec/examples/`. Its manifest is named `open-design.example.json` so
bundled-plugin discovery does not install it as another first-party plugin.

When creating a local user plugin, copy this directory's `SKILL.md` and copy
`open-design.example.json` as `open-design.json`. Adapt the name, description,
workflow and inputs for the user's goal, then validate the resulting plugin
folder before offering it for installation. The sample folder in the resource
package is reference material; it is not itself advertised as installed.
