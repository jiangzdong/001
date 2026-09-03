# XiaoAn Agent Harness

## Current boundary

The first implementation phase adds a local, provider-independent execution shell around XiaoAn business capabilities. Real-time ASR, TTS, visemes, avatar frames, and touch events remain on Electron IPC because they are high-frequency media streams rather than agent tools.

```text
renderer -> agent:turn -> Agent Runtime
                         -> DeepSeek planner
                         -> deterministic policy
                         -> Tool Registry
                         -> MCP Streamable HTTP gateway
                            -> remote MCP server or explicit local fixture adapter
                         -> DeepSeek response composer
                         -> structured answer + trace
```

The production Electron path uses DeepSeek for both intent/tool planning and the final response. The model can only select a registered tool. Business facts come from the selected MCP result, and the deterministic policy layer remains authoritative.

## Implemented contracts

- `agent:status`: capability discovery without exposing executable functions.
- `agent:turn`: bounded input, plan, policy decision, tool invocation, public answer, and non-sensitive trace.
- `agent:cancel`: cancellation by run ID.
- `agent:memory`: read the current session's bounded, in-memory turn context.
- `agent:clear-session`: clear a session when the user returns home or finishes a query.
- Public tools execute without identity.
- Personal tools require an opaque subject token, verified auth level, and `member:read:self` scope.
- Cross-subject requests, unknown tools, invalid inputs, timeouts, and cancellations fail closed.
- MCP transport implements `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` over Streamable HTTP (`2025-06-18`).
- Personal business tools call `identity_permission_mcp.check_data_permission` first and use only its returned short-lived `authorizationId`; the model cannot create one.
- Development browser requests use `/api/agent/turn`; Electron uses `agent:turn` IPC.

## Session memory and privacy boundary

- Memory is process-local only: no file, database, telemetry, or cloud persistence.
- Each session retains at most 8 turns, expires after 30 minutes of inactivity, and the store retains at most 64 sessions.
- Public questions retain bounded user/assistant text for follow-up planning.
- Personal-tool turns retain only intent, status, timestamp, and a sensitivity marker. User text, answer text, actor, subject token, tool inputs, and tool results are not retained in memory.
- `StationAdvisorApp` clears `station-advisor` memory when returning to the home screen. App exit also destroys all process memory.
- Long-term memory is deliberately not enabled. It requires explicit opt-in, a field allowlist, retention policy, and user-visible review/deletion controls.

## MCP baseline

The conditional development baseline is the latest reviewed 5-MCP / 16-Tool specification:

- `/Users/luc/Desktop/SHU/outputs/01a0612f-03ed-7093-b993-b772446c30c1/站点数字人MCP需求规范_非开发交付版.docx`
- `/Users/luc/Desktop/SHU/outputs/01a0612f-03ed-7093-b993-b772446c30c1/站点数字人MCP需求设计_序号完善版.xlsx`

All 16 tools are registered with discoverable JSON input schemas. Configure one shared endpoint with `XIAOAN_MCP_URL`, or per-server endpoints with `XIAOAN_MCP_HEALTH_RISK_URL`, `XIAOAN_MCP_HEALTH_SERVICE_URL`, `XIAOAN_MCP_IDENTITY_URL`, `XIAOAN_MCP_MEMBER_URL`, and `XIAOAN_MCP_STATION_CONTENT_URL`. Authentication is supplied with `XIAOAN_MCP_BEARER_TOKEN` until D-008 freezes mTLS/OAuth2 and deployment details.

When no endpoint is configured, the gateway reports `mode: local-unconfigured`; unconnected business tools return `DATA_NOT_CONFIGURED`. This mode must not be reported as production MCP integration.

V1.5.14 adds desktop terminal configuration for the same five endpoints. The packaged app encrypts the saved endpoint/token bundle with Electron `safeStorage`, never returns bearer tokens to the renderer, and atomically rebuilds the Harness only when no agent run is active. “Business connected” requires all five servers to complete MCP initialization and publish every tool assigned to that server; a configured URL, HTTP 200, or hybrid mode is not sufficient. Environment-provided values remain supported and are shown as locked. The web preview does not persist MCP credentials.

## Verification

Run `npm run test:harness` or `node --test tests/harness-runtime.test.mjs`. The full Node suite must also pass before the Harness phase is advanced.

Run `electron . --harness-self-test` to verify that the real Electron main process can initialize the Harness and execute public and authentication-gated turns without opening the kiosk window.

## Remaining production gates

D-001 through D-010 remain open, including final ID types, risk enums, permission matrix, deployment authentication, evidence lifecycle, and downstream actions. Real MCP endpoints, production data, Windows packaged behavior, and target-device acceptance are therefore not complete. Durable user memory also remains a separate consent-gated feature.
