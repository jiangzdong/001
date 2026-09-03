# 虚拟长者社区级全量测试集独立验收记录

## 当前结论

统筹最终独立判定为 `CONDITIONAL`：V1.5.19 的社区级纯合成数据、5 MCP / 16 Tool 合同、全量 resident sweep、持久化作业控制、统计下钻和 macOS Electron 等价环境均已通过当前源码复验；Windows 2400×3840 实体终端和当前候选提交/远端标识仍缺证据，因此不得写成全面交付或正式生产 MCP 通过。历史首轮、第二轮失败与每次退回原因继续保留在下文，不把旧失败覆盖成一次成功。

## 已执行证据

- 锁定运行时：`/Users/luc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- 当前源码完整回归：锁定 Node `node --test tests/*.test.mjs` 为 **246/246 PASS**；直接 Vite 生产构建为 **4582 modules transformed**，Sites 为 **4/4 PASS**，禁用缺失 LFS filter 的只读 `git diff --check` 退出码 0。
- 全量数据：`semantic-v13-20260903-a` 与 `semantic-v13-20260903-b` 均为 **10,000 residents、3,514,748 records、1,309,838,932 bytes、13 shards**；manifest/hash-list 逐字节一致，统一 manifestHash 为 `sha256:c4e3fe24ed1c53d1cd9ee02b00af6dd1c0ed6d8dd910e200ee04d9b75c166387`，独立 validator 为 `valid:true`。
- 全量 Tool：统筹新跑 `independent-v14-20260903-1905/tool-sweep-report.json`，**10,000×16=160,000/160,000** 调用、0 failure、192/192 状态矩阵；实测 8.304 秒、约 19,267.66 calls/s。分页、幂等、权限和合同损坏边界均有独立结果。
- 产品交互：`root-final-electron-v16-20260903/electron-ui-report.json` 为 PASS；真实 Electron 完成入口、筛选、覆盖展开、作业、统计和退出。另有 `electron-lifecycle-controls-20260903-v3` 与 `electron-lifecycle-failed-rerun-20260903-v3`，实际按钮完成暂停/恢复、取消/恢复和失败阶段重跑。

## 门禁结果

| 门禁 | 结果 | 当前证据 |
|---|---|---|
| G1 数据规模 | PASS | 两个 fresh v1.3 目录均精确生成 10,000 residents、3,514,748 records、1,309,838,932 bytes；13 个分片计数、字节数和 SHA-256 全部复验通过。 |
| G2 确定性 | PASS | 同 seed 两个独立目录的 manifest/hash-list 逐字节一致；统筹另在 `QA-EXTERNAL/virtual-senior-community/root-different-seed-104730/` 实际生成 seed `104730`，其 manifestHash `sha256:19ed6f…` 与 `104729` 的 `sha256:c4e3fe…` 不同。 |
| G3 跨域一致性 | PASS | 8 组不变量全部通过：identity 22,000、risk evidence 30,000、member balance 10,000、ledger 500,000、authorization 10,000、organization 3,514,748、Tool→export 1,250,000、service/activity 1,500；篡改测试能失败关闭。 |
| G4 16 Tool 数据 | PASS | 16/16 Tool 均通过正式成功输出字段与嵌套语义校验；跨居民导出索引经 regression 全部 1,000 人逐项比对，无 generic success fallback。 |
| G5 状态矩阵 | PASS | 16 Tool×12 状态为 192/192；充值、消费、活动的首/末/空页、重复与非法游标，以及保存研判的幂等重放/冲突均通过。 |
| G6 隔离安全 | PASS | 数据和响应均为 `synthetic-test-only`/`test-fixture`；validator 扫描敏感信息，QA 目录不进入 package，入口及故障注入均受 test-mode 门禁保护。 |
| G7 批次控制 | PASS | persisted job manifest 覆盖四档、阶段 checkpoint、重启恢复、取消与 failed-only rerun；底层测试和真实 Electron 按钮路径均通过。 |
| G8 统计可信 | PASS | 报告含 resident/entity/field/MCP/Tool/state/permission/pagination/time-window/cohort/latency/error/failure-cluster/trend，并区分固定基准和探索变体；可下钻到报告目录。 |
| G9 产品交互 | PASS | 当前源码 Electron 实际完成生成、筛选、覆盖展开、暂停/恢复、取消/恢复、受控失败重跑、统计和退出，所有报告 `result:PASS` 且控制台错误 0。 |
| G10 视觉与无障碍 | CONDITIONAL | macOS Electron 等价环境的 750×1200 与 2400×3840 均无横向溢出、<52px 控件、单侧线或 <12px 有意义文本；六类控件焦点可见且无陷阱，reduced-motion 生效。强制 2400×3840 的 macOS Chromium GPU 进程出现 tile memory warning，已保存截图肉眼完整但不能替代 Windows 实体 GPU/显示链路。 |
| G11 回归 | PASS | 当前源码 246/246 Node、Vite 4582、Sites 4/4、语法和 diff-check 全部通过，无跳过。 |
| G12 可追溯与回退 | FAIL | 数据版本、生成器、seed、hash、命令和远端回退基线齐全，但 V1.5.19 当前候选仍是未提交工作树，尚无与当前源码对应的提交/远端标识。 |

## 剩余放行条件

在 Windows 2400×3840 目标机复跑当前 Electron 视觉/触控/焦点门禁，并在用户明确授权后为当前 V1.5.19 候选建立对应提交与远端标识，才能把 G10/G12 改为 PASS。真实生产 MCP、ASR/TTS/Viseme/V34 和实体硬件不属于本次纯合成社区数据全量扫描的通过范围，仍按项目总门禁单独验收。

## 2026-09-03 P1 视觉可读性复验（本机候选）

- 范围仅为 QA 的 `.virtual-senior-*` 控制台。将此前在 750px 视口以 `1.0–1.2cqw` 落到约 7.5–9px 的有意义文本，改为有上限的 `clamp()`：一般可见文字不低于 **12px**，按钮、筛选控件与正文优先不低于 **14px**；2400px 目标视口仍受 16–34px 上限控制，未无限放大。
- 当前源码启动的独立 Electron 验收报告为 `QA-EXTERNAL/virtual-senior-community/electron-readability-20260903-v2/electron-ui-report.json`。750×1200 初始页审计 **121** 个可见有意义文本节点，`minFontSizePx:12`、`below12px:[]`；2400×3840 分析页审计 **91** 个节点，`minFontSizePx:16`、`below12px:[]`。脚本已把有意义可见文本小于 12px 设为硬失败，同时排除隐藏节点、纯图标和 SVG。
- 同一报告实际结果为 `PASS`：`undersized:0`（所有可操作按钮/控件维持至少 52px）、`oneSided:0`、`consoleErrors:0`。截图为 `virtual-senior-initial-750x1200.png` 与 `virtual-senior-analysis-2400x3840.png`，均来自该报告目录；这只证明本机 QA 控制台当前目标视口，不替代最终 Taste/Audit、Windows 设备或 G1-G12 的统筹独验。

## 2026-09-03 G9 社区作业 UI 生命周期复验（本机候选）

- 通过当前源码 Electron 的真实控制台按钮（不是直接调用 runner）执行“日常回归”作业：`生成并验证 → 阶段后暂停 → 从检查点恢复 → 完成`，再执行 `生成并验证 → 取消 → 从检查点恢复 → 完成`。报告为 `QA-EXTERNAL/virtual-senior-community/electron-lifecycle-controls-20260903-v3/electron-community-lifecycle-report.json`，`result:PASS`、8 个步骤、`consoleErrors:[]`；逐步保存按钮文案、jobId、状态、stage、completedStages、stageAttempts、checkpoint/reportDirectory 和截图。
- 暂停 job `community-regression-1788433709372` 在 generating 完成后确为 `paused`，其 completedStages 只有 generating；恢复直接进入 validating，随后完成三阶段，原 datasetManifest 相同。取消 job `community-regression-1788433715545` 保留 reportDirectory/checkpoint、记录 generating attempt 2，恢复后完成。750px 截图明确显示“从检查点恢复”动作。
- 失败重跑以只在 `--virtual-senior-test` 启动且同时设置 `VIRTUAL_SENIOR_COMMUNITY_QA_FAULTS=1`、`VIRTUAL_SENIOR_COMMUNITY_QA_FAULT_STAGE=sweeping` 时可达的单次 QA 故障开关产生；正常/打包启动无法启用。真实 UI 报告 `QA-EXTERNAL/virtual-senior-community/electron-lifecycle-failed-rerun-20260903-v3/electron-community-lifecycle-report.json` 为 `PASS`：sweeping 失败时 generating/validating 已完成，点击“仅重跑失败阶段”后只从 sweeping 恢复，datasetManifest 和 validation report 未变，最终完成且 `consoleErrors:[]`。该开关不是生产默认路径，也不使 Fixture 成为生产数据。

## 2026-09-03 G10 键盘焦点与减少动效复验（本机候选）

- 当前 Electron 报告 `QA-EXTERNAL/virtual-senior-community/electron-g10-focus-20260903-v3/electron-ui-report.json` 为 `PASS`。CDP 的实际 Tab 导航覆盖关闭、运行档位、cohort 筛选、MCP 展开、社区作业操作、底部主操作六类代表控件；报告逐项保留 activeElement label、computed outline、box-shadow 与可见焦点结论，六项均为 `solid 2px rgb(13, 136, 126)` 且 `visibleFocus:true`。
- 焦点序列完整越过六类控件，继续前进后可回到控制台（`firstOutside:44`、`returnedToConsole:true`），未陷入循环。通过 `Emulation.setEmulatedMedia` 设置 `prefers-reduced-motion: reduce` 后，控制台 computed `animationName:none`、`animationDuration:0s`、`transitionDuration:0s`，验收脚本随后恢复默认媒体模拟；焦点或 reduced-motion 任一失败均使报告 FAIL。

## 2026-09-03 P1 跨平台运行时与打包边界复验（本机候选）

- community runner 不再固定任何本机 `/Users/...` Node 路径，改为 `process.env.VIRTUAL_SENIOR_NODE || process.execPath`；子进程仍显式设置 `ELECTRON_RUN_AS_NODE=1`，因此源码 Electron 可在 macOS/Windows 使用自身 Electron runtime 执行同一脚本。专项静态回归同时断言无 `/Users/luc/`、有该回退和 `ELECTRON_RUN_AS_NODE`。
- QA 故障注入改为 `virtualSeniorEnabled && !app.isPackaged && VIRTUAL_SENIOR_COMMUNITY_QA_FAULTS=1` 三重门禁；无论环境变量如何，已打包应用不能启用该故障路径。`package.json` build 文件配置也没有 `QA-EXTERNAL` 或 `virtual-senior-community-qa`，实际数据只在 app userData 的 QA 作业目录运行时生成。
- 新源码 macOS Electron 证据 `QA-EXTERNAL/virtual-senior-community/electron-portable-node-20260903-v1/electron-ui-report.json` 为 PASS，实际 smoke 社区生成、校验、Tool sweep 成功；随后 `electron-portable-node-lifecycle-20260903-v1/electron-community-lifecycle-report.json` 也为 PASS（8 UI 生命周期步骤、0 console error）。这仅是**未打包源码 Electron**候选证据：本轮没有运行 Windows 或 packaged 测试模式，不得把该结果写成 Windows packaged 通过。
