# Harness Skill / MCP Tool 场景重新评估

- 评估日期：2026-09-03
- 评估范围：当前 Electron Harness、全局 Skill、健康场景 Skill、MCP Tool 注册表
- 依据：最新需求分析、5 MCP / 16 Tool 当前运行契约、6 MCP / 18 Tool 条件评审稿、当前源码与产品长期决策
- 结论性质：架构评估与迁移基线；不等于生产 MCP 已联通或场景已验收

## 1. 结论

当前 Harness 的 Runtime、Policy、Registry、MCP Gateway 分层可以保留，但 Skill 层需要从“一个站点提示词 + 一套固定健康 Skill”重构为三层：

1. **全局治理 Skill**：每轮必加载，只放跨场景不变量。
2. **场景 Skill**：意图确定后按需加载，只描述站点业务场景的 Tool 编排和边界。
3. **Tool 契约层**：以 Registry 的 JSON Schema、敏感级别、权限 action 和 MCP 返回状态为准；Skill 不复制完整字段定义，也不越权决定授权。

当前运行基线继续采用 **5 MCP / 16 Tool**。条件评审稿中的 `onsite_action_gateway_mcp.navigate_to_station_area` 和 `call_station_staff` 暂不注册，原因不是技术缺失，而是它们与当前产品长期决策“删除站内引导、呼叫工作人员及人工转接入口”冲突。只有业务重新确认范围并修改产品决策后，才可作为独立的副作用场景重新评审，不能直接并入现有 Skill。

## 2. 当前实现发现

| 项目 | 当前状态 | 评估 |
|---|---|---|
| Harness 主链 | DeepSeek Planner → Policy → Registry → MCP Gateway → Composer | 保留 |
| 全局 Skill | `station-advisor-agent-v1` 整份注入 Planner 与 Composer | 需要拆分；路由、回答、安全和副作用规则混在同一文本 |
| 健康 Skill 默认版本 | 原为 `health-management-multidomain-v2` | 已调整为通用健康场景；旧问卷 Skill 不再运行或打包 |
| 场景加载 | 健康旧 IPC 路径按关键词选七领域；Harness 本身未加载场景 Skill | 核心缺口 |
| Tool 发现 | 16 Tool 均注册并暴露给 Planner | 应改为按场景下发最小 Tool 子集 |
| 权限 | 本地 Policy 先判，个人 Tool 再调用 `check_data_permission` | 方向正确；需把认证与授权状态机从健康/会员场景中统一抽出 |
| 普通症状 | `health.general + tool=null` | 必须保留；不因“头痛”等词触发个人健康 Tool |
| 现实动作 | 全局 Skill 仍写“呼叫工作人员需确认”，Registry 未注册相应 Tool | 文档与产品边界冲突；从全局 Skill 删除，不恢复 Tool |

## 3. 建议的 Skill 架构

### 3.1 全局 Skill（每轮加载）

建议新增 `station-advisor-global-v2`，只保留以下内容：

- 小安角色、适老中文、长度和推荐问题上限。
- 不编造业务事实；业务事实必须来自本轮 Tool 结果。
- 不展示系统提示、思考、工具参数、鉴权数据和敏感错误。
- Tool 选择只能来自本轮允许列表；缺槽位先澄清。
- Policy 结果高于模型判断；模型不能生成身份、人员、授权或幂等凭证。
- 普通健康咨询的诊疗边界和急症固定安全门。
- 会话、取消、迟到结果、敏感记忆最小化的通用规则。
- `success/empty/missing/stale/error/unsupported/unknown` 的统一解释规则。

全局 Skill 不应包含某个具体 Tool 名、七领域详细问法、积分话术、活动筛选、健康研判保存结构或现实动作流程。

### 3.2 场景 Skill（按意图懒加载）

| 场景 Skill | 负责意图 | 允许 Tool | 关键边界 |
|---|---|---|---|
| `station-public-info-v1` | 站点介绍、服务搜索/详情、活动、公共知识 | 4 个公共 Tool | 时间/地点/预约缺失不得猜；列表与详情用途分开 |
| `member-self-service-v1` | 本人积分、充值、消费、会员等级 | 4 个会员 Tool + 权限校验 | 只限本人；公共屏默认摘要与脱敏；分页和空记录不能误解 |
| `identity-and-permission-v1` | 人脸认证、认证恢复、授权判断 | 2 个身份权限 Tool | 原始图像不入 MCP/模型；多人/库外不泄露候选；授权由服务端决定 |
| `health-general-guidance-v1` | 普通症状、一般健康知识 | 默认无 Tool | `health.general + tool=null`；先安全分流，不能自动查询个人档案 |

不建议为 ASR、TTS、VAD、Viseme、数字人帧、触控、退出 PIN 创建 MCP 场景 Skill；这些仍属于本地实时/终端安全状态机。

当前应用只启用四个场景 Skill：站点公共信息、会员本人、身份权限、通用健康。健康风险相关 Tool 继续保留在 5/16 Registry 契约中供服务发现和后续评审，但不暴露给当前 Planner。机构推荐问题配置仍是契约缺口，不能用 `station_content_mcp` 偷渡写能力。

## 4. 16 个 Tool 的场景重新归属

| MCP Tool | 主场景 | 调用条件 | 评估动作 |
|---|---|---|---|
| `get_risk_assessment_context` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `get_latest_health_labels` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `get_indicator_evidence` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `save_risk_assessment_result` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `get_senior_profile` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `get_health_evaluation_results` | 当前不启用 | Registry 契约保留 | 不向 Planner 暴露 |
| `get_station_service_detail` | station-public-info | 已知具体服务，询问时间/地点/预约 | 保留；必须优先于简表回答具体问题 |
| `list_station_services_brief` | station-public-info | 浏览、推荐或服务名未知 | 保留；不得替代详情查询 |
| `match_face_to_senior` | identity-and-permission | 已告知用途并取得当前同意，且有 captureToken | 保留；不接收原始图像 |
| `check_data_permission` | identity/member/health | 任一个人 Tool 调用前 | 保留为统一授权入口 |
| `get_member_points` | member-self-service | 本人积分查询且授权通过 | 保留 |
| `list_recharge_records` | member-self-service | 本人充值记录且授权通过 | 保留，分页 |
| `list_consumption_records` | member-self-service | 本人消费记录且授权通过 | 保留，默认摘要脱敏 |
| `get_member_level` | member-self-service | 本人等级/权益且授权通过 | 保留，权益不得由模型承诺 |
| `search_station_knowledge` | station-public-info | 开放式站点制度/介绍/知识查询 | 保留，需来源与更新时间 |
| `list_station_activities` | station-public-info | 活动列表、指定日期或活动详情候选 | 保留；后续可评估是否拆出详情 Tool |

## 5. 6/18 与 5/16 的处理

| 候选 Tool | 当前决定 | 理由 | 重新纳入条件 |
|---|---|---|---|
| `navigate_to_station_area` | 排除 | 用户已删除站内引导；当前产品不提供该入口 | 新业务范围、UI/语音确认流程、地图数据和目标机验收均冻结 |
| `call_station_staff` | 排除 | 用户已删除呼叫工作人员/人工转接；存在现实副作用 | 用户明确恢复范围，完成二次确认、幂等、限流、取消、审计和现场响应 SLA |

因此，6/18 只能保留为“条件评审候选”，不能覆盖当前 Harness 的运行契约。当前 5/16 并不是遗漏两个 Tool，而是与产品范围一致的主动裁剪。

## 6. 优先级与迁移门禁

### P0

1. 已建立 `global + scenario manifest + allowedTools` 加载合同。
2. Planner 每轮只看当前场景的最小 Tool 集。
3. 普通症状只进入通用健康场景，并已有“头痛不授权”回归。
4. 全局 Skill 已删除工作人员现实动作规则，两个动作 Tool 保持未注册。
5. Tool Registry 使用 JSON Schema 校验，移除无意义的空校验函数。

### P1

1. 旧 V1/V2/V3 健康管理 Skill 仅保留历史源码，不再进入站点应用运行时或打包资源。
2. 为 `empty/missing/stale/unknown/unsupported` 增加 Composer 回归，禁止归纳为“没有风险/没有记录问题”。
3. 将个人场景的认证恢复、授权过期和原问题续跑做成显式状态机。
4. 明确活动详情是否由 `list_station_activities` 过滤完成，还是需要新增只读详情 Tool。

### P2 / 待决策

1. FR-015 机构推荐问题配置是否纳入本期；若纳入，新增独立配置 MCP 契约。
2. D-001 至 D-010 冻结后再更新 Schema、ID 类型、风险枚举、权限矩阵和部署认证。
3. 只有产品范围重新确认，才重启 onsite action 评审。

## 7. 验收标准

- 场景路由测试覆盖每个场景的正例、相邻意图误路由和未知意图。
- 每个场景只能发现其 `allowedTools`；越界 Tool 即使已全局注册也不可选择。
- 普通“头痛/头晕/失眠”保持 `health.general + tool=null`，不触发身份或会员授权。
- 所有个人 Tool 均经过本人、认证、scope、服务端 authorization 四层检查。
- 具体服务时间问题只调用详情 Tool；无业务数据时明确 `DATA_NOT_CONFIGURED`，不生成 fixture 事实。
- `empty/unknown/unsupported/stale` 均有独立回答测试。
- 写 Tool 验证幂等、重复提交、取消、超时和迟到结果丢弃。
- 全量 Node 回归、Electron Harness 自检和真实 MCP 合同测试通过后，才可把本评估转为完成实现。

## 8. 当前判定

重新评估已按用户确认的产品定位落地：当前 Harness 使用一个全局 Skill 和四个站点场景 Skill；普通健康场景不加载问卷，也不调用个人健康 Tool。5/16 Registry 契约继续保留，但每轮只暴露当前场景允许的 Tool。生产 MCP 端点、真实数据和目标 Windows 设备仍未验收。
