# Aquora interface redesign

The repository and installed application call the product **Aquora**. Open Generative AI remains the repository name. The redesign keeps that product identity and replaces neon effects, vague claims and a flat list of studios with a clear overview and calm media workspace.

## Implemented design

- Public landing uses a soft off-white background, ink typography, restrained turquoise, spacious goal cards and a labelled interface illustration. Every existing studio remains directly reachable, grouped under images, video, audio and creative automation. Reelty is identified as a separate connected application.
- The studio uses ink surfaces with clear selected states instead of neon gradients and glowing borders. The sidebar is wider, labels are more readable, and the main content can shrink correctly on narrow screens. Mobile navigation has a visible close control. A skip link and named main region make the workspace easier to navigate by keyboard and assistive technology.
- Empty states in Image, Video and Audio studios explain the next step. The shared illustration is compact and flat. Prompt fields and image-reference remove controls have accessible names; Audio text labels are associated with their fields.
- Access-code and server-unavailable views use professional, direct language. Full-screen access views can return to the overview. Settings now keeps keyboard focus inside its modal and restores it to the trigger when closed.
- Landing, metadata, social preview and PWA descriptions no longer advertise an unqualified 300+ model count, permanent provider support or universal sign-up-free access. Copy explains workspace configuration, estimated generation costs, administrator-managed access and device-local generation history. English and Chinese copy are maintained together.
- Turquoise/ink tokens are shared by the application and studio package. The default agent chat theme is aligned with Aquora; optional user-selected chat themes are retained. Brand mark, social card and installable-app icons use a consistent compact A mark.
- Image, Video and Audio now save pending signed job tokens immediately in separate workspace-scoped browser storage. Reloading while the same sign-in session is active resumes polling the existing job, with no new paid submission. Terminal results clear pending state; network failures, throttling, authentication interruptions and timeouts retain it and expose Resume. Completed history and previews save synchronously before pending removal. Batch image results are saved independently, so one failing request does not discard successful siblings. Audio results now remain visible and scrollable on mobile.
- A confirmed logout defect is fixed: unsuccessful DELETE /api/session responses now keep the local session intact and surface the error instead of falsely showing the user as signed out.

## Design system

| Role | Token |
| --- | --- |
| Landing canvas | `#F5F7F7` |
| Landing text | `#17272D` |
| Workspace canvas | `#0B141C` |
| Workspace panel | `#111E28` |
| Workspace card | `#162630` |
| Workspace raised | `#1D303C` |
| Primary action | `#7BD9C8` |
| Action text | `#102721` |
| Secondary accent | `#608FC8` |
| Secondary text | `#A8BAC5` |
| Typography | Inter body, Space Grotesk headings |

Focus is visibly indicated, motion respects the reduced-motion preference, and the mobile workspace uses dynamic viewport height. The marketing preview is explicitly illustrative, rather than an actual generated result.

Opaque token-pair contrast calculations: action text on turquoise **9.44:1**, main workspace text on panel **15.12:1**, secondary text on panel **8.46:1**, muted text on panel **5.79:1**. These checks concern the named token pairs, not every opacity, placeholder, custom theme or specialist control. They do not establish full WCAG compliance.

## Validation and limits

Targeted ESLint checks passed with no errors for the landing, shell, access view, metadata and session client. The studio component checks passed with no errors and existing hook/image warnings. Locale JSON parsing and `git diff --check` passed. The full application build, regression suite and browser review are recorded in the launch audit and QA results.

The redesign preserves existing model/API contracts and provider integrations. Some specialist and vendored tools retain their existing detailed control layouts; the shared typography, shell, palette and navigation are consistent, but a complete interaction redesign of every specialist canvas requires further product work. Generation history remains local to the device; this redesign does not introduce cloud media persistence. Pending-job recovery requires local browser storage and the original active sign-in session; the gateway binds tokens to that session, so signing out and creating a new session cannot recover an old token. Specialist studios do not yet have this recovery behavior. Model availability, failure recovery, cancellation support and production integration readiness are technical limitations tracked separately in the audit.

Pending-recovery helper regressions pass (4 tests): workspace isolation; transient versus terminal failures; atomic completed-history persistence and deduplication; malformed/unavailable storage. Browser reload regressions are added for each of Image, Video and Audio and are verified with the final build in the QA report.


Agent first-message regression: the first message now submits directly from the mounted chat, with one conversation id retained for follow-up messages and manual retries. A successful persisted turn updates the canonical conversation URL without remounting. The previous unscoped browser pending-message handoff and automatic paid replay are removed. Two transport regressions pass; browser tests cover create/edit/chat/follow-up/reload/delete in the QA suite.


Agent navigation root cause: saving an agent scheduled an untracked 1.5-second redirect to the agent gallery. Opening Chat immediately after saving unmounted the editor but the old timer still redirected the active conversation. The delayed redirect is removed; Save keeps the editor open with its existing success feedback, and Back/Chat controls handle navigation explicitly. The fast Save → Chat journey is covered by the browser regression.
