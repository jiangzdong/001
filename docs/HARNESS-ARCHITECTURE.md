# XiaoAn Agent Harness

## Current boundary

The first implementation phase adds a local, provider-independent execution shell around XiaoAn business capabilities. Real-time ASR, TTS, visemes, avatar frames, and touch events remain on Electron IPC because they are high-frequency media streams rather than agent tools.

```text
renderer -> agent:turn -> Agent Runtime
                         -> planner
                         -> deterministic policy
                         -> Tool Registry
                         -> local MCP-compatible adapters
                         -> structured answer + trace
```

The existing `deepseek:*` IPC endpoints remain available as a compatibility path. A later phase can replace the deterministic planner with a model planner without changing policy or tool execution contracts.

## Implemented contracts

- `agent:status`: capability discovery without exposing executable functions.
- `agent:turn`: bounded input, plan, policy decision, tool invocation, public answer, and non-sensitive trace.
- `agent:cancel`: cancellation by run ID.
- `agent:memory`: read the current session's bounded, in-memory turn context.
- `agent:clear-session`: clear a session when the user returns home or finishes a query.
- Public tools execute without identity.
- Personal tools require an opaque subject token, verified auth level, and `member:read:self` scope.
- Cross-subject requests, unknown tools, invalid inputs, timeouts, and cancellations fail closed.

## Session memory and privacy boundary

- Memory is process-local only: no file, database, telemetry, or cloud persistence.
- Each session retains at most 8 turns, expires after 30 minutes of inactivity, and the store retains at most 64 sessions.
- Public questions retain bounded user/assistant text for follow-up planning.
- Personal-tool turns retain only intent, status, timestamp, and a sensitivity marker. User text, answer text, actor, subject token, tool inputs, and tool results are not retained in memory.
- `StationAdvisorApp` clears `station-advisor` memory when returning to the home screen. App exit also destroys all process memory.
- Long-term memory is deliberately not enabled. It requires explicit opt-in, a field allowlist, retention policy, and user-visible review/deletion controls.

## Current tools

- `station.get_service_schedule`
- `station.get_activity`
- `member.get_points`
- `member.get_balance`

These tools currently use deterministic local fixtures. Their names and result shapes are intentionally compatible with the MCP contract in `/Users/luc/Desktop/SHU/需求分析/业务智能体与MCP输入输出设计.md`.

## Verification

Run `npm run test:harness` or `node --test tests/harness-runtime.test.mjs`. The full Node suite must also pass before the Harness phase is advanced.

Run `electron . --harness-self-test` to verify that the real Electron main process can initialize the Harness and execute public and authentication-gated turns without opening the kiosk window.

## Next phase

Add strict versioned JSON schemas and privacy-safe audit receipts, then introduce a model planner with bounded multi-tool iteration. Durable user memory remains a separate consent-gated feature; the deterministic policy engine remains authoritative and the model never grants access.
