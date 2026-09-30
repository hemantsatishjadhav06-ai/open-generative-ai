# Aquora Figma redesign proposal

Date: 2026-09-30. This is an editable conceptual proposal prepared alongside the launch audit and frontend changes. It is not a pixel-for-pixel capture of the deployed application and is not evidence that paid generation or backend integrations passed production tests.

## Review links

| View | Figma node | Size | Purpose |
| --- | --- | --- | --- |
| [Design file](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05) | File `5GVn4DlY1vo3ngNHgpPm05` | — | Full proposal and local components |
| [Desktop landing](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05?node-id=3-3) | `3:3` | 1440 × 1578 | Product purpose, goal-based entry points, access and budget guidance |
| [Desktop image studio](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05?node-id=3-4) | `3:4` | 1440 × 1174 | Prompt → model/settings → cost → generation → result |
| [Mobile studio recovery](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05?node-id=3-5) | `3:5` | 390 × 1202 | Retained prompt, visible cost state and reconnection to an existing job |
| [Reusable component family](https://www.figma.com/design/5GVn4DlY1vo3ngNHgpPm05?node-id=4-56) | `4:56` | 1440 px canvas width | Buttons, field, navigation, goal card and setup/error messages |

## Product and visual decisions

- Aquora naming and the compact line-drawn A mark match the frontend redesign direction. The product typefaces are Inter for body/UI text and Space Grotesk for headings, verified against `tailwind.config.js` and the studio CSS.
- The public landing uses off-white `#F5F7F7`, ink `#17272D` and turquoise `#73D7C4`. The studio uses app `#0B141C`, panel `#111E28`, turquoise `#7BD9C8` and desaturated blue `#608FC8`.
- The landing headline is “Your ideas. One creative workspace.” Four entry cards describe Image, Video, Audio and Automation goals in plain language.
- Capability claims include the caveat that models and tools depend on workspace configuration. Cost visibility is shown as unavailable until a model can be reviewed; no dollar price, budget balance or successful generation has been fabricated.
- The geometric landing preview is explicitly labelled “Interface illustration” and “Illustrative preview — create your own result in the studio.” It is an editable vector illustration, not a generated customer asset or an actual generation result.
- The studio shows a visible prompt label, model/settings controls, cost guidance, a disabled first-generation action and a useful empty result state. Its sidebar is 240 px wide.
- The mobile recovery action is “Resume generation.” Its intended behavior is to reconnect and re-poll the existing job. It must not automatically resubmit a paid generation after refresh or connection loss. Implementation and regression evidence belong to the frontend/QA reports.

## Discovery and reuse evidence

1. Searched the repository for Code Connect files (`*.figma.*`): none were found.
2. Inspected the new target file: no existing screens, local components, variables or text styles were present.
3. Called Figma library discovery, then searched the subscribed Simple Design System for Button, Input, Card, surface variables and Heading styles. The server accepted only one query per call, so the remaining required searches were executed individually.
4. Inspected Button, Input Field and Card component APIs, typography and token bindings. The assets use a library-owned semantic model and Inter headings; these do not match the agreed Aquora color tokens and Space Grotesk heading hierarchy. A small local component family was created with editable text properties and Aquora bindings. No remote component was detached or changed.

## Editable structure and validation

| Check | Evidence/result |
| --- | --- |
| Semantic layer | 44 variables across primitives, Light/Dark color semantics and layout; semantic colors alias primitives |
| Variable hygiene | No `ALL_SCOPES`; all variables have explicit scopes and `var(...)` WEB syntax |
| Typography | 8 shared text styles; 116 screen text layers: 95 Inter, 21 Space Grotesk; zero unapproved fonts |
| Reusable components | 5 families, 3 component sets, 9 source components/variants; editable labels/content through TEXT properties |
| Screen instances | 25 component instances across the three screens |
| Hierarchy | Native auto-layout containers, editable text, SVG/vector mark and illustration; no flattened whole-UI image fills |
| Layout bounds | No child extends beyond any screen's bounds in the inspected compositions |
| Text completeness | No empty screen text layers; normal-scale visual inspection found no clipped or unreadable controls |
| Goal cards | Four desktop goal cards have equal 240 px heights after correcting inherited instance sizing |
| Visual review | Full landing, desktop studio and mobile compositions rendered and inspected; landing and mobile were re-rendered after the final scoped fixes |

Screenshots were produced directly from the Figma nodes during the review. The final inspected screenshots show the same editable nodes linked above. The proposal deliberately illustrates first-use and connection-recovery states rather than asserting that live provider access, charges, output persistence or generation success has been verified.

## Handoff limits

This file provides proposed layouts and reusable styling. It does not contain a wired interaction prototype, Code Connect mappings or designs for every specialist studio. The implemented frontend retains specialist journeys while applying the shared brand, shell, landing and guidance changes described in `docs/audit-design.md`. Further studio layout replacement should preserve accessible labels, actual configured-provider availability, accurate server budget data, and existing-job reconnection before any paid retry.
