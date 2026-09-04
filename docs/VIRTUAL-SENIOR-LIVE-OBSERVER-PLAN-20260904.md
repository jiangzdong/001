# 单画像实时观察实施提案

状态：2026-09-04 用户已选方案 1，后台居民选择模块专项 4/4 PASS；实时 UI 未实现、未打包、未验收。

## 用户可见流程

在现有 App 测试中心进入单人观察 → 搜索并选择社区居民 → 选择场景 → 开始 → 右侧实际小安产品组件显示问题、回复及业务状态 → 查看该居民报告。批量扫描保留独立入口与统计。

## 已核实缺口

- 控制台存在 personaFilter 和未使用的 PersonaButton，但没有具体社区居民选择入口。
- cohort preview 仅提供人数和少量 ID；需要分页搜索与详情，不能只扩展固定画像列表。
- orchestrator 仍按固定 PERSONAS 创建用例并等最终报告，不会实时驱动右侧画面。
- 主 App 使用正式 agent:turn、固定生产 session；直接嵌入它会混入正式请求及语音副作用。
- Fixture 全局可变故障状态与 planner 固定 seniorId 必须处理，不能让选人只改变界面文案。

## 分阶段实施边界

1. 主进程按可信 datasetVersion/profile/seed/residentId 解析居民，提供分页与详情；拒绝渲染器自行提交 actor 身份数据。live-start 生成绑定居民、场景与数据版本的 runId。
2. 每次 live run 独立 Fixture、Harness、qa-live session、权限和取消域。保留未授权/拒绝语义；不全局替换生产 Harness，不共享可变故障状态。
3. 实时事件携带 runId/sessionId/residentId/sequence；覆盖开始、问题、规划、权限、工具、回答、媒体及终止。监听须清理、迟到事件须丢弃，右侧就绪与渲染 ack 可核实。
4. 抽取受控观察呈现层，复用真实 ConversationScreen、StationAdvisorDigitalHuman 和所需媒体 hooks；不运行生产输入、自动麦克风或管理员配置副作用。同窗是默认，物理双屏为扩展。
5. 报告保留 residentBinding、fixtureManifestHash、eventTimeline、渲染确认和脱敏工具参数。停止只取消本 run，不误取消生产会话、不清除生产记忆。

## 独立验收

- OBS-01：任意非首位居民搜索/分页/选择，空结果和错误可恢复；万人数据不一次性渲染。
- OBS-02：所选人、接口参数/返回、右侧显示及报告 ID 一致；真实事件驱动，不能用预设动画伪装联调。
- OBS-03：伪造居民 ID 拒绝，授权/拒绝/未授权语义正确；同时存在生产与 QA 会话不串数据。
- OBS-04：延迟场景中停止、换人、重复开始、关闭观察窗；无迟到气泡、资源泄漏或旧会话误入。
- OBS-05：单人报告可追溯；固定回归、社区批量及单人可视化统计独立；已有测试回归。
- OBS-06：文本、ASR、TTS、口型分别取证；未运行层明确未验证。macOS 同窗与实体双屏、Windows 分别验收。

## 放行条件

用户已选择首个展示稿 `design/virtual-senior-live-observer/option-1.png`，不混合第二、三稿。设计预览的人像和状态数字均不是生产素材或运行证据。保持现有未提交设置/语音修改；后台模块先实现，UI 编码前仍须完成选定稿审查与确定性门禁。

健康数据与体征为用户明确确认的测试范围。已有数据质量与个人健康查询链路缺口见 `VIRTUAL-SENIOR-HEALTH-DATA-AUDIT-20260904.md`；不将普通健康问答、结构扫描或后台 resolver 的通过当成个人健康业务链路已通过。
