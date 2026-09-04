# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product decisions

- The target is a 9:16 portrait touchscreen kiosk for users aged 60 and over.
- Voice is the primary interaction and touch is the complete fallback path.
- Health management results have only two levels: `routine` and `attention`.
- Do not expose chain-of-thought, internal tool state, diagnosis, or medication adjustment.
- Use `docs/requirements/station-advisor/screenshots/reference-v1.5.4/source-interface.png` as the current visual source of truth for the welcome screen; retain the existing XiaoAn digital-human assets and dynamic rig instead of the person shown in the reference image.
- Do not include human handoff, staff-help controls, or copy that offers to contact staff.
- Every delivered iteration must increment the semantic version and display the same version in the in-app product name, window/document title, package product name, and EXE filename.
- The Station Advisor keyboard control must explicitly enter keyboard mode and, in packaged Windows Electron, request the system touch keyboard; focusing the input alone is not an accepted trigger.
- Keep the Station Advisor bottom interaction area as one stable voice/text/action base without nested hard outlines, vertical accent strokes, or full-height side rails.
- Final speech-recognition text must submit immediately without a countdown or a second confirmation step; typed text remains manually editable and manually submitted.
- Keep the welcome, conversation, consent, scan, member, exit-dialog, listening, recognizing, answering, keyboard, paused, and error states in one cold-white/medical-blue visual system, and do not leave a large unused band above the primary content.
- The virtual-senior `community-full` test dataset must contain at least 10,000 deterministic synthetic residents and cover all 5 MCP / 16 Tool contracts with real structured success and boundary data; the original three personas remain smoke fixtures only.
- Community test data must be cross-domain consistent by resident, versioned and reproducible from a fixed seed. Never copy production records, package the full test dataset into the production release, or use generic `{ok:true}` as a successful Tool fixture.
- The test console must show actual generated/validated coverage. A target-state mock that says `16/16` or `覆盖就绪` must render as generating, incomplete, or blocked until current evidence proves those values.
- Single-person testing must let a product manager search and select a specific synthetic community resident, not merely choose cohort filters or one of the original three smoke personas.
- During single-person testing, the right-hand product surface must show that resident's live questions, responses and relevant interaction states through the actual XiaoAn UI. A second window, progress counter, static screenshot or completed report is not proof of live interaction.
- Keep resident identity, test session, runtime events and report correlated. Switching residents and cancelling runs must not leak prior events/data into the next session or production consultations. Distinguish same-window side-by-side observation, physical dual-display support and batch data scanning.
- On 2026-09-04 the user selected option 1 for single-person observation: `docs/design/virtual-senior-live-observer/option-1.png`. Preserve its resident search/list, selected-resident details, scenario/start-stop controls on the left and actual live XiaoAn surface on the right. Use original product avatar assets, never the generated mock's avatar.
- The user explicitly reaffirmed that resident health data and vital signs belong in the station MCP test scope. Audit real values, units, per-resident history, time filters, missing/stale/conflicting data and permissions separately from interface shape coverage; generic health Q&A is not evidence of personal health-query coverage. Do not enable production personal-data reads without the corresponding authorization path.
- The lip-development task has ended. The user directed remaining development to continue in the current task; do not route testing/UI/health work back to the completed lip task unless the user explicitly requests that again.

## Mandatory Taste gate

- For every UI, visual-design, design-to-code, frontend-presentation, button, layout, or motion task, read and apply the `design-taste-frontend` skill before editing UI code. This gate is required even when `impeccable`, `ui-ux-pro-max`, or Product Design skills are also used.
- Before implementation, record a one-line Design Read plus explicit `DESIGN_VARIANCE`, `MOTION_INTENSITY`, and `VISUAL_DENSITY` values.
- Before EXE packaging or UI handoff, `design-qa.md` must include Taste conclusions under `保留`, `增强`, `删除`, and `重做`. Missing Taste evidence blocks packaging and handoff.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
