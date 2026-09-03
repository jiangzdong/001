# 虚拟长者测试界面参考与整改审查（2026-09-03）

## 审查范围

- 产品面：小安 9:16 Electron 站点咨询终端中的 QA 专用虚拟长者测试界面。
- 用户目标：测试人员可以在不接触生产数据的前提下，选择合成长者画像和固定场景，运行单项或批次，并快速定位失败与优化方向。
- 视觉边界：延续现有冷白、医疗蓝、低刺激和大触控区；不重做老人主界面；禁止单侧彩色线条描边。

## 参考矩阵

| 平台 | 作品 | 访问状态 | 采用规律 | 排除内容 |
|---|---|---|---|---|
| Pinterest | [Healthcare kiosk administrative processes](https://in.pinterest.com/pin/kiosk-in-health-sector-automates-certain-administrative-processes-such-as-generating-forms-wristbands-and-labels-tuc--551972498058534704/) | 仅搜索预览，详情 403 | 触屏自助场景需要明显入口和少步骤 | 不采用设备宣传图的视觉包装 |
| Pinterest | [Interactive kiosks in healthcare](https://in.pinterest.com/pin/interactive-kiosks-are-making-great-strides-in-allowing-the-healthcare-industry-to-contain-costs-while-impr--378583912408124692/) | 仅搜索预览，详情 403 | 自助流程必须清晰表达服务边界 | 不把硬件外观当 UI 参考 |
| Pinterest | [Patient self-service kiosks](https://in.pinterest.com/pin/patient-selfservice-kiosks-are-being-used-with-growing-frequency-in-hospital-ambulatory-settings-and-emerge--551972498059779652/) | 仅搜索预览，详情 403 | 医疗终端适合高对比、直接任务入口 | 不采用广告式文案和复杂装饰 |
| Pinterest | [Healthcare kiosk technology](https://uk.pinterest.com/pin/7-ways-kiosk-technology-supports-and-improves-the-healthcare-industry--215258057222295368/) | 仅搜索预览，详情 403 | 强调效率和可恢复操作 | 不照搬信息图布局 |
| Behance | [ConsultQ Hospital Follow-Up Appointment Kiosk](https://www.behance.net/gallery/254875397/ConsultQ-Hospital-Follow-Up-Appointment-Kiosk) | 详情已读 | 引导式流程、双语与不同数字熟练度适配 | 不复制其页面构图或品牌元素 |
| Behance | [UX/UI Wireframes - Health Kiosk](https://www.behance.net/gallery/66730313/UXUI-Wireframes-Health-Kiosk) | 详情已读 | 老年触屏任务优先、复杂后端隐藏在简单操作之后 | 不采用低保真线框视觉 |
| Behance | [CareUI Healthcare Design System](https://www.behance.net/gallery/252025581/CareUI-Healthcare-Design-System-UI-Kit) | 详情已读 | 医疗界面保持清晰、平静、可信；状态和组件可扩展 | 不采用模板化卡片堆砌 |
| Behance | [Healthtech B2B Care Management Dashboard](https://www.behance.net/gallery/241477285/Healthtech-B2B-SaaS-Care-Management-Dashboard-UXUI) | 详情已读 | 高密度工作台应围绕任务、快捷动作和审计证据组织 | 不引入与当前终端无关的多级导航 |
| Dribbble | [Healthcare Analytics Dashboard UI](https://dribbble.com/shots/27692801-Healthcare-Analytics-Dashboard-UI) | 详情已读 | KPI、筛选、结果表应服务快速判断 | 不照搬企业 SaaS 侧栏 |
| Dribbble | [MESAI Medical Analytics Dashboard](https://dribbble.com/shots/26917205-MESAI-Medical-Analytics-Dashboard-Patient-Data-Test-Insights) | 详情已读 | 测试状态使用明确文字和指示符，复杂数据转为可行动结果 | 不采用高饱和 AI 装饰 |
| Dribbble | [Elderly Take Care App](https://dribbble.com/shots/26344051-Elderly-Take-Care-App) | 详情已读 | 柔和表面色、高对比文本、直观入口 | 不采用移动端底部导航 |
| Dribbble | [Medical Dashboard UI](https://dribbble.com/shots/26942288-Medical-Dashboard-UI-Healthcare-Admin-Analytics-Design) | 详情已读 | 稳定网格、清晰层级、低刺激医疗色 | 不使用单侧色条和过度卡片化 |

Pinterest 四个详情页在本次访问中返回 403，因此仅作为预览级设备场景参考；可迁移的界面规律由已打开的 Behance、Dribbble 详情和当前产品设计系统共同确认。

## Taste 降级审查

当前环境没有全局说明优先建议的 `impeccable` 与 `ui-ux-pro-max`，因此按内置 Taste 量表降级执行。

- 保留：现有冷白与医疗蓝、真实数字人、管理员内受控入口、3 个合成画像、场景与分析双工作区、大触控目标。
- 增强：批次结果的通过率、P95、覆盖率、分类统计、失败聚类、跨批次趋势和建议；运行中提供明确停止入口。
- 删除：指标卡、失败诊断和场景动作区的单侧线条描边；删除依赖颜色单独表达状态的做法。
- 重做：状态层级改用整体表面色、图标、文字、留白和完整容器边界；修正可选摘要条造成的网格行错位。

## 当前审查步骤与结果

1. 首页：主咨询界面保持不变，管理员入口仍为低干扰次级动作。健康：通过。
2. 管理员入口：仅在 `--virtual-senior-test` 启动标志下显示“虚拟长者测试”。健康：通过。
3. 统计分析：10/10、P95、覆盖率、分类结果、失败诊断、建议和报告目录可见；已移除单侧彩色线条。健康：通过。
4. 场景列表：合成身份标识、筛选、选择、单项运行、批次运行和结果文字可见；已移除动作区左侧分隔线。健康：通过。
5. 运行中断：运行期间主动作切换为“停止批次”，按钮可操作。健康：通过。

## 证据与限制

- 当前运行使用 macOS Electron 开发态，窗口截图为 750×1200。
- 截图目录：`QA-EXTERNAL/virtual-senior/1.5.18/ui-audit-20260903/`。
- 截图能确认视觉和可见语义，不能单独证明完整 WCAG 合规；Windows 2400×3840、实体触屏、键盘完整遍历和屏幕阅读器仍未验收。
- 本轮是对既有实现的纠偏审查，不把事后补齐的参考与审查表述为原实现阶段已经合规。
