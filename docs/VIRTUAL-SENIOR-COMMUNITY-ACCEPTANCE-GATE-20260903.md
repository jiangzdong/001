# 虚拟长者社区级全量开发独立验收门禁

本文件定义“全量开发确保可用”的完成证据。它不证明当前实现已经通过；所有结果必须来自待验收提交的当前运行。

## 1. 验收对象

- 数据规格：`docs/VIRTUAL-SENIOR-COMMUNITY-DATASET-SPEC-20260903.md`
- 视觉目标：`docs/design/virtual-senior-directions/assets/generated/quiet-task-workbench-community-v2.png`
- 产品入口：Electron `--virtual-senior-test` 受控测试模式
- 合同基线：5 MCP / 16 Tool
- 默认全量档：`community-full`，不少于 10,000 名纯合成长者

## 2. 完成判定矩阵

| 门禁 | 必须证明 | 不接受的替代证据 |
|---|---|---|
| G1 数据规模 | manifest 精确人数不少于 10,000；各实体精确计数、字节数和 SHA-256 可复验 | 设计稿上的 10,000、预算表或生成日志口头描述 |
| G2 确定性 | 同 version/generator/seed 两次独立生成的规范化 manifest 与所有分片哈希一致；不同 seed 的总体哈希不同 | 只比较人数、只重读同一目录 |
| G3 跨域一致性 | resident、org、consent、authorization、health、membership、ledger、service/activity 引用完整；金额和时间聚合守恒 | 仅通过 JSON 解析或字段存在检查 |
| G4 16 Tool 数据 | 16/16 Tool 返回符合正式输出合同的结构化成功数据；无通用 `{ok:true}` 成功回退 | `tools/list` 能看到 Tool、默认空对象或 generic success |
| G5 状态矩阵 | 每 Tool 覆盖成功、空、缺失、陈旧、非法输入、未知 ID、跨机构、未授权、拒绝、超时、服务错误、合同损坏；列表和写入补齐分页/幂等 | 只跑 happy path 或只模拟 HTTP 500 |
| G6 隔离安全 | 全部数据标记 `synthetic-test-only`；无真实 PII、密钥、原始人脸/语音；不打入正式产品包、不写生产 MCP | 仅依赖文件名含 fixture/test |
| G7 批次控制 | smoke、regression、community-full、stress 档位可选；运行可暂停、恢复、取消、失败重跑，进程重启后从 manifest 恢复 | 只有前端按钮、只有内存状态或重启后重跑全批次 |
| G8 统计可信 | 人数、字段、MCP/Tool/状态、权限、分页、时间窗、场景、人群、延迟、错误码、失败簇和趋势均可下钻到 run；固定与探索分开 | 总通过率一个数字、当前 UI 内存统计或混合不同数据版本 |
| G9 产品交互 | 真实 Electron 中完成数据生成/选择、筛选、覆盖展开、全量运行、暂停/恢复、失败定位、统计下钻和退出清理 | HTTP 健康、组件源码、静态截图或自动测试单独通过 |
| G10 视觉与无障碍 | 750×1200 与 Windows 2400×3840 目标比例无横向滚动、遮挡和低对比；键盘焦点、52px 触控、状态非只靠颜色；无单侧线条描边 | Vite build、设计稿本身或 macOS 非目标视口截图 |
| G11 回归 | 社区专项、完整 Node、语法、Vite build、Sites test、`git diff --check` 全部通过，无跳过 | 旧日志、仅专项通过或失败后未复跑 |
| G12 可追溯与回退 | 生成器版本、数据版本、应用版本、seed、输入/输出哈希、测试命令、提交和远端回退点完整 | 未提交工作树、旧版本标签或无法对应当前代码的数据 |

## 3. 独立复验步骤

### 3.1 工作树与版本

1. 记录分支、HEAD、远端、工作树和 LFS 状态，不清理用户改动。
2. 核对应用语义版本在 `package.json`、产品名、document/window title 和产物命名中一致。
3. 核对当前回退提交和标签可在远端解析，但不使用 reset/checkout 做验证。

### 3.2 数据生成

1. 使用同一 `community-full` 参数分别生成到两个全新的 QA 目录。
2. 验证两个目录均不是软链接或前一批次复用目录。
3. 运行项目自带数据校验器，保存规范化 manifest、精确实体计数、总记录数、总字节数和分片哈希。
4. 对两份 manifest 和哈希清单做确定性比较。
5. 用不同 seed 生成最小验证档，证明哈希不同且强制覆盖格仍满足。
6. 使用内容扫描与 schema 白名单检查真实 PII/密钥模式；命中项必须人工判定或失败关闭。

### 3.3 MCP 与 Harness

1. 对五个 Fixture MCP 分别完成 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`。
2. 枚举 16 Tool，逐个校验输入 Schema、成功输出 Schema、状态矩阵、权限和错误码。
3. 对充值、消费和活动验证首页、末页、空页、非法游标和重复游标。
4. 对保存研判验证同 idempotencyKey 重放不产生重复记录，不同 payload 冲突失败关闭。
5. 对个人 Tool 验证匿名、本人授权、过期授权、scope 不足、跨主体和跨机构。
6. 用正式 `createXiaoanHarness(...).run()` 进入 scenario、policy 和 Tool，不允许测试绕过 Harness 直接调用 executor 后宣称产品通过。

### 3.4 批次与统计

1. 运行 smoke 完整批次，记录运行数、通过数、失败数、跳过数和耗时分位数。
2. 启动 regression 批次，中途暂停并退出进程；重启后从同一 batch manifest 继续，确认已完成 run 不重复。
3. 注入一个可复现失败，验证失败重跑只选择目标 run，并保持原始报告不可变。
4. 运行 community-full 的数据完整性和 Tool 可调用性扫描；Harness/LLM/媒体层按规格分层，报告不得把抽样媒体结果当作 10,000 人全量通过。
5. 对上一持久化批次比较趋势；数据版本不同时必须明确不可直接横比或在同版本复跑。

### 3.5 UI 与目标视口

1. 在真实 Electron 测试模式检查未生成、生成中、校验中、部分覆盖、就绪、运行中、暂停、可恢复、失败和空筛选。
2. 操作四个运行档位、人群筛选、MCP 展开、Tool 状态下钻、批次启动/暂停/继续/取消、失败建议和统计页。
3. 保存 750×1200 当前等价截图和 Windows 2400×3840 目标机截图；有目标设计时进行同尺寸对比。
4. 检查控制台错误、文字溢出、页面横向滚动、底栏遮挡、焦点顺序、Esc/关闭、52px 触控和 reduced motion。
5. 检查所有状态有文字或图标语义，无单侧线条描边、全高侧轨、渐变、紫色玻璃拟态和卡片套卡片。

## 4. 结果分级

- `PASS`：G1-G12 全部有当前运行证据，且没有阻断/高优先级缺陷。
- `CONDITIONAL`：macOS 本机数据、合同和 UI 已通过，但 Windows 2400×3840、真实生产 MCP 或媒体目标机仍缺证据；必须逐项列出，不得写成全面可用。
- `FAIL`：人数、确定性、跨域一致性、16 Tool、隔离、批次恢复、核心 UI 或完整回归任一失败。
- `BLOCKED`：外部环境缺失导致某一门禁无法执行；仅该门禁受阻，其余可验证项继续推进。

## 5. 最终验收报告最少字段

- 应用版本、提交、数据版本、生成器版本、seed。
- 精确居民数、各实体数、总记录数、总字节数、manifest 与分片哈希。
- 16 Tool × 状态矩阵结果和未覆盖单元格。
- 批次控制、统计、UI、目标视口、构建和完整回归证据路径。
- 已知限制、未验收范围、回退点和最终 `PASS/CONDITIONAL/FAIL/BLOCKED`。
