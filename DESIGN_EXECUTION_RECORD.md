# DESIGN_EXECUTION_RECORD

> 本记录是设计流程证据，不替代项目进度唯一事实源 `PROJECT_STATUS.md`。

## 1. 范围判定

- 项目/功能：小安站点咨询顾问 V1.5.19，虚拟长者社区级批量测试控制台视觉与交互重构。
- 当前阶段：阶段 G 已完成本机实现、独立验收和候选推送；当前为条件通过，仅等待 Windows 2400×3840 实机门禁。
- 新项目或新设计范围：是。
- 判断依据：将改变测试控制台的信息层级、场景组织、批次分析和视觉语言，超出同组件状态补齐。
- 窄范围例外：不适用。

## 2. 项目上下文

- 产品目标：帮助测试和运营人员以社区级纯合成居民库覆盖 5 MCP / 16 Tool 的全部业务数据、权限和异常场景，批量识别失败、定位根因并比较后续优化效果。
- 核心用户与陪同用户：核心为 QA 与站点运营；陪同为研发、产品和验收人员。
- 平台、设备、视口、观看距离：Electron 桌面应用；现有证据视口 750×1200，目标 Windows 终端 2400×3840 竖屏；近距离触控并兼容鼠标和键盘。
- 输入方式与使用环境：触控优先，兼容鼠标/键盘；站点与实验室环境；可能存在噪声、弱网和长批次运行。
- 首版范围 / 不包含项：包含 10,000 人 `community-full` 数据集、固定基准与受控探索入口、5 MCP / 16 Tool 覆盖、条件筛选、单项/批量执行、停止/恢复、状态反馈、统计分析、失败聚类、趋势和报告入口；不包含首页重构、数字人肖像、V34 口型几何、生产数据和未经配置的真实 DeepSeek。
- 成功指标 / 失败定义：成功要求首屏确认数据集版本、精确人数、16 Tool 覆盖与批次健康度，两步内定位主要失败簇，支持取消和断点恢复、固定与探索分开统计，目标竖屏无溢出且触控目标不小于 52 CSS px；失败包括全量少于 10,000 人、任一 Tool 缺少真实结构化数据或通用成功回退、跨 MCP 矛盾、结果混算、失败无恢复、不可追溯、单侧线条描边或目标视口不可操作。
- 无障碍、性能、隐私与安全约束：WCAG AA；焦点可见；减少动态效果；合成身份与正式会话隔离；不显示密钥；不把测试结果写入生产数据。

## 3. 事实源与 Skill

- 事实源优先级：用户明确要求与全局设计规范 > 当前项目 `PROJECT_STATUS.md` > 750×1200 Electron 截图 > `VirtualSeniorTestConsole.jsx` 与 `station-advisor.css` > 测试子系统验收文档与 `design-qa.md` > 外部参考规律。
- 已完整读取全局设计规范：是
- 当前最小 skill 集：`product-design:index`、`product-design:user-context`、`product-design:get-context`、`product-design:ideate`、`product-design:image-to-code`、`browser:control-in-app-browser`、`imagegen`、`image-edit-integrity`、`design-taste-frontend`。
- 实际调用证据：Product Design user-context 预检返回无已保存上下文；已读取现有 UI 截图和代码；通过 Codex 内置浏览器读取参考页面；ImageGen 已生成三个方向和社区级修订候选；`image-edit-integrity` 已建立不可变母版、候选谱系并通过校验；`design-taste-frontend` 已完整读取并应用改版保护、单主题/单强调色、形状一致、可访问性、文案自审、低动效和最终预检规则。
- 不可用能力与降级路径：当前技能列表无 `impeccable` 与 `ui-ux-pro-max`。本界面是仪表盘/后台产品界面，`design-taste-frontend` 自身声明不承担该类产品的信息架构与数据表设计，因此不把它冒充主设计系统；主规则使用现有产品设计系统、全局规范内置 Taste 量表和已核实的 Carbon/GOV.UK/USWDS 规律，Taste 仅提供适用的反模板与交付预检。

## 4. 参考研究

| 平台/来源 | 作品与链接 | 详情访问状态 | 采用规律 | 排除项/版权风险 |
|---|---|---|---|---|
| Pinterest | Healthcare dashboard UI 搜索预览 1，[搜索页](https://www.pinterest.com/search/pins/?q=healthcare%20dashboard%20ui)，[可见图](https://i.pinimg.com/originals/01/6b/7f/016b7f7c2926cdf737c9c2db1a8425a1.jpg) | 仅预览；登录墙；作者与发布日期不可见 | 浅色基底、少量蓝绿强调、医疗信息分区 | 不复制卡片布局、图像或品牌元素 |
| Pinterest | Healthcare dashboard UI 搜索预览 2，[搜索页](https://www.pinterest.com/search/pins/?q=healthcare%20dashboard%20ui)，[可见图](https://i.pinimg.com/originals/57/49/44/574944fbae3dbbe15e801c1e768406b6.jpg) | 仅预览；登录墙；作者与发布日期不可见 | 左侧任务与右侧趋势的主次分工 | 不采用密集小字和装饰性图表 |
| Pinterest | Healthcare dashboard UI 搜索预览 3，[搜索页](https://www.pinterest.com/search/pins/?q=healthcare%20dashboard%20ui)，[可见图](https://i.pinimg.com/originals/37/8c/34/378c341e44532dd6399d7c8ddc8bde57.jpg) | 仅预览；登录墙；作者与发布日期不可见 | 数据、人体/对象和行动区形成清楚焦点 | 不复制人物、插画、构图或组件皮肤 |
| Behance | Kraftbase、Gulshan Ali、Fractal Labs，Nura Healthcare Platform，[详情](https://www.behance.net/gallery/254066519/Nura-Healthcare-Platform-UX-UI-Dashboard-Design)，2026-08-10 | 已打开详情并检查首屏 | 柔和低饱和表面、健康总览与洞察并列 | 排除超大营销字、装饰性仪表盘和品牌复刻 |
| Behance | Michael Gradienta，Digital Health & Heart Monitoring Platform，[详情](https://www.behance.net/gallery/244352719/Digital-Health-Heart-Monitoring-Platform)，2026-02-18 | 已打开详情并检查首屏 | 关键健康指标前置，复杂数据保持明确阅读顺序 | 排除模特主视觉和不适合测试台的消费化表达 |
| Behance | LindA TAmer，KUH E-Clinic，[详情](https://www.behance.net/gallery/254526989/KUH-E-Clinic-Digital-Healthcare-Management-System)，2026-08-20 | 已打开详情并检查首屏 | 多角色/多状态系统需要一致的任务状态语法 | 排除深色宣传封面、手机外壳和百屏堆叠展示 |
| Dribbble | Shakuro，Healthcare Dashboard for Clinic Management，[详情](https://dribbble.com/shots/25554152-Healthcare-Dashboard-for-Clinic-Management-Patient-Management) | 已打开详情并读取项目说明 | 单一工作区承载多阶段流程，主任务与上下文并存 | 排除暗黑高压感、3D 人体和过量导航 |
| Dribbble | Paperpillar，Modern Healthcare Dashboard，[详情](https://dribbble.com/shots/26848599-Modern-Healthcare-Dashboard-Simple-Elegant-Effortless-Appoint) | 已打开详情并读取项目说明 | 柔和分层、低摩擦流程和清晰主操作 | 排除大面积玻璃拟态、浅灰低对比和患者端语义 |
| Dribbble | Nixtio，Healthcare Dashboard UI Design，[详情](https://dribbble.com/shots/27570193-Healthcare-Dashboard-UI-Design) | 已打开详情并读取项目说明 | 复杂监测数据优先保证可读性和快速决策 | 排除设备模型展示、红色品牌复刻和装饰性实时图 |
| IBM Carbon | Data table usage，[规范](https://carbondesignsystem.com/components/data-table/usage/) | 已打开正式规范 | 用表格、选择、展开和批量操作承载重复场景；工具栏集中搜索/筛选/动作 | 不整套引入 Carbon，不复制品牌视觉 |
| GOV.UK | Task list，[规范](https://design-system.service.gov.uk/components/task-list/) | 已打开正式规范 | 任务名、短提示和明确状态；整行可操作；长任务按意图分组 | 不采用政府品牌视觉；不把结果当任务答案列表 |
| USWDS | Alert，[规范](https://designsystem.digital.gov/components/alert/) | 已打开正式规范 | 短标题、明确下一步、状态不只依赖颜色、按紧急度使用 ARIA | 不使用左侧彩色边线；改用完整表面、图标和文字状态 |

- 有效参考总数：12
- Pinterest 详情数：0
- Behance 详情数：3
- Dribbble 详情数：3
- 受阻及补足说明：Pinterest 无登录详情不可访问，已有 3 个可见预览；以 IBM Carbon、GOV.UK 和 USWDS 三个正式产品设计规范补足可验证的交互与无障碍证据。
- 推荐采用规律：关键健康度前置；场景采用任务行而非独立卡片；整行选择与明确批量动作；失败信息包含原因与下一步；分析支持批次对比；状态由图标、文字和表面共同表达；长列表按意图分组；触控区和焦点状态明确。
- 明确排除：单侧线条描边、卡片套卡片、装饰性统计图、低对比玻璃拟态、纯营销构图、假精确数据、仅颜色状态、复制外部品牌或素材。
- 原创差异化声明：三个方向只重组任务分组、批次证据、失败诊断和趋势比较规律，不复制任何单一参考的布局、资产、品牌、文案或图形语言。

## 5. 三个原创方向与选择

| 方向 | 可见稿/证据 | 核心任务与交互 | 视觉语言 | 风险与成本 |
|---|---|---|---|---|
| A | 安静任务台：`docs/design/virtual-senior-directions/quiet-task-workbench.png`，SHA-256 `600e122a...bb7c5ea` | 以批次任务队列为主，画像为紧凑筛选，场景整行选择，底部固定批量动作 | 冷白、医疗蓝绿、轻表面分区、低动效 | 最稳健；趋势分析的视觉记忆点较弱 |
| B | 失败雷达：`docs/design/virtual-senior-directions/failure-radar.png`，SHA-256 `bb94ef77...83beb96` | 失败和风险优先，首屏展示批次健康度、失败簇与受影响场景，可一键回到失败任务 | 中性浅灰、克制琥珀/红、强信息层级 | 诊断效率高；初稿“失败诊断”标题含侧竖线，违反反例，若选中必须先删除并重绘后才能过门禁 |
| C | 证据时间线：`docs/design/virtual-senior-directions/evidence-timeline.png`，SHA-256 `60221a8e...b0a6d0d` | 用批次时间线与对比视图串联运行、异常、恢复和趋势，场景作为可展开证据行 | 青蓝中性底、连续证据带、微型趋势图 | 优化价值高；实现和数据密度最高 |

- 用户选择：方向 1“安静任务台”；其后要求继续优化设计，并把原 3 画像扩展为覆盖 5 MCP / 16 Tool 的社区级全量测试集。
- 选择时间与原文：2026-09-03，用户原文“按照1”；新增范围原文“画像数据要涵盖目前站点数字人各个场景，即MCP中的tools所需要的各个接口数据，需要从横向到纵向丰富数据量，至少达到一个社区的用户体量数据，作为全量测试集。”
- 修订稿继续授权：2026-09-03，用户目标原文“全量开发确保可用”，视为按已展示社区级方向 1 继续实现的授权，不改变禁止生产数据、禁止误报完成和交付前真实验收要求。
- 如由代理代选，显式授权原文：无。
- 选择理由 / 放弃其余方向的原因：用户明确选择方向 1；保留其稳定、安静、适合长批次操作的主工作台。方向 2 的失败优先和方向 3 的证据趋势作为分析区能力吸收，不采用其主视觉与高密度结构。

## 6. 选定方向 Design Read

- Design Read：面向 QA、研发和站点运营的竖屏社区级测试工作台，以冷白医疗蓝、安静但高信息效率的语言组织 10,000 名合成居民和 16 Tool 全覆盖；主界面强调数据集、覆盖、批次和失败影响，不把个人画像卡当作主体。
- `DESIGN_VARIANCE`：3。
- `MOTION_INTENSITY`：2。
- `VISUAL_DENSITY`：7。
- 设计系统：延续项目现有 React 19、原生 CSS 变量和 Phosphor Icons，不新增 Carbon/Fluent 等第二套组件库；外部规范只用于数据密度、状态与无障碍规律。
- 颜色 Token：页面 `#F4F8FB`，主表面 `#FFFFFF`，主文字 `#0B2341`，次文字 `#526A82`，唯一品牌强调 `#087EA4`，成功 `#167A55`，失败 `#C43D3D`，边界 `#D7E3EC`，焦点环 `#0A6E91`。全页锁定浅色主题，不使用渐变、紫色或玻璃拟态。
- 形状与层级 Token：主要表面 12px 圆角，状态标签允许全圆角；控件最小 52 CSS px，行高不小于 64px；阴影只用于浮层且使用蓝灰染色，列表以留白和单向水平分隔组织。
- 字体与数字：系统中文无衬线字体栈，正文不小于 16px，主要数字使用等宽数字特性；不引入远程字体，不把假精确数值当装饰。
- 保留：现有冷白医疗气质、蓝绿色品牌强调、场景/统计双工作区、合成身份说明、停止与返回路径。
- 增强：数据集版本、人数/记录量、16 Tool 覆盖、筛选命中数、批次健康度、运行进度、失败影响人数、批次对比、报告可追溯性、触控与焦点反馈。
- 删除：把 3 张画像卡当作主体、“全部画像 10 个画像”等假精确文案、单侧线条描边、卡片套卡片、重复 PASS 装饰、无意义标签、横向画像滚动依赖。
- 重做：测试人群筛选、5 MCP / 16 Tool 覆盖树、全量/回归/冒烟运行档位、失败诊断与影响人群关系、批次趋势和底部主操作区。
- Token、组件与状态：新增 DatasetSummary、CohortFilter、McpCoverageTree、RunProfile、CoverageGap、ResumeBatch、DatasetVersionBadge。状态覆盖未生成、生成中、校验中、就绪、运行中、已暂停、已取消、可恢复、部分通过、失败、数据版本不兼容、空筛选、权限不足和报告恢复失败。
- 明确反例：禁止单侧线条描边。
- 空/加载/错误/权限/取消/恢复：无数据集时显示生成入口和规格说明；生成/校验显示确定性阶段、已完成分片与可取消动作；错误显示错误码、受影响 Tool 和重试/回退数据版本；权限状态区分匿名、需认证、拒绝和授权过期；取消保留已完成分片，恢复必须从 batch manifest 继续；历史报告损坏时隔离损坏文件并允许重新生成摘要。
- 交互规格：运行档位切换更新人数、预计案例和成本；测试人群筛选实时显示命中人数；5 MCP 行可展开到 16 Tool 和状态矩阵；全量运行需要确认数据版本与预计案例，可暂停、继续、取消、失败重跑；统计分析可按 MCP、Tool、场景、人群、状态和批次下钻，固定与探索默认分栏。
- 响应式、触控与减少动态效果：保持 5:8 竖屏主画布，目标 2400×3840；750×1200 调试视口按同一比例缩放；窄于 768px 时运行档位 2×2、筛选折叠为抽屉、覆盖行保持单列，禁止横向页面滚动；触控目标不小于 52 CSS px；只对展开、暂停和状态切换使用 120-180ms 的 transform/opacity 反馈，`prefers-reduced-motion` 下即时切换。
- 社区级修订候选：`docs/design/virtual-senior-directions/assets/generated/quiet-task-workbench-community-v2.png`，992×1586、RGB、无 Alpha，SHA-256 `e6535555...4444545`。不可变母版为 `assets/master/quiet-task-workbench-v1.png`，谱系文件为 `assets/generated/quiet-task-workbench-community-v2.lineage.json`；确定性谱系校验 PASS。该稿显示目标完成态，尚未获得用户确认，不能作为当前数据已完成证据。
- 选定稿审美审查：保留单一工作台、冷白医疗蓝、强数据层级和明确底部动作；增强真实覆盖、运行档位、失败影响和恢复；删除 3 人画像横滚、过量纵向分隔、卡片套卡片、侧边强调线和两个以上中点分隔；重做实际未就绪、生成中、部分覆盖和失败状态。候选无单侧线条描边、无全高侧轨、无紫色/玻璃/装饰渐变；实现不得把候选的目标态数值硬编码为当前状态。
- 预实现 Audit：阻断项 0；高优先级 0；中优先级 2，分别是目标态稿未展示“未生成/部分覆盖”以及部分元信息用多个中点分隔。两项已转为强制实现状态与文案规则；低优先级为 750×1200 下筛选密度需在真实页面复测。设计候选允许进入实现，但不能直接作为交付通过证据。

## 7. 编码前门禁

- `PRE_CODE_GATE`: PASS
- 未通过项：无编码前阻断。社区数据、16 Tool Fixture、运行验证和目标机证据属于实现/交付门禁，继续标记未完成，不以此反向阻止编码。
- 通过证据：全局规范完整读取；项目上下文、事实源、参考矩阵、反例和方向定义已建立；方向 1 与社区级修订候选均落盘并有不可变母版/哈希/谱系；用户已选择方向并授权全量开发；Taste、组件、Token、状态、无障碍、动效和响应式规格已定义，预实现 Audit 无阻断或高优先级问题。
- 允许开始 UI 实现的时间：2026-09-03 17:55 CST；仍须以 `validate_design_execution.py --gate pre-code` 退出码 0 为最终确定性证据。

## 8. 实现与审查

- 核心流程操作证据：当前源码 Electron 从首页管理员入口进入测试控制台，实际完成运行档位、9 维 cohort 筛选、5 MCP/16 Tool 覆盖展开、smoke 生成/校验/sweep、统计下钻和退出；统筹报告为 `QA-EXTERNAL/virtual-senior-community/root-final-electron-v16-20260903/electron-ui-report.json`。
- 异常、取消与恢复证据：`electron-lifecycle-controls-20260903-v3/electron-community-lifecycle-report.json` 用真实按钮完成日常回归阶段后暂停→恢复和取消→恢复；`electron-lifecycle-failed-rerun-20260903-v3/electron-community-lifecycle-report.json` 用 test-mode-only 单次 sweeping 故障完成失败→仅重跑失败阶段，前置数据/校验制品未重复。
- 目标视口截图：`root-final-electron-v16-20260903/virtual-senior-initial-750x1200.png`、`virtual-senior-analysis-750x1200.png` 与 `virtual-senior-analysis-2400x3840.png` 均由当前源码真实 Electron 生成；2400×3840 为 macOS 等价视口，不冒充 Windows 实机。
- 同尺寸设计对比：与方向 1 社区稿保持同一冷白医疗蓝、数据摘要→档位/筛选→覆盖树→固定主操作→统计下钻的层级；实现依据真实运行状态显示数据，不复刻设计稿中的目标态数字。原 3 画像主体、假精确文案和单侧选中线均已删除。
- 可访问性与焦点检查：750px 可见有意义文本最低 12px，按钮/正文/筛选最低 14px；六类代表控件经 CDP Tab 均有 2px 全轮廓焦点，焦点可离开并回到控制台；`prefers-reduced-motion: reduce` 下 animation/transition 为 none/0s。
- 控制台 / 溢出 / 横向滚动：750×1200 与 2400×3840 的 `scrollWidth===clientWidth`；undersized 0、oneSided 0、below12px 0、consoleErrors 0，底部主操作未遮挡当前内容。
- 自动测试与构建：统筹当前源码独立复跑完整 Node **246/246 PASS**；Vite **4582 modules transformed**；Sites **4/4 PASS**；相关语法与 `git diff --check` 通过。
- Taste：保留 / 增强 / 删除 / 重做：保留安静任务台、冷白医疗蓝、真实数据摘要、覆盖树和固定主操作；增强状态语义、12/14px 字号下限、52px 触控、焦点、失败恢复与固定/探索分栏；删除画像横滚、假完成数字、单侧线、装饰图表、过度卡片嵌套；重做生成/校验/sweep 生命周期、暂停/取消/失败文案和分析下钻。最终未见明显廉价、模板化、风格冲突或单一参考复刻；仪表盘专用审美 skill 不可用，按全局内置量表降级执行。
- Audit：阻断 / 高 / 中 / 低 / 通过项：阻断 0、高 0、中 0、低 2（Windows 实体触屏/观看距离和系统辅助技术尚未实测）；通过项包括核心任务层级、真实状态、全量数据边界、触控尺寸、文字、焦点、减少动效、无溢出、无单侧线和恢复路径。100 分量表为 **96/100**：用户与场景 20/20、原创性 18/20、层级可读性 15/15、交互 15/15、系统一致性 10/10、动效反馈 9/10、无障碍/隐私 5/5、技术实现 4/5；各维度均达 80% 下限，无本机阻断。

## 9. 交付门禁

- `PRE_DELIVERY_GATE`: PASS
- 回退点：提交 `1d0c3b6`，远端标签 `backup-v1.5.17-pre-virtual-senior-20260903`；当前 M0/M1 功能提交 `57d0a40` 已推送。
- 提交 / 产物：V1.5.19 功能候选提交 `269ce3f` 已推送至 `origin/feat/station-advisor-local-demo`；社区 v1.3 两份确定性数据、独立 sweep、Electron 主流程、生命周期和视觉报告均位于 `QA-EXTERNAL/virtual-senior-community/`，不进入生产包。
- 未验收范围：Windows 2400×3840 实体终端触屏/观看距离、系统辅助技术、Windows/生产打包，以及真实生产 MCP、ASR/TTS/Viseme/V34 链路。
- 最终结论：**条件通过**。本机社区级纯合成测试子系统可用并满足当前设计交付门禁；不等于整体产品、Windows 实机或生产业务数据全面通过。

## 10. V1.5.20 产品经理界面化启动补充

- 任务类型：既有产品窄范围入口修正，不新增页面、不改变信息架构、不引入新组件类型，`DESIGN_VARIANCE=0`；事实源继续为现有“终端管理”弹窗和虚拟长者测试控制台。
- 用户问题：现有入口仅在命令行附加 `--virtual-senior-test` 后出现，产品经理无法通过正常 App 操作进入。
- Design Read：面向产品经理和 QA 的主 App 管理入口，保持现有冷白医疗蓝、明确动作和安全隔离语义，不把测试工具拆成第二个 App。
- `DESIGN_VARIANCE`：3；`MOTION_INTENSITY`：2；`VISUAL_DENSITY`：7；均继承已选“安静任务台”，不调整视觉方向。
- 交互方案：正常双击小安 App，在“终端管理”中点击“启动虚拟长者测试”；App 原地启用隔离测试运行时。双屏时主屏打开测试中心、竖屏保留数字人，单屏时当前 App 直接进入测试中心。用户不接触命令行、端口、Node 或启动参数。
- 安全与恢复：正式会话默认仍不初始化 Fixture MCP；只有管理员显式点击才切换测试模式。完整 QA 数据继续写入 userData 且不进入安装包，关闭测试中心后仍可返回主 App。
- 受影响状态：未启用时显示“启动虚拟长者测试”；点击后原地初始化 QA-only 运行时，双屏打开独立控制窗，单屏进入应用内全屏测试中心；初始化失败时保留管理弹窗并展示可恢复错误。按钮沿用完整轮廓、52px 触控、可见焦点，不使用单侧线条描边。
- Taste 适用性：该页面属于管理仪表盘，`design-taste-frontend` 不作为主设计系统；仅应用其改版保护、按钮对比、文案自审、动效克制和最终预检，主体沿用现有 React、原生 CSS 与 Phosphor Icons。
- `PRE_CODE_GATE`: PASS；本次不触发新参考研究和三方向重做的窄范围例外依据是页面、流程、组件和视觉语言均不变，只补齐既有入口的可达性与启动状态。
- 产品经理入口验收：正常启动、无测试参数的源码 Electron 与最终重打包 App 均从“管理员连接/终端管理”真实点击“启动虚拟长者测试”成功；打包报告 `QA-EXTERNAL/virtual-senior-community/product-manager-launch-packaged-v1520-final/product-manager-launch-report.json` 为 `PASS`，当前单显示器正确采用 `single-screen-embedded`。
- 打包运行验收：`release/mac-arm64/小安站点咨询顾问 V1.5.20.app` 由真实 GUI 完成冒烟档位的生成、全量一致性校验、5 MCP / 16 Tool sweep 与统计分析；最终报告 `QA-EXTERNAL/virtual-senior-community/product-live-ui-packaged-v1520-final/electron-ui-report.json` 为 `PASS`。750×1200 下 `undersized=0`、`oneSided=0`、低于 12px 文本为 0、横向溢出为 0、控制台错误为 0，焦点和减少动态效果审计通过。
- 打包故障与修复：首轮打包实跑暴露 `app.asar` 内 QA 子进程脚本无法执行的 `ENOTDIR`，已将最小生成/校验/sweep 与 Fixture 运行代码放入 `app.asar.unpacked`，并让运行器从该只读运行时加载；完整社区数据仍只在 QA userData 按需生成，不打进安装包。修复后的同链路实跑通过。
- 双屏结论：双屏是推荐模式，数字人终端屏保留真实产品界面，操作员屏显示独立实时测试控制台；显示器选择、窗口路由和回退分支已有自动测试。当前验收主机仅连接一块显示器，尚未形成真实双显示器摆放、焦点迁移与跨屏观看距离证据，因此双屏物理落位为条件项，不冒充实机通过。
- 最终回归：锁定 Node 完整回归 **246/246 PASS**；Vite 生产构建 **4582 modules transformed**、Sites **4/4 PASS**；macOS arm64 未签名 `.app` 已生成。
- 提交 / 推送：V1.5.20 功能提交 `80befb8` 已推送至 `origin/feat/station-advisor-local-demo`；开发前远端回退点 `1d0c3b6` 与标签 `backup-v1.5.17-pre-virtual-senior-20260903` 保持有效。
- `PRE_DELIVERY_GATE`: PASS（macOS 单屏产品经理路径）；双显示器物理落位、Windows 2400×3840、生产 MCP 与真实 ASR/TTS/Viseme/V34 仍为独立未验收范围。
