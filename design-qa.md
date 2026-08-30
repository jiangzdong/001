# Design QA

## 2026-08-30 V1.4.10 上半身微动、唇形时序与面部连续性

- Design Read: 保持 9:16 医疗健康触屏终端的原人物、机位、页面结构、按钮语义和可信克制感；本轮只增强真实人的低频头身重心变化、呼吸、说话点头与面部连续性，不改变业务布局。Taste 参数为 `DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 4`、`VISUAL_DENSITY: 5`。
- 保留: 默认本机女声、SenseVoice 字符时间戳、PCM 音频时钟、本地可打断 Viseme、独立 Blink/Expression 图层和慢速 Ditto GPU 可取消增强层。
- 增强: 以上身约 74% 高度为变换原点叠加双低频重心摆动、呼吸起伏及句首/重音的克制点头；说话状态不再把整体动作压成 28%。语义表情使用 680 ms 缓入、900 ms 缓出与更低能量扰动，降低眉毛抖动和贴片感。
- 删除: 删除字符时间线已完成协同发音后再次经过 Viseme 低通造成的双重延迟；删除快速表情能量跳变及“只动头部”的木桩式局部动画。
- 重做: 时间戳口型直接以当前/下一形状及 68–112 ms 协同过渡渲染；无字符时间戳时才使用 96/108/122 ms 的开口、换形、闭口回退。眨眼全过程锁定最终头身姿态，结束后平滑追赶，避免眼周和眉毛带动整头抖动。
- 上半身动态验收: `qa/upper-body-motion-v1.4.10/report.json` 为 PASS。空闲 8.98 秒横向范围 0.308 cqw、倾斜范围 0.259°；讲话 7.57 秒横向范围 0.151 cqw、倾斜范围 0.093°，最大逐帧变化仅 0.005 cqw/0.004°。表情强度范围 0.249、最大逐帧变化 0.014；5 次自然眨眼内 x/y/tilt 漂移均为 0。
- 自然口型/眨眼: `qa/strict-avatar-portable-final-v1.4.10/report.json` 和 `pixel-check.json` 均为 PASS；自然打包序列覆盖 CLOSED/A/E/O/U、smile/concern/encourage 与 entry/closed/exit，口型重叠和错帧为 0。嘴型两两变化像素为 11.950%–22.484%，眼外头部变化不超过 1.849%。
- 真人同文验收: `qa/reference/v1.4.10-real/summary.json` 为 PASS（3/3）；字符顺序精度 1.0、平均字符覆盖率 0.9855、形状序列精度/覆盖率均 1.0、归一化形状时序 MAE 0.0616，所有片段图层重叠与错图均为 0。跨身份几何相关只作诊断，不冒充像素一致。
- 真实问答与打断: 打包版点击真实问答后 1,581 ms 起声、连续 7,545 ms、最大开合 0.945、覆盖 CLOSED/O/E/U/A、43 次转换；物理点击后 13 ms 停止并进入聆听。证据为 `qa-v1.4.10-realtime-gpu-handoff.png`。
- GPU 边界: `127.0.0.1:8788` 健康接口为 `Ditto TensorRT/PyTorch Hybrid CUDA`、GTX 1660 Ti 6GB、`frameStreaming:true`、`multipart-jpeg-frames`、预热与取消可用；真实 7 秒帧流首帧 1,977 ms、176/176 帧完整，但总吞吐仅 1.31 FPS，因此不接管当前实时回答，实时声画同步由本地 PCM Viseme 保证。
- 自动化与成品: Node 全量测试 123/123、桌面语法检查、逐字口型审计、Vite 4579 模块生产构建及打包运行态均通过。Windows 成品为 `release/XiaoAn-Health-Kiosk-1.4.10-x64.exe`，427,231,211 bytes（407.44 MiB），SHA-256 `831C0ED36CD06B3418024561DBBD1AB46922AF7D0A0B942F29EC8A7AA85C484A`。

## 2026-08-30 V1.4.9 真人同文口型时序与自然表情

- Design Read: 保持 9:16 医疗竖屏、人物身份、机位、页面结构、按钮语义和独立眨眼层；只修复流式声音尾块、逐字注音时序、复韵母可见性、口型节奏与整段满强度表情。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 4`。
- 保留: 默认本机女声、SenseVoice 离线识别、可打断 Web Audio、本机 Ditto GPU 帧流增强和本地 Viseme 实时回退。
- 增强: 每个 PCM 分块在播放前由独立 SenseVoice Worker 生成字符时间戳；ASR 识别替换/漏字通过 LCS 锚点映射回请求原文；复韵母始终保留第二形状；默认语速调为 0.78；52–92 ms 协同过渡及 52 ms 可见稳定门兼顾流畅和完整形状。
- 删除: 删除 IPC 完成即撤销监听导致尾块丢失的竞态；删除“一个 Sherpa 回调只绑定一个标点分组”的错误假设；删除舌位辅音造成的不可见快速抖动；删除语义表情整段 opacity=1 的僵硬保持。
- 重做: 表情采用 520 ms 缓入、受控峰值和低幅能量/呼吸变化；真人验证由单段几何相关升级为 3 段 CC BY 3.0 同文视频，联合真人原声字符时间戳、注音形状序列、归一化时序、MediaPipe 几何曲线与成品图层检查。
- 真人同文验收: `qa/reference/v1.4.9-real/summary.json` 为 PASS（3/3）；字符顺序精度三段均 1.0，显示形状序列精度三段均 1.0，形状覆盖率 0.9688/1.0/1.0，归一化形状时序 MAE 0.0823/0.0438/0.0450；图层重叠与错图均为 0。不同说话人的几何幅度相关仅作为诊断，不冒充同一身份像素一致。
- 自然嘴型/眨眼: `qa/strict-avatar-portable-final-v1.4.9/report.json` 与 `pixel-check.json` 均为 PASS；CLOSED/A/E/O/U、entry/closed/exit、smile/concern/encourage 均来自打包版自然序列。闭眼阶段眼外头部变化均为 0%，口型两两变化像素为 12.879%–23.538%。
- 自然表情: `qa/natural-expressions-v1.4.9/report.json` 为 PASS；concern 强度 0.035→0.641（范围 0.606），encourage 0.335→0.570（范围 0.235），均低于 0.8 峰值且非静态满强度贴图。
- 真实问答与打断: 点击真实头痛问答后 1,335 ms 发声、连续 7,447 ms、口型最大开合 0.922、覆盖 CLOSED/A/E/O/U；物理点击语音按钮后 22 ms 停止并进入监听。证据为 `qa-v1.4.9-realtime-gpu-handoff.png`。
- 自动化与成品: Node 全量测试 121/121，桌面语法检查、Vite 4579 模块生产构建、逐字口型审计和三段真人套件均通过；运行态为 `packaged:true`、`version:1.4.9`。
- GPU 运行态: `127.0.0.1:8788` 返回 `Ditto TensorRT/PyTorch Hybrid CUDA`、GTX 1660 Ti 6GB、`frameStreaming:true`、`multipart-jpeg-frames`、6 步/640、预热和取消可用；最终软件保持打开。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.9-x64.exe`，427,233,143 bytes，SHA-256 `706277744F4AB488344AA2A07385321EA87E13FFEA91FFE63123F04D889B1BF2`。V1.1.0–V1.4.5 历史 EXE 因 C 盘空间不足已保留迁移到 `D:\DigitalHuman2D-release-archive`，V1.4.6–V1.4.8 仍在项目 `release`。

## 2026-08-30 V1.4.8 眉毛稳定与流式语音连续性

- Design Read: 保持医疗竖屏人物、机位、页面结构和克制表情，只修复自然眨眼时眉毛层闪动及短 PCM 频繁淡出/重启造成的听感卡顿。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 4`。
- 保留: V1.4.7 身份锁定眼睑、眨眼头部姿态冻结、双 TTS Worker、注音与 PCM 分块对应、唯一默认女声和本机 GPU 帧流降级策略。
- 增强: 语义表情增加独立 `semanticExpression` 层，眨眼只覆盖眼睑而不再隐藏眉毛；不足 620 ms 的相邻 PCM 自动合并，紧凑短语按真实注音顺序保留 E/O/U，后续块起播等待缩至 1 ms。
- 删除: 删除眨眼期间对整张表情眼眉帧的 `visibility:hidden`；删除每个 0.2–0.3 秒 Sherpa 回调都独立播放的碎片化路径。
- 重做: 严格眨眼验收允许且要求一个正确语义表情层持续存在于眼睑层下方，同时继续拒绝错误表情层、双眼帧重叠和头部漂移。最终指标以 V1.4.8 打包版为准。
- 自然眨眼验收: `qa/strict-avatar-portable-final-v1.4.8/report.json` 与 `pixel-check.json` 均为 PASS；entry/closed/exit 三阶段眉形连续，错误或重复表情层 0，眼外整头 entry→closed 平均差 0、closed→exit 平均差 0.4636，变化像素 0.265%，低于 1.25/3.5% 稳定门槛。
- 长句连续性: V1.4.8 打包版同一固定长句首声 1,597 ms、连续播放 11,416.1 ms、段间静音 0 ms、重叠与错图层均为 0；覆盖 CLOSED/A/E/L/U/O，45 次口型转换，3.942 次/秒。证据为 `qa/reference/portable-final-v1.4.8-long/electron-trace.json`。
- 真实问答与打断: 点击“我最近有点头痛”后 1,398 ms 发声、连续 6,465 ms、最大开合 0.905、4.02 次口型转换/秒；点击语音按钮后 53 ms 停止并重新监听。证据为 `qa-v1.4.8-realtime-final.png`。
- 自动化与成品: Node 全量测试 117/117，桌面语法检查和 Vite 4579 模块生产构建通过；运行态 `packaged: true`、`version: 1.4.8`、唯一默认女声及 620 ms 最小流式 PCM 块均由正式便携包返回。
- GPU 运行态: `127.0.0.1:8788` 返回 `Ditto TensorRT/PyTorch Hybrid CUDA`、GTX 1660 Ti 6GB、`frameStreaming: true`、`multipart-jpeg-frames`、6 步/640、预热和取消可用；V1.4.8 软件保持打开。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.8-x64.exe`，834,657,469 bytes（795.99 MiB），SHA-256 `7AE16D2094766A72A48E55571F28FB94FBE6C81F76487F5D2E86EA67A13BFAC3`。

## 2026-08-30 V1.4.7 眨眼稳定与连续讲话优化

- Design Read: 医疗竖屏数字人，保持人物身份、页面结构、竖屏机位和适老触控语义；本轮只处理眨眼引发的视觉抖动、长回答段间停顿及讲话不流畅。
- Taste 参数: `DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 4`。
- 保留: 首页/二级页同一人物机位、默认女声、语音优先与按钮兜底、SenseVoice 离线识别、可取消的本机 Ditto GPU 增强层。
- 增强: 眨眼全过程冻结已渲染头部姿态；半闭眼重做为身份锁定整帧并收紧到眼睑区域；TTS 改为两个独立 Worker 并行预取，后续段落使用短衔接和 4 ms 起播提前量。
- 删除: 删除带橙棕色大范围眼影的旧半闭帧；删除播放过程中与下一段 TTS 争抢 CPU 的 SenseVoice 二次对齐；删除所有段落统一 24 ms 起播提前量。
- 重做: 严格验收新增整头区域的眼外像素差，不能只看眼睛裁图；长回答新增真实音频 active/inactive 时间窗统计，直接量化段间无声间隙。
- 流式注音修复: Sherpa `onProgress` 每次返回的是最多两句对应的 PCM，口型时间线现只绑定同一批实际文本；整轮仅首块保留闭嘴起始，后续块直接从对应音素衔接。短 PCM 元音至少保留 120 ms，并继续受 128 ms 全局稳定门约束。
- 正式长句对比: V1.4.6 同一句存在 3 段无声间隙，分别为 1,523.4/3,185.2/1,112.6 ms，总计 5,821.2 ms；V1.4.7 打包版首声 1,406.4 ms、连续播放 10,923.9 ms、段间无声间隙 0 ms，五种主口型齐全，3.662 次转换/秒，无嘴部重叠或错图层。证据为 `qa/reference/portable-final-v1.4.7-long/electron-trace.json`。
- 自然动作验收: `qa/strict-avatar-portable-final3-v1.4.7/report.json` 为 PASS，CLOSED/A/E/O/U、smile/concern/encourage、entry/closed/exit 均来自打包版自然 TTS/自然眨眼序列；`pixel-check.json` 为 PASS，半闭↔全闭眼区平均差 7.3531、变化像素 21.539%，左右眼对称，三组眼外整头差异均为 0。
- 真实问答与打断: 点击“我最近有点头痛”后 1,153 ms 发声，连续 6,476 ms，最大开合 0.95、3.71 次口型转换/秒；物理点击语音按钮后 21 ms 停止并进入聆听。证据截图为 `qa-v1.4.7-realtime-final.png`。
- 自动化与成品: Node 全量测试 116/116，桌面语法检查、Vite 4579 模块生产构建通过；运行态 `packaged: true`、`version: 1.4.7`。`release/XiaoAn-Health-Kiosk-1.4.7-x64.exe` 为 834,655,205 bytes（795.99 MiB），SHA-256 `C77EDDDB3311F681E9F609BE93997A896F23D5CC7C37E4B5060FCE562AC52A51`。
- GPU 运行态: `127.0.0.1:8788` 已预热并保持监听，返回 `Ditto TensorRT/PyTorch Hybrid CUDA`、GTX 1660 Ti 6GB、`frameStreaming: true`、`multipart-jpeg-frames`；正式 V1.4.7 软件保持打开。

## 2026-08-29 V1.4.6 流式 PCM、自然口型/表情与最终便携包验收

- Design Read: 医疗竖屏数字人，动作克制、语音优先、触控兜底；保持现有人物、竖屏机位、业务结构和按钮语义，只修复声音起播、口型声画同步、眨眼/表情自然度及慢 GPU 帧覆盖本地口型的问题。
- Taste 参数: `DESIGN_VARIANCE: 2`、`MOTION_INTENSITY: 3`、`VISUAL_DENSITY: 4`。
- 保留: 首页/二级页同一人物机位、固定小安默认女声、SenseVoice 离线识别、DeepSeek 健康对话、青绿色适老视觉和全部触控回退。
- 增强: Sherpa `generateAsync` 进度经 Worker → IPC → Renderer 形成 `progressive-pcm-chunks`；每个 PCM 块立即进入 Web Audio，后续短句并发预生成；SenseVoice 精确字符时间戳接管加权兜底口型，68–110 ms 协同发音过渡和 52–128 ms 稳定门抑制抖动。TTS 与 ASR 均按本机 6 核上限使用 6 线程。
- 增强: 文本语义驱动 `concern/encourage/smile`，标点驱动克制点头；自然眨眼使用随机 112–140 ms 闭合、48–72 ms 停留、178–238 ms 睁开，并保留低频双眨。
- 删除: 删除非默认音色入口；慢于实时的 Ditto 帧不会再覆盖本地 PCM 口型。连续 4 个帧间隔中位数高于 160 ms 时不接管，6 次仍不合格即取消本轮 GPU 帧流。
- 重做: 严格验收不再使用强制 CSS/DOM 状态或阻塞截图。CDP 连续帧在画面角落携带只读自然状态色码，同一张画面内识别 CLOSED/A/E/O/U 与 entry/closed/exit 后裁图，再做像素差和人工逐图检查。
- 真实对话: 打包版从点击症状选项到发声最快实测 2,478 ms，文本为“您主要提到头痛……”，嘴型最大开合 0.965、13 次转换；安全回答复测 4,699 ms。长固定参考句首声 5,574 ms，说明当前 VITS 在本机 CPU 上仍不是亚秒 TTS。
- 打断: 播报中物理点击对话页语音按钮，101 ms 内停止声音/口型并进入聆听；随后再次点击停止测试录音。Ditto 慢帧未接管，`gpuFrameAfterSpeechStartMs: null`，本地口型持续可见。
- 自然口型/眨眼: `qa/strict-avatar-portable-final-markers2-v1.4.6/report.json` 为 PASS；五张嘴图和半闭→全闭→半开三阶段逐图正确。`pixel-check.json` 为 PASS，闭嘴对 A/E/O/U 平均绝对差分别为 6.7791/4.8033/7.1262/6.8752，左右眼差异均通过对称门槛。
- 自然表情: 独立真实 TTS 验收中，`encourage` 4,984.2 ms 出现且唯一图层 opacity=1；`concern` 5,249.5 ms 出现且唯一图层 opacity=0.962081。证据位于 `qa/natural-expression-encourage-diagnostic-v1.4.6/` 与 `qa/natural-expression-concern-final-v1.4.6/`。
- GPU 帧流: `127.0.0.1:8788` 返回 `Ditto TensorRT/PyTorch Hybrid CUDA`、GTX 1660 Ti 6GB、`frameStreaming: true`、`multipart-jpeg-frames`、6 步/640、预热和取消可用。10 帧实测首帧 4,318 ms、1.32 FPS，因此只作为可取消增强层，不声明实时。
- 自动化与构建: Node 全量测试 113/113；Electron/QA 脚本语法检查通过；Vite 4579 模块生产构建与 Sites 产物通过；最终运行态 `packaged: true`、`version: 1.4.6`，唯一默认音色和流式 PCM 能力均由便携包返回。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.6-x64.exe`，830,539,897 bytes（792.06 MiB），SHA-256 `42AD5FF1023B95EFDD01D088E60992DE6638B88E4027BEDE0CF43C58CA7D3FAD`。
- 未冒充通过的边界: 本轮没有用扬声器录回或人工耳听量化音质；实体麦克风拾音也没有重新做真人现场说话验收。已有 ASR WAV 探针识别通过，但物理 Realtek 麦克风仍沿用 V1.4.4 记录的硬件边界。

## 2026-08-29 V1.4.5 对话页声音、身份锁定口型与无重影眨眼修复

- Design Read: 不改页面结构、人物身份或交互布局，只修复“直接和小安说话”页无首句播报、本地口型错位/歪斜/与默认嘴唇重叠、TTS 原始电平偏低，以及眨眼与默认眼睛半透明重叠的问题。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 0`。
- 对话入口: 点击“直接和小安说话”后先播报“您好，我是小安。您可以直接说出您的健康问题，我会认真听。”，播报结束后再进入自动聆听；不再以静默页面作为第一次反馈。
- 声音: 本机 TTS 输出增加 2.8 倍受控播放增益；打包模型 PCM 实测 1.66 秒、RMS 0.0264、峰值 0.1374，不是静音数据。播放显式路由到 Windows 默认 Realtek 扬声器。
- 口型替换: 删除运行时旧 `xiaoa-mouth-atlas-v1.png` 图集依赖，改为与 941×1672 人物母版同尺寸、同机位的 A/O 身份锁定整帧；运行时只在嘴部椭圆内硬替换，A/E 与 O/U 分别只允许一个图层为 `opacity: 1`，`CLOSED/REST` 两层均为 0。
- 重影修复: 嘴部遮罩实心覆盖扩大到 80%，取消 24 ms 透明交叉淡化，默认嘴唇不再从边缘透出。自然眨眼有效采样中左右闭眼帧均固定 `opacity: 1`，不再按 `--blink-progress` 半透明叠加默认眼睛。
- 视觉证据: 打包版 `qa-v1.4.5-viseme-a-closeup.png`、`qa-v1.4.5-viseme-o-closeup.png` 显示 A/O 均位于鼻中线且无双唇；`qa-v1.4.5-blink-replacement.png` 是自然眨眼 `progress: 0.377` 时的真实抓帧，左右闭眼帧均为 1 且无瞳孔重影；`qa-v1.4.5-assessment-avatar.png` 确认二级页人物可见。
- 自动化验收: Node 全量测试 102/102；Electron 桌面模块语法检查通过；viseme 36 帧覆盖 `CLOSED/A/REST/E/O`；生产构建和打包后 ASR/TTS 自检通过。
- 成品验收: V1.4.5 便携版返回 `packaged: true`、`version: 1.4.5`；打包版重复通过自然眨眼、CLOSED/A/O 和测评页人物检查；GPU 服务保持 `Ditto TensorRT/PyTorch Hybrid CUDA`、`frameStreaming: true`、`multipart-jpeg-frames`。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.5-x64.exe`，538,574,827 bytes（513.62 MiB），SHA-256 `9A68939335B2B4AF802F3480BCCB357F0F8A06202A5E4F671CAD02FC05D34CE0`。

## 2026-08-29 V1.4.4 实时口型、自然眨眼与 Ditto 低延迟调度

- Design Read: 保留现有 9:16 适老健康终端、真人身份、页面结构与所有按钮语义，只修复 V1.4.3 中“播报时看不到口型”、眨眼节奏生硬、人物帧被横向拉伸以及慢速 GPU 帧拖累语音的问题。
- Taste 参数: `DESIGN_VARIANCE: 1`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 1`。
- 保留: 首页和二级页共用同一人物机位、青绿色视觉层级、离线 SenseVoice/MeloTTS、触控与语音入口、Ditto multipart JPEG 真帧流。
- 增强: 本地 TTS 音频到达即开始播报；口型按音频时钟连续插值，开口幅度、暗部与纵向位移更清楚；真实语音抓帧记录 `speaking: true`、`mouthOpen: 0.595`。眨眼改为约 48 ms 闭合、20 ms 短停、90 ms 柔和睁开，总时长约 158 ms，并降低双眨频率。
- GPU 同步策略: Ditto 帧只在不落后音频超过 180 ms 时接管；过时帧立即丢弃，播报结束即取消剩余生成。因此声音不会等待 GTX 1660 Ti，也不会为了显示迟到的 GPU 嘴型而造成音画明显错位；首字由同一音频时钟驱动的本地口型承担。
- Ditto 优化与实测: 本机服务使用 `Ditto TensorRT/PyTorch Hybrid CUDA`、12 个采样步、最大边 1280 和启动预热；健康接口返回 `frameStreaming: true`、`renderMode: multipart-jpeg-frames`、`prewarmed: true`。热启动首帧实测约 4.8-5.4 秒，证明 GTX 1660 Ti 无法生成 25 FPS 真正实时 Ditto，不能把本地 GPU 等同于实时速度。
- 人物比例: 实时帧统一 `object-fit: cover` 且顶部居中，940×1672 竖版帧不再被横向压扁或拉宽。
- 视觉证据: `qa-v1.4.4-blink-closed.png` 显示双眼完整闭合且身份稳定；`qa-v1.4.4-mouth-open.png` 为真实本地 TTS 播报中的开口帧，不是静态模拟。人物比例修复证据为 `qa-v1.4.3-frame-aspect-fixed.png`。
- 自动化验收: Node 全量测试 102/102；Electron 主进程、预加载、语音、数字人、帧解析、DeepSeek 与耐久模块语法检查通过；viseme 测试生成 36 帧并覆盖 `CLOSED/A/REST/E/O`；Vite 生产构建通过。
- 成品验收: 打包版运行态返回 `packaged: true`、版本 `1.4.4`、语音 `ready: true`，并连接本机 GTX 1660 Ti CUDA 帧流服务。包内 ASR 实测识别“开饭时间早上9点至下午5点。”，包内 TTS 实测生成 1.50 秒音频。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.4-x64.exe`，535,419,549 bytes（510.62 MiB），SHA-256 `DBA3CD669E66CB9FB877C9EDEA722FFF314CC7AD612CDE446323CEC815AA868C`。
- 麦克风边界: Windows 权限、Realtek 设备、服务、增益、Electron 48 kHz 单声道轨道及软件 VAD 均已修复/确认，但实体输入仍只有约 0.00009 RMS 静音底噪，扬声器回放也未被采集。当前不能声称硬件拾音已修好；下一步需要用户授权重启，或执行有风险的驱动回退/卸载后重装，并检查物理麦克风/插孔。

## 2026-08-29 V1.4.2 远场语音识别修复

- Design Read: 保持 V1.4.1 的当前显示器高度适配与全部界面不变，只修复真实 Realtek 麦克风输入电平低于旧 VAD 固定门槛时无法进入 SenseVoice 的问题。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 0`、`VISUAL_DENSITY: 0`。
- 保留: 675×1080 的 9:16 高度适配画布、真人机位、按钮、文案、语音入口、SenseVoice 与 Ditto TensorRT/PyTorch 帧流链路。
- 增强: VAD 最低门槛由 0.006 RMS 调整为 0.00045 RMS，启动校准不再把用户开口学习成环境噪声；连续两帧超过门槛才激活，兼顾远场声音与瞬时碰撞抗误触。
- 删除: 与本机实际麦克风静音底噪不匹配的 0.006 固定高门槛。
- 重做: 仅重做自适应噪声门限的校准与激活判定，不改变录音时长、停顿结束、ASR 模型或界面状态机。
- Taste 结论: 本轮零视觉变更，不新增状态、装饰或布局分支；用户仍通过原有“直接和小安说话”入口完成对话。
- 真实设备诊断: Electron 麦克风权限为 `granted`，默认设备为 Realtek(R) Audio，48 kHz 单声道、轨道 `live` 且未静音；2.5 秒环境采样平均约 0.000094 RMS、峰值约 0.000138 RMS，确认旧门槛高出静音基线约 64 倍。
- 自动化验收: VAD 低电平持续语音、瞬时噪声与安静环境测试 5/5；Node 全量测试 101/101；Vite 生产构建通过；真实 SenseVoice WAV 识别与五个离线女声合成全部通过。
- Electron 端到端验收: 以项目中文 WAV 作为 Chromium 虚拟麦克风，经正式 `recordSpeech → speech:recognize → SenseVoice → handleText` 链路识别“开饭时间早上9点至下午5点。”；ASR 遥测 `ok: true`、16 kHz、约 292.65 ms，页面显示识别文本并进入回答流程。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.2-x64.exe`，535,397,835 bytes，SHA-256 `3C3E629308D20A97BAE87E6BFC78BF7E36C141169DDFDD5D09BB65F7BBFD53A1`；打包资源 ASR 与 TTS 自检通过。
- 成品实机状态: V1.4.2 以正常实体麦克风模式启动，权限 `granted`，Realtek 输入设备可见，界面为“正在听，请直接说”；1920×1080 显示器上的画布仍为 675×1080、无溢出。

## 2026-08-29 V1.4.1 当前显示器高度适配

- Design Read: 保留现有 9:16 真人健康终端的布局、机位、字号与交互，仅让 Electron 外层画布按当前显示器高度等比缩放并居中；横屏两侧使用既有深色背景承接，不重排内部页面。
- Taste 参数: `DESIGN_VARIANCE: 1`、`MOTION_INTENSITY: 1`、`VISUAL_DENSITY: 2`。
- 保留: 真人与诊室构图、青绿色适老层级、首页双入口、二级页结构、语音与 Ditto 帧流链路、所有触控语义。
- 增强: Electron 根画布同时受视口宽高约束，固定 9:16 比例并在当前显示器中心定位；组件继续使用容器宽度单位，因此随画布等比缩放。
- 删除: Electron 在横屏窗口内强制 `width:100%; height:100%` 的拉伸规则，消除主按钮落到屏幕下方的问题。
- 重做: 仅重做运行态根画布的尺寸与定位，不重做任何内部视觉组件、人物机位或业务流程。
- Taste 结论: 这是低差异的自适应修正。没有增加新装饰、卡片、动效或布局分支；横屏留边服务于保持竖屏比例，视觉焦点仍是人物与两个主任务。
- 自动化验收: Node 全量测试 99/99；桌面资源 12/12；控件回归 3/3；Vite 生产构建通过。
- 当前显示器实测: Windows 为 1920×1080，Electron 内容视口 1920×1080；`.kiosk-shell` 为 675×1080，`x=622.5`、`y=0`、宽高比 0.625，页面横纵溢出均为 0。
- 真实交互: 首页“直接和小安说话”与“开始健康测评”按钮完整位于视口内；点击测评进入 1/8，选择“2 一般”推进到 2/8，逐级返回首页；首页和测评页所有可见按钮边界均在视口内。
- GPU 服务复检: `127.0.0.1:8788` 返回 `ok: true`、`provider: Ditto TensorRT/PyTorch Hybrid CUDA`、`frameStreaming: true`、`renderMode: multipart-jpeg-frames`、`busy: false`，GPU 为 NVIDIA GeForce GTX 1660 Ti 6GB。
- 视觉证据: `qa-v1.4.1-height-fit-welcome.png` 与 `qa-v1.4.1-height-fit-assessment.png`。

## 2026-08-28 V1.4.0 竖屏扩展屏恢复
- Design Read: 面向 60+ 用户的现有 9:16 健康终端做保留式方向修正。扩展屏已由 Windows 设置为 1200×1920 纵向，因此 Electron 直接使用竖屏坐标，不再进行内容旋转。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 0`、`VISUAL_DENSITY: 0`。
- 保留: 真人机位、青绿色适老层级、所有文案、按钮、触控命中、语音及 Ditto 帧流链路均未改变。
- 删除: Electron 根容器 `rotate:90deg`、宽高交换和旋转变换原点；诊断及耐久报告的 `contentRotation` 改为 `0`。
- 显示器路由: Electron 启动时读取 `screen.getAllDisplays()`，优先选择高大于宽的显示器；当前真实 `DISPLAY4` 位于 `(1920,-629)`，窗口边界实测为 1200×1920。没有竖屏时回退主屏并保持竖版比例居中，不拉伸画面。
- 自动化验收: Node 全量测试 98/98，Electron 主进程语法检查及 Vite 生产构建通过。回归明确禁止 `rotate:90deg` 和 `rotate:-90deg`。
- 成品诊断: `ok: true`、`packaged: true`、版本 `1.4.0`、目标 `1200×1920`、`contentRotation: 0`，三个离线语音模型存在且语音 `ready: true`。
- Electron 实景: 正式 `kioskBridge.streamAvatar` 以真实本地 TTS 生成 7,168 个 16 kHz 采样并收到 12 张 Ditto JPEG；940×1672 Canvas 播放完成。`ditto-validation/electron-frame-display.png` 可见文字、人物和按钮均为正向竖屏，无残留旋转或黑块。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.0-x64.exe`，533,560,509 bytes，SHA-256 `6485D114F228C8FCAC056FF55B5C339E8F07B88ABA6DAEB3B179B08D71916B6B`。

## 2026-08-28 V1.4.0 Ditto 真帧流

- Design Read: 面向 60+ 用户的真人数字健康终端保持现有 9:16 诊室构图，只替换嘴型视频的传输与播放底座，不增加技术面板或操作负担。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 1`、`VISUAL_DENSITY: 1`。
- 真帧流协议: 云端 `/v1/render/frames` 使用 `multipart/x-mixed-replace`，Ditto writer 每生成一张 RGB 帧就编码为 JPEG 并立即返回；健康接口改为 `frameStreaming: true`、`renderMode: multipart-jpeg-frames`。
- 客户端链路: Electron 增量解析任意网络分片并通过隔离 IPC 转发 `audio/frame/complete/error` 事件；Canvas 用 `createImageBitmap` 逐帧绘制。由于 GTX 1660 Ti 实测生成速率约 1.13 FPS，客户端先缓冲当前语句的完整帧序列，再按 25 FPS 与同源本地 TTS 音频同步启动，避免播放途中断帧。
- 流式回答: DeepSeek 每形成一个完整语句便进入独立 Ditto 帧流，语句间顺序播放；新输入沿用 turnId 取消音频、HTTP 请求和帧队列。
- 保留: 右转 90°、真人固定机位、欢迎页固定介绍视频、青绿色适老层级、语音主入口和触控回退。
- 增强: 动态回答新增 Canvas 帧平面、首帧指标、预计/实际帧数遥测、按音频时长完整缓冲和旧服务明确降级。
- 删除: 动态回答不再等待完整 MP4 Blob，不再把 `offline-mp4` 描述为流式，也不新增用户可见的帧率或调试信息。
- 重做: 云端 writer 从只写 MP4 重做为“可选 writer + frame_callback”；Electron 从 `arrayBuffer()` 重做为 multipart 增量解析；渲染端从 `<video src=Blob>` 重做为 Canvas 帧队列。
- 自动化证据: Node 全量测试 98/98；Electron 主进程、预加载、帧解析、数字人、语音、DeepSeek 与耐久模块语法检查通过；Python 云端 API、离线/在线 Ditto pipeline 语法检查通过。
- 生产构建: Vite 4579 个模块转换完成，JS 354.28 kB、CSS 62.16 kB；Sites 服务端与 hosting 元数据生成通过。
- 浏览器验收: `http://127.0.0.1:4174/` 标题和页内版本均为 V1.4.0；实时帧 Canvas 存在且可访问名称为“小安实时嘴型帧流”；欢迎页介绍后进入测评 1/8；浏览器日志 0。
- V1.4.0 Windows 成品: `release/XiaoAn-Health-Kiosk-1.4.0-x64.exe`，533,753,465 bytes，SHA-256 `FE6FAD688E8C894610BDDD4C18D1747810ED44A7E21BB83365F4348CABD96B00`。成品诊断 `ok: true`、`packaged: true`、版本 `1.4.0`、内容向右旋转目标 `90`、三个离线 ASR/TTS 模型存在、语音 `ready: true`；打包资源 ASR 实测识别“开饭时间早上9点至下午5点。”，TTS 实测 1.66 秒并以退出码 0 完成。本机屏幕实际为 1920×1080，不能替代目标 1920×1200 物理屏验收。
- 本机 GPU 路线: 已识别 NVIDIA GeForce GTX 1660 Ti 6GB；Python 3.10、PyTorch 2.0.0+cu118 与 CUDA 可用，Ditto 服务已改为只监听 `127.0.0.1:8788` 的 PyTorch CUDA 帧流，不依赖远端主机或 SSH。GTX 1660 Ti 属于 Turing，采用 PyTorch checkpoint，而不使用项目提供的 Ampere+ TensorRT engine。
- 本机 GPU 验收: 官方 Ditto PyTorch 运行文件 12/12 完整，共 2,314,719,638 bytes。`/health` 返回 `ok: true`、`provider: Ditto PyTorch CUDA`、`frameStreaming: true`、`renderMode: multipart-jpeg-frames`、`missing: []`，GPU 为 NVIDIA GeForce GTX 1660 Ti 6GB。7.01 秒、16 kHz 单声道真实 WAV 返回 176/176 张有效 JPEG，热启动首帧 5,198 ms，完整生成 160,560 ms，生成速率 1.13 FPS；GPU 推理期间利用率约 98-99%，显存约 5,529/6,144 MiB，无 OOM。第 10 帧取消成功，随后健康接口恢复 `busy: false`。FP16 解码在该卡上出现 NaN/黑块，现已改用 FP32；首帧与第 70、90、120、176 帧均已输出为验收图片。结论是本机 GPU 帧流、连续帧与取消恢复已通过，但 1660 Ti 生成速度不实时，Electron 必须完整缓冲后以 25 FPS 播放。
- Electron 成品帧展示: 通过打包版页面的正式 `kioskBridge.streamAvatar` 用内置 TTS 合成“您好”，收到 6,656 个 16 kHz 音频采样和 11 张 Ditto JPEG 帧；真实 Canvas 尺寸 940×1672、JPEG 数据长度 137,011，25 FPS 播放完成。`ditto-validation/electron-frame-display.png` 是播放阶段由 Electron CDP 捕获的页面证据，可见右转 90° 完整界面与正常人物，无黑块。Windows Graphics Capture 仍返回 `0x80004002`，因此成品截图采用 Electron 自身本机调试接口，而不是把浏览器预览当作 Electron。

## 2026-08-28 V1.3.0 流式语音与耐久验收工程化

- Design Read: 这是面向 60+ 用户的 9:16 健康终端稳定性升级，保持现有真人诊室与青绿色适老体系。
- Taste 参数: `DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 1`、`VISUAL_DENSITY: 1`。
- 离线中间识别: SenseVoice 采用约 1.8 秒节流、最近 10 秒滚动窗口，识别期间仅更新既有转写区；结束后仍以最长 45 秒完整音频生成最终结果。
- 状态竞态保护: 录音结束后立即关闭本轮预览写入权限，较慢返回的中间结果不能覆盖“正在最终识别”状态。
- 云端流式回归: DeepSeek SSE 客户端从 Electron 主进程解耦，支持可注入模拟流；覆盖分帧、JSON 转义、增量先于完成、取消和超时。
- 耐久模式: `--soak-test-minutes=N` 采集渲染退出、无响应、加载失败、进程总工作集与屏幕门槛，写入 `%APPDATA%/XiaoAnHealthKiosk/soak-latest.json`。运行稳定、语音就绪、1920×1200 屏幕分别报告，不用本机 1920×1080 冒充目标设备通过。
- 保留: 欢迎页真人视觉、青绿色适老对比、语音主入口、触控完整回退、现有向右旋转 90° 内容坐标体系。
- 增强: 只在既有转写区加入中间识别反馈；增加非视觉的流式可测性和耐久报告。
- 删除: 不新增开发者悬浮层、吞吐仪表盘、动画或会干扰老年用户的技术状态文案。
- 重做: 将耦合在主进程的 SSE 消费重做为独立客户端；将一次性录音后识别重做为“节流预览 + 完整终判”。
- 自动化证据: Node 全量测试 94/94；Electron 主进程、预加载、语音、数字人、DeepSeek 客户端与耐久模块语法检查通过；Vite 生产构建和 Sites 构建产物生成通过。
- 浏览器验收: `http://127.0.0.1:4174/` 标题与页内版本均为 V1.3.0；欢迎页可达，固定介绍结束后进入测评 1/8，触控选择后推进至 2/8；浏览器日志 0。
- 本机耐久烟测: Electron 运行 3.008 秒，`runtimeStable: true`、`speechReady: true`、渲染退出/无响应/加载失败均为 0；本机实际 1920×1080，因此 `displayMatched: false`、总门槛按预期不通过。报告已写入 `%APPDATA%/XiaoAnHealthKiosk/soak-latest.json`。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.3.0-x64.exe`，533,784,229 bytes（509.06 MB），SHA-256 `B74BF22710ED61CDBC4AB432556F5243AA0838F362AF085B11349C1B7C084B1D`。该文件由最后一次 94/94 回归后的源码重新构建。
- 打包后诊断: `packaged: true`、版本 `1.3.0`、内容向右旋转目标 `90`、三个离线模型存在、语音 `ready: true`、中间识别模式 `rolling-offline`；报告已由成品更新至 `%APPDATA%/XiaoAnHealthKiosk/diagnostics-latest.json`。本机仍为 1920×1080，不能替代目标屏验收。
- 打包后语音自检: `release/win-unpacked/小安数字健康管理师 V1.3.0.exe --speech-self-test` 与直接读取 V1.3.0 `app.asar`/模型的 ASR+TTS 自检均退出码 0；Windows GUI 子系统未回传控制台文本，因此只把模型加载与任务成功退出记为证据，不虚构识别正文或耗时。
- 体积审计: 打包输入 583,336,794 bytes，其中模型 567,210,109 bytes、前端产物 15,985,531 bytes；体积主要来自三套离线 ASR/TTS 功能资源。
- 外部验收门: 物理 1920×1200 触摸屏的坐标/方向、真实麦克风噪声、30-60 分钟目标机耐久、真实 DeepSeek 网络首 token 以及 GPU Ditto 帧级流仍需对应设备或服务验证。

## 2026-08-28 V1.2.0 端到端低延迟与稳定性升级

- Design Read: 面向 60 岁以上用户的 9:16 健康终端稳定性升级。保持现有真人诊室与青绿色适老体系，只为流式状态、打断、错误恢复和设备诊断增加必要反馈。
- `DESIGN_VARIANCE: 0`
- `MOTION_INTENSITY: 1`
- `VISUAL_DENSITY: 1`
- 保留: 现有真人小安、诊室构图、适老字号、青绿色单一强调色、八题测评、症状状态机、五个离线女声和顺时针 90 度 Electron 成品方向。
- 增强: DeepSeek SSE 增量文字、完整短句立即 TTS、后续短句顺序预生成、新输入取消旧 AI/语音/数字人任务、自适应 VAD、前滚录音、12 秒无声退出、点击打断、隐私化阶段耗时、窗口与屏幕诊断、单实例、渲染异常恢复、Ditto 三次失败短路和本地 Viseme 回退。
- 删除: 最长五分钟持续积累录音、等待完整 AI JSON 才显示回答、旧轮次继续覆盖新状态、云端失败持续重复请求、把离线 MP4 宣称为帧级实时流的错误能力表达。
- 重做: DeepSeek 主进程请求改为可取消 SSE；回答正文按 JSON 字符串增量解码并按句播报；语音采集改为动态噪声门限；健康红旗回归补齐摔倒后不能站立及胸痛伴呼吸困难。
- Taste 结论: 不换肤、不重排、不增加装饰动画或新卡片体系。新增文案只承担“正在听、正在回答、点击打断”三项实时状态反馈，颜色、圆角、层级、人物和触控尺寸均保持原体系。
- 自动化验收: Node 测试 89/89；Electron 主进程、预加载、DeepSeek 流解析、遥测、语音和数字人语法检查通过；生产构建通过。
- 浏览器验收: `http://127.0.0.1:4174/` 可达，标题和页面显示 V1.2.0；欢迎页进入 Ditto 固定介绍后到测评 1/8；触控推进到 3/8；播报中点击“打断小安并开始提问”后立即进入聆听状态；浏览器日志 0。
- 包体审计: 源资源 583,325,301 bytes，其中离线模型 567,210,109 bytes。SenseVoice 约 240.5 MB，MeloTTS 约 191.2 MB，四中文女声音色约 135.5 MB。模型承担离线回退，本轮不以删除离线能力换取缩包。
- 外部验收门: 当前 Ditto 云端真实报告 `offline-mp4`，不是帧级实时流；在线 DeepSeek SSE 实测在当前网络 60 秒无响应，已补 30 秒硬超时；物理 1920×1200 屏幕方向、触控坐标、真实麦克风噪声和 30-60 分钟耐久仍需目标设备验证。
- Windows 成品: `release/XiaoAn-Health-Kiosk-1.2.0-x64.exe`，533,740,693 bytes（509.01 MB），SHA-256 `5936EE1680FDC0BF2962F0340F758C3FCB328C51E4AE1239396EA16584ABDAF5`。
- 打包后诊断: `packaged: true`、版本 `1.2.0`、内容旋转目标 `90`、三个模型存在、离线语音 `ready: true`；报告写入 `%APPDATA%/XiaoAnHealthKiosk/diagnostics-latest.json`。当前测试机屏幕为 1920×1080、系统旋转 0，不能替代目标 1920×1200 设备。
- 打包语音自检: SenseVoice ASR 通过；MeloTTS 通过，测试音频 1.50 秒。
- 原生窗口验收: `小安数字健康管理师 V1.2.0.exe` 成功启动且只出现一个窗口；无障碍树可读取欢迎页、音量、大字、慢速、对话和测评入口。Windows Graphics Capture 仍返回 `0x80004002`，因此不把原生窗口截图或物理旋转方向记录为已验证。

## 2026-08-28 V1.1.1 顺时针 90 度方向调整

- Windows 成品: `release/XiaoAn-Health-Kiosk-1.1.1-x64.exe`，533,763,423 bytes（509.04 MB），SHA-256 `89F902AAA6A28E6896C0AAD7766440C6FF0D9660DC721F6B23E8B97488605420`。
- 打包语音自检: SenseVoice ASR 通过；MeloTTS 通过，测试音频 1.66 秒。

- Design Read: 对适老 9:16 健康终端做保留式方向调整。Electron 横屏窗口内将完整竖屏画面顺时针旋转 90 度，不改变原布局、人物构图、文案、色彩或交互顺序。
- `DESIGN_VARIANCE: 0`
- `MOTION_INTENSITY: 0`
- `VISUAL_DENSITY: 0`
- 保留: 现有 9:16 画布、写实小安、诊室背景、适老字号、青绿色强调色、全部按钮尺寸和健康业务流程。
- 增强: Electron 外层旋转方向由左转 90 度修正为右转 90 度；继续交换宽高并以画布中心为变换原点，画面和触控命中区域同步旋转。
- 删除: `rotate:-90deg` 左转规则；回归测试明确禁止其重新出现。
- 重做: 仅修改 Electron 根容器方向和 V1.1.1 版本标识，不重做任何内部页面结构或视觉组件。
- Taste 结论: 不增加装饰、动效、布局分支或新设计语言。方向变化服务于物理屏幕安装，现有单一主题、单一强调色、圆角体系和适老层级保持不变。
- 自动化验收: Electron 旋转规则测试通过；桌面资源测试 12/12；全量测试 76/76；生产构建通过。
- 浏览器验收: V1.1.1 页面可达，欢迎页可进入健康测评 1/8，控制台 warning/error 为 0。浏览器预览保持竖屏，右转规则只应用于带预加载桥接的 Electron 成品运行态。

## 2026-08-28 V1.1.0 流式语音基础交付复检

- Design Read: 面向 60 岁以上用户的 9:16 竖屏健康数字人终端。本轮只升级语音调度、任务取消和迟到结果丢弃，不改变既有写实人物、青绿色健康视觉、信息架构或交互文案。
- `DESIGN_VARIANCE: 0`
- `MOTION_INTENSITY: 0`
- `VISUAL_DENSITY: 0`
- 保留: 现有写实小安人物、诊室背景、竖屏布局、适老字号、三项大触控答案、顶部设置和原有健康安全边界。
- 增强: 长回答按自然短句切分并顺序播放，后续短句预合成；每轮语音与数字人请求携带唯一 `turn_id`；新输入可取消旧轮次并丢弃迟到结果。
- 删除: 已失效轮次继续播放、旧请求结果覆盖新状态，以及流式回答仍等待整段 Ditto MP4 后才出声的路径。
- 重做: 仅重做语音轮次生命周期和 Electron/Vite 取消链路。视觉结构、配色、圆角、动效和页面层级均未重做。
- Taste 结论: 本轮为零视觉变更。未新增装饰、渐变、卡片、标签、无意义动画或布局重排，保留现有单一主题、单一强调色和适老触控体系。
- 浏览器实测: `http://127.0.0.1:4173/` 可达；欢迎页完成后进入健康测评 `1/8`；触控选择“2 一般”后进入 `2/8`；控制台 warning/error 为 0。
- Windows 成品启动: `release/win-unpacked/小安数字健康管理师 V1.1.0.exe` 已在真实 Windows 桌面启动并暴露唯一窗口；窗口标题、人物、音量/大字/慢速、健康对话和健康测评入口均可从无障碍树读取。当前机器的窗口截图捕获返回 `0x80004002`，Electron WebView 未提供点击几何，因此成品内点击未由桌面自动化完成；交互流程由同构生产构建的浏览器实测覆盖，不把它记录为成品点击证据。
- 自动化验收: 全量 Node 测试 76/76 通过；新增短句切分、文本无损、长度上限、轮次唯一性和数字人取消测试通过；生产构建通过；SenseVoice ASR、MeloTTS 五个女声和 20 帧 Viseme 实测通过。
- 能力边界: 当前是短句级流式语音基础，不是 DeepSeek token 级流式，也不是 Ditto 帧级实时视频。Ditto 仍输出完整 MP4，ASR 仍在停顿后整段识别。

## Evidence

- Source visual truth: `public/assets/visual-target-premium.png`
- Source-derived clean clinic background: `public/assets/xiaoa-clinic-clean-v1.png`
- Browser-rendered implementation: `qa-correct-design-final.png`
- Normalized side-by-side comparison: `qa-reference-vs-implementation-final.png`
- Focused state captures: `qa-correct-assessment.png`, `qa-correct-talk.png`
- Viewport: 667 x 1187, 9:16 portrait kiosk

## Taste gate

- Design Read: a premium, trust-first digital health kiosk for people aged 60+, led by a full-screen photorealistic health manager with soft clinic depth, frosted glass controls and one dominant teal voice action.
- `DESIGN_VARIANCE: 5`
- `MOTION_INTENSITY: 4`
- `VISUAL_DENSITY: 4`
- 保留: full-screen real-person composition, bright clinic scene, top-right online pill, translucent dialogue card, dominant voice CTA, outlined assessment CTA and three-part glass utility dock.
- 增强: larger senior-friendly type, high-contrast button states, full-column touch targets, microphone listening animation, speech feedback and the working conversation path.
- 删除: the mistakenly substituted white split layout, side introduction copy, emergency or first-aid entries, staff handoff and decorative elements absent from the selected design.
- 重做: rebuilt the welcome screen from the correct reference, generated a clean clinic/person background by removing baked UI, recreated all controls as live accessible components, and aligned the vertical rhythm to the source.

## Fidelity check

- Person and scene: the same centered teal-scrub health manager and clinic composition are retained. Face, shoulders and chest remain unobstructed; glass controls begin over the lower torso only.
- Layout: online status, dialogue card, voice control, assessment action and bottom dock align with the reference at the normalized 667 x 1187 viewport.
- Typography: Windows-native Chinese sans-serif fallbacks, large high-weight labels and no clipping or unintended wrapping.
- Interaction: all visible controls are real buttons. Voice enters conversation and starts listening; assessment opens the eight-question flow; volume, large text and slow speech toggles work.
- Product boundary: the reference's `工作人员` item is intentionally replaced by `慢速` because this product excludes human handoff. No emergency or first-aid feature is present.

## Verification

- Welcome to conversation: passed.
- Welcome to assessment: passed.
- Assessment back navigation: passed.
- Voice, large-text and slow-speech controls: passed.
- Impeccable layout detector: no findings.
- Desktop syntax checks: passed.
- Desktop asset path test: 1/1 passed.
- Sites tests: 4/4 passed.
- Project skill tests: 2/2 passed.
- Production web build: passed.
- Side-by-side visual comparison: passed with the staff-to-slow product-boundary exception.

## Final result

passed

## 2026-08-19 二级页面稳定性与字体复检

- 复现结果: 进入测评页时出现人物切换、面板淡入和人物层缩放叠加，语音页还会因说话与听写状态快速切换而重复刷新视觉状态。
- 根因修复: 所有页面统一使用 `xiaoa-clinic-clean-v1.png`；移除二级页整屏淡入、数字人整体呼吸缩放、语音光环循环和分析圆环循环；对话入口不再延迟 320ms 自动抢占麦克风。
- 字体重做: 二级页标题、说明、选项、聊天消息、结果卡和计划卡统一到适老字号与行高，按钮改为整行大触控区；二级页与首页共用青绿色、雾蓝玻璃、圆角和底部工具栏语言。
- 人物保护: 二级页保留同一真人与诊室构图，人物不再换图；内容面板从人物胸部以下开始，脸部与肩部无遮挡。
- 闪烁验证: 测评页进入后的 0ms、80ms、260ms、稳定态四张截图 SHA256 完全一致，均为 `D28AD32CFA214C62F5291BB1599EC8BEA6CEA014E33CDBAE16CDD6A5E4780B19`。
- 证据: `audit-secondary-pages/15-dev-after-click-test.png`、`audit-secondary-pages/17-transition-assessment-000ms.png` 至 `20-transition-assessment-stable.png`、`audit-secondary-pages/transition-after-contact-sheet.png`。
- 回归保护: 新增静态测试，防止人物资源切换、延迟自动听写、人物整体动画、光环和面板入场动画重新出现。

### Taste 决策

- 保留: 首页真人主视觉、单一青绿色主动作、雾蓝诊室和玻璃工具栏。
- 增强: 60岁以上用户所需的大字号、强层级、整行点击区域和页面连续性。
- 删除: 无任务价值的循环光环、整屏淡入、人物整体缩放和进入页面即抢麦克风。
- 重做: 对话、测评、结果、计划和分析页的排版系统，使其从同一个设计语言自然延展。

## 2026-08-19 对话页与点击式语音复检

- 设计模式: 针对60岁以上用户的竖屏健康对话终端，`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 4`。
- 视觉修复: 对话页改为真人主视觉、单一大语音动作、识别说明、最近两条回复和常见问题的顺序；移除重复标题、拥挤聊天气泡和无意义的大面积空白。
- 人物修复: 对话页人物改为顶部对齐，完整显示面部和肩部；关闭该裁切状态下不可靠的局部嘴型覆盖层，保留清晰的说话状态反馈。
- 交互修复: 首页从“按住说话”改为“点击开始对话”；一次点击进入对话并立即启动识别，对话页再次点击可提前停止，静默后也会自动停止。
- 网页语音: Vite 本地预览增加 `/api/speech/recognize`，浏览器采集麦克风 PCM 后调用项目自带 SenseVoice 离线模型，不再依赖浏览器自带语音识别。
- 实际验证: 点击后按钮进入 `aria-pressed=true`，文案显示“正在听，请说话”；本次实测识别到“这那个.”，随后生成本地健康对话回复。
- 目标尺寸: 667 x 1187 竖屏截图未发现人物遮挡、文字溢出、按钮换行、横向滚动或底部工具栏冲突。
- 证据: `audit-secondary-pages/29-talk-667x1187-final.png`、`audit-secondary-pages/30-talk-listening-667x1187.png`。
- 自动化: 桌面语法检查通过；桌面资源与语音交互测试 5/5；Sites 4/4；项目 Skill 3/3；SenseVoice ASR 实测通过；5个离线女声 TTS 实测通过；生产构建通过；浏览器控制台无错误。

### Taste 结论

- 保留: 真人、诊室背景、青绿色主色和底部适老工具栏。
- 增强: 主任务尺寸、点击状态、停止提示、识别结果与错误恢复。
- 删除: “按住说话”、重复信息、人物胸部错误裁切和无功能价值的动画。
- 重做: 对话页信息层级，以及网页预览的离线语音识别通道。

### 最终结果

passed

## 2D 数字人动效增量

- 保留: 原有真人构图、9:16 终端布局、青绿色单一强调色与大字号触控路径。
- 增强: 离线 TTS 播放时以 Web Audio 实时能量驱动嘴部开合；浏览器语音回退时使用克制的语速节奏模拟；增加极轻微呼吸感。
- 删除: 无意义的持续光环动画，避免与老年用户的主要任务争夺注意力。
- 重做: 将单张真人图拆为基础图、口腔暗部和嘴部局部层，并为减少动态效果偏好提供静态降级。

## 离线音色增量

- 保留: 底部工具坞的直接触控结构与单一青绿色选中态。
- 增强: 提供 5 个女性离线音色的选择、选中状态、即时试听和本机偏好记忆，默认使用中文女声 3。
- 删除: 男性角色音色 `bazong`，避免数字人形象与播报声音不一致。
- 删除: 无效的前端 `sid: 2` 参数，避免界面声称切换但工作线程仍固定使用音色 0。
- 重做: 语音工作线程按模型缓存实例，并对白名单内的模型与说话人编号进行边界校验。

## Viseme 精确口型增量

- 保留: 真人单图、真实音频能量驱动和克制的嘴部运动幅度。
- 增强: 从模型词典提取发音序列，增加闭唇、自然、开口、横向、圆唇和窄圆唇六类状态，并与音频播放进度同步。
- 删除: 仅按音量上下开合的单一嘴形，避免所有发音看起来相同。
- 重做: 嘴部暗腔和下唇局部层同时响应宽度、圆度、开合与位移，静音和标点处回到闭唇状态。

## 2026-08-19 满分工程门禁

### 评分结果（100/100）

- 功能完整性 30/30：语音入口、点击停止识别、八题测评、结果与计划闭环、管理员密钥入口、5 个女性离线音色均可用，默认中文女声 3。
- 适老与可访问性 20/20：大触控区、大字模式、清晰状态文案；设置弹窗具备焦点锁定、Esc 关闭、焦点归还、标题与说明关联。
- 语音与口型 20/20：五音色真实 TTS 通过；音频能量与六类 viseme 共同驱动口型；合成准备与真实播放状态分离。
- 稳定性 15/15：AI 调用用 `try/finally` 复位忙碌状态；20 秒超时自动回退本地助手；连续试听和转场播报会取消旧任务；语音工作线程异常可清理悬挂任务。
- 性能 10/10：词典解析移入 Worker；音频增加短淡入淡出；进度条使用 `transform: scaleX()`，不再动画布局属性；Impeccable 检测为 0 项。
- 安全与隐私 5/5：Electron 保持上下文隔离、沙箱和禁用 Node 集成；API Key 使用 Windows 当前用户加密；医疗边界不诊断、不调药，专业与紧急情况只引导正规医疗机构或急救服务。

### Taste 决策

- 保留：真人诊室主视觉、9:16 适老终端结构、青绿色单一主强调、底部四项高频设置。
- 增强：语音准备/播放状态、真实配置状态、管理员入口、女性音色试听反馈、键盘与读屏语义。
- 删除：把“已配置”误写成“已连接”的状态承诺、主进程同步解析口型词典、无超时 AI 请求、布局属性动画。
- 重做：对话失败回退链、弹窗焦点生命周期、试听防抖与播报取消、TTS 准备到播放的时序。

### 自动化证据

- Production build：通过。
- Desktop syntax：通过。
- Desktop assets / digital-human gates：7/7 通过。
- Sites packaging：4/4 通过。
- Project skills：3/3 通过。
- Viseme：20 帧，覆盖 `CLOSED/A/REST/E/O`，通过。
- Offline speech：ASR 通过；MeloTTS 与 `zh-ll-0` 至 `zh-ll-3` 五个女性音色全部生成成功。
- Impeccable detector：0 项。

当前会话的本地 URL 受应用浏览器策略限制，无法新增“本轮修改后”的动态截图证据；因此上述 100 分仅指可重复执行的工程验收门禁，不以旧截图冒充当前视觉证据。

## 2026-08-19 嘴型不可见修复

- 复现：桌面对话页可以正常播音，但真人嘴部没有肉眼可见变化。
- 根因：对话页后置样式将嘴部图层设为 `display:none`；系统“减少动画”偏好也隐藏口腔层；二级页面裁剪坐标没有匹配竖版真人图的顶部裁切方式。
- 修复：恢复所有语音页面的嘴部图层；减少动画模式只关闭装饰动画，不关闭承载语义的发音口型；分别校准首页、对话页和其他二级页嘴唇坐标；提高低音量音频的发音可见下限。
- 保留：真实音频能量与 viseme 双重驱动，不使用人物整体摇晃冒充说话。
- 增强：口腔高度与下唇位移，使站立观看距离下仍可辨认。
- 删除：对话页和无障碍模式中错误的嘴部隐藏规则。
- 验证：生产构建通过；数字人/桌面资产回归 9/9；viseme 20 帧覆盖 `CLOSED/A/REST/E/O`；Impeccable 0 项。

### 嘴唇中心校准

- 复现：恢复口型后，局部嘴唇在横向形变时向画面左侧漂移，产生“嘴巴歪了”的观感。
- 根因：真人原图的嘴唇中心约在画面横向 51%，而裁剪与变换原点使用 50%；同时对完整克隆图层执行 `scaleX` 会放大中心误差。
- 修复：裁剪中心和变换原点统一校准至 51%；收窄裁剪范围、降低下唇位移，取消克隆图层横向缩放，仅由对齐后的口腔层承担宽度和圆唇变化。
- 验证：生产构建通过；数字人回归 9/9；Impeccable 0 项。

## 2026-08-19 真实 2D 嘴型与表情素材化

- 技术路线：删除“克隆原图并用 CSS 拉伸嘴唇”的最终依赖，改为生成式真人局部图集 + 双层嘴型交叉淡化 + 表情状态机。
- 嘴型素材：`public/assets/xiaoa-mouth-atlas-v1.png`，4×3 共 12 个真实下半脸状态，运行时使用 `CLOSED/REST/A/E/O/U` 六类 Viseme。
- 表情素材：`public/assets/xiaoa-expression-atlas-v1.png`，3×2 共 6 个眼眉状态，运行时覆盖自然、眨眼、微笑、关切、鼓励和倾听。
- 身份约束：两套素材均以 `xiaoa-clinic-clean-v1.png` 为编辑目标，要求固定身份、正面机位、光线、肤色、比例和像素位置；只通过羽化遮罩替换局部区域。
- 动效：嘴型使用两个图层以 55ms 交叉淡化；音频能量低于阈值时自动闭唇；表情每 3.2～5.8 秒自然眨眼，倾听、讲解、计划和重点关注使用不同状态。
- 保留：现有离线 TTS、音频分析器、词典 Viseme、真人诊室主视觉和适老交互流程。
- 增强：真实牙齿、舌头、圆唇、咬唇和眼眉表情素材；中性状态不覆盖原眼睛，降低身份漂移。
- 删除：运行时对单张原图嘴部做高度计算、横向缩放和坐标补丁。
- 验证：生产构建通过；图集资产链定向测试 1/1；Viseme 20 帧测试通过；Impeccable 0 项。完整桌面测试中另有两项与本次数字人无关的既有断言已落后于新的健康技能/测评理解实现，未用修改业务代码的方式掩盖。

### Imagegen 交付记录

- 使用 Skill：`imagegen`，内置编辑模式。
- 嘴型提示核心：以现有女性为身份锁定参考，生成同机位 4×3 普通话真实嘴型图集，禁止身份、机位、光线、比例和嘴唇中心漂移。
- 表情提示核心：以现有女性为身份锁定参考，生成同机位 3×2 上半脸表情图集，限制为适合 60+ 康养场景的克制自然表情。
- 授权注意：正式部署前应确认基础人物肖像及生成衍生素材拥有产品使用授权。
## 2026-08-19 适老对话页一致性复查

- 目标视口：667 x 1187 竖屏。
- 对话回答改为全宽白色阅读卡，正文 3.25cqw，行高 1.62；“大字”模式提升至 3.6cqw。
- 常见问题按钮提升到 8.8cqw 高、2.75cqw 字号，并沿用测评页的青绿色、软圆角和右向引导图标。
- 手动点击测评选项会立即记录并进入下一题；只有语音识别命中的答案显示语音内容确认卡。
- 浏览器实测：点击“睡得很好”后直接从第 1/8 题进入第 2/8 题，没有出现二次确认。
- 对话页人物保持完整头肩构图，内容层从画面 32% 处开始，没有遮挡面部。
- 自动检查：桌面资源 8/8、Sites 4/4、Skills 3/3 均通过，生产构建通过。
## 2026-08-19 数字人主舞台与底部控制台复查

- 目标视口：667 x 1187 竖屏。
- 对话页人物主舞台由 32% 提升至 42%，内容面板从 40.5% 开始，只在人物下方形成轻微衔接，完整保留面部、肩部和上半身。
- 增加数字健康管理师状态名牌，区分陪伴、倾听和讲解状态，状态信息不是装饰标签。
- 底部控制台改为 10.8% 高的四张独立触控卡；每张包含 6.8cqw 图标承托面、2.55cqw 主标签和当前状态说明。
- 选中状态使用青绿色图标底和白色图标，按下反馈不改变布局尺寸。
- 对话区域不再重复显示用户气泡，语音按钮已经展示识别文本，避免人物增大后挤压回答正文。
- 常见问题保留两项高频入口，确保初始视口内完整显示回答、建议和控制台。
- 验收截图：`audit-secondary-pages/37-avatar-dock-final-state-667x1187.png`；选中态截图：`audit-secondary-pages/38-dock-active-large-text-667x1187.png`。

## 2026-08-19 测评语义澄清状态复查

- 设计模式：现有适老健康测评的定向交互修复，`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 5`。
- 保留：真人数字人、青绿色主动作、超大答案按钮、语音确认卡和底部四项控制台。
- 增强：增加正在理解、最多两个候选、一次追问和安全信号四种明确状态；候选按钮保持适老字号与大触控面积。
- 删除：固定关键词未命中后的死路提示，不再要求老人重复说出预设词。
- 重做：语音回答进入结构化语义理解，高置信度确认，中低置信度澄清；触控选择继续直接进入下一题。
- Taste 检查：单一主题与强调色保持一致；按钮文案不换行；无装饰动画；无长破折号；新增文案均为短句；危险状态不显示人工转接入口。
- 实际页面：在 667 x 1187 竖屏中，测评面板位于人物下方，面部和上半身未被遮挡；第一题触控后直接进入第二题，无二次确认。

## 2026-08-19 HeyGen 真人视频数字人接入

- Design Read：9:16 适老健康终端，面向 60 岁以上用户，采用可信、克制、写实的医疗服务表达。
- 参数：`DESIGN_VARIANCE: 2`、`MOTION_INTENSITY: 3`、`VISUAL_DENSITY: 4`。
- 保留：现有测评信息架构、青绿色单一强调色、大触控按钮、女性离线音色和无障碍设置。
- 增强：固定播报优先使用 HeyGen 真人视频，真实嘴型、眨眼、头部微动作和语音由同一段视频同步输出；静音和慢速设置同时作用于视频。
- 删除：真人视频播放时不再叠加 CSS 嘴型图集和表情贴片，避免嘴部错位、身份漂移和双重发音动画。
- 重做：数字人展示层改为静态真人海报加按需视频播放器；视频结束、播放失败和页面切换都有清理逻辑；未配置视频的动态文案回退到原有离线语音。
- 2026-08-19 人物恢复：所有页面重新统一使用原写实健康管理师 `xiaoa-clinic-clean-v1.png`，停用后来接入的 HeyGen 人物视频，避免首页、测评和结果页面出现身份切换；离线女声、音量驱动与 viseme 口型继续保留。
- 2026-08-19 语音反馈修复：删除重复的“无需按住”提示，将识别内容从按钮副文案拆为独立大字状态区；补齐“正在听、正在识别、识别结果、权限失败”状态，并显式允许桌面端音频权限。
- 2026-08-19 大屏环境：目标显示器原生分辨率为横向 3840×2400，旋转后按竖向 2400×3840 使用；应用采用 10:16 画布并全屏铺满，其他横屏仅作预览，预览两侧保持纯深色空背景。
- 构图：HeyGen 原始 9:16 文件包含横版人物画面，运行时在欢迎页和二级人物舞台分别使用中心裁切比例，去除上下留白并保持面部完整。
- 限额：免费方案在 3 条 Avatar IV 视频后达到月度上限，其余 11 条任务被服务端拒绝；代码不引用失败素材，避免无声或黑屏。
- 实测：首页构图通过；点击开始健康测评后第一题视频自动播放；第一题选择后第二题视频自动播放；生产构建通过。

## 2026-08-19 多领域个性化计划复查

- Design Read：保留现有八题与两级结果，用答案画像决定结果重点和行动计划，不再用同一组固定行动覆盖所有用户。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 1`、`VISUAL_DENSITY: 5`。
- 保留：真人数字人、青绿色视觉系统、结果等级、三项计划结构和底部适老控制台。
- 增强：结果页展示最多两个优先领域；计划页每项同时提供行动和记录方法；八题标记为状态、频率、依从性、事件计数和自我感受五种类型。
- 删除：固定的“活动、服药、睡眠”通用计划，不再让不同答案得到相同内容。
- 重做：睡眠、胃口、活动、服药、心情、步态、跌倒和整体感受分别生成领域行动，并按安全、医嘱、功能和用户目标顺序解决冲突。
- Skill 路由：计划维度分别映射到健康评测、睡眠健康、脑健康、运动康复和康复管理；一次最多突出三个不同计划领域。
- Taste 检查：结果页最多两条重点，计划页固定三项；使用短句、大字号和单层层级；未增加动画、装饰标签或内部评分。
- 实测：全平稳画像生成“活动、作息、健康回顾”；胃口变差且经常漏服生成“服药提醒、规律进餐、日常活动”，两组结果和计划明显不同。

## 2026-08-19 Ditto 开源真实口型接入

- Design Read：现有 9:16 适老医疗终端的保留式升级，仅替换数字人播放层，不改变信息架构和操作习惯。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 3`、`VISUAL_DENSITY: 5`。
- 保留：浅色临床视觉、首页双入口、大触控按钮、第三种中文女声默认值、离线语音和静态人物失败回退。
- 增强：点击“开始健康测评”后先播放 Ditto PyTorch 生成的音画一体真人介绍，嘴型、眨眼、头部微动和声音来自同一段模型输出。
- 删除：Ditto 播放期间隐藏 CSS 嘴部叠层，避免双嘴、偏移和不同步；视频播放完毕后再进入第一题。
- 回退：视频加载或播放失败时自动进入测评，并使用原有本地女声播报，不阻断核心流程。
- 边界：当前接入的是固定开场的真实模型结果；其余任意动态文案仍使用本地 TTS 与离线 Viseme，AMD 核显设备不宣称本地实时运行 Ditto。

## 2026-08-20 持续对话与隐藏入口复检

- Design Read：面向60岁以上用户的竖屏健康数字人大屏，保留现有写实人物和青绿色健康视觉，用稳定、直接、低干扰的状态反馈完成连续语音对话。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 5`。
- 保留：原写实小安人物、人物右下角的“今天想了解什么？”与主页按钮、左下角数字健康管理师状态、顶部音量/大字/慢速设置。
- 增强：进入对话立即开启麦克风；一次话语识别完成后等待小安播报结束再继续聆听；对话历史固定为独立滚动区并自动定位最新回答；额头五击热区覆盖真实额头位置。
- 删除：进入对话前抢占麦克风的欢迎播报、高频失败重启、互相冲突的滚动规则，以及错误位于人物头顶上方的隐藏热区。
- 重做：语音生命周期改为“聆听 - 识别 - 回答 - 播报 - 恢复聆听”的单循环；浏览器识别在异步理解结束前不提前复位；额头入口使用五秒内五次抬起事件触发。
- 适老检查：关键语音状态保持大字号；右下角动作不遮挡面部；对话区域支持触控上下滑动、鼠标滚轮和键盘聚焦；无新增装饰动画。
- 实际验证：进入对话后900ms内显示“正在听，请直接说”；连续2秒采样8次均保持监听状态；生成多轮历史后滚动区域 `scrollHeight 1232 > clientHeight 255`，可从底部上滑到中段并返回底部；额头连续点击5次成功打开音色设置，关闭后自动恢复监听。
- 语音回归：SenseVoice 离线识别通过；MeloTTS 与四个中文女声均成功合成；Viseme 生成20帧并覆盖闭唇、开口、自然、横向和圆唇状态。
- 视觉证据：`audit-secondary-pages/39-continuous-listen-scroll-fixed-667x1187.png`、`audit-secondary-pages/40-continuous-listen-scroll-fixed-750x1200.png`。

## 2026-08-20 对话页空间与模块一致性复检

- Design Read：保留现有真人小安、青绿色临床空间和适老大字，不改变交互流程；本次是对话页的保留式排版整理。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 5`。
- 保留：完整人物构图、顶部常用设置、连续自动聆听、独立历史滚动区和两项常见问题。
- 增强：人物底部的管理师状态、提问提示和主页入口统一为同高、同圆角、同玻璃背景、同图标承托和双行文字层级；主页列加宽，文字完整显示。
- 删除：已隐藏底部工具栏遗留的 13.8% 空间占位，内容层直接延伸至画布底边。
- 重做：常见问题区作为对话面板的底部锚点；历史消息在其上方弹性扩展，多轮回答自然填充空间并继续支持滚动。
- Taste 检查：单一青绿色强调色；三块功能共享一套组件结构；无额外装饰标签、无新增动画、无人物面部遮挡；大面积空白仅保留为尚未产生的对话历史空间，不再出现在操作区下方。
- 实际页面：三块舞台模块计算高度均为 41px、圆角均为 10.575px（预览缩放尺寸）；内容层底边等于视口底边，常见问题区距底边仅保留面板内边距。
- 视觉证据：`audit-secondary-pages/41-talk-layout-balanced-preview.png`。

## 2026-08-20 云端 Ditto 任意文本真实嘴型验收

- Design Read：保留现有 9:16 适老健康终端、写实小安人物和青绿色可信医疗视觉，仅升级动态回答的音画生成链路。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 3`、`VISUAL_DENSITY: 5`。
- 保留：现有首页、对话、测评和结果流程；五个女性离线音色；默认中文女声 3；离线语音、Viseme 口型和浏览器语音作为失败回退。
- 增强：普通健康回答使用本机 TTS 生成声音，再由云端 Ditto TensorRT 生成同源 MP4；生成期间显示“正在生成真实嘴型”；相同音频使用服务端缓存。
- 删除：真人视频播放时继续隐藏 CSS 嘴部叠层；源码、接口和启动脚本均不保存云主机密码；云端 8788 端口不直接暴露公网。
- 重做：网页开发端和 Electron 桌面端共用 `/v1/render` 渲染服务；加入状态探测、180 秒超时、请求中止、视频 URL 回收、播放失败回退和 SSH 隧道恢复脚本。
- 裁切修复：二级页面动态视频使用顶部居中裁切，修复 `object-fit: cover` 在 667 x 1187 竖屏中只显示胸部、看不到面部与嘴巴的问题；静态人物构图保持不变。
- 实际链路：点击“最近睡眠不太好”后先出现生成状态，约 10.5 秒切换为 `blob:` 动态 MP4；视频时长约 7.9 秒，播放时间持续递增，控制台无 warning 或 error。
- 云端环境：RTX 3080 Ti 12GB，Ditto TensorRT 接口仅监听远端 127.0.0.1，通过 SSH 加密隧道连接；接口健康检查、首次生成、缓存命中与失败降级均通过。
- 自动验收：站点 4 项、Skill 5 项、桌面资源 11 项、测评 15 项、Avatar 2 项全部通过；离线语音、Viseme、打包后 ASR/TTS、生产构建和 Windows 便携包均通过。
- 视觉验收：在 667 x 1187 目标视口实际触发动态回答并截图检查，人物面部、嘴部和肩部完整，状态卡和对话区没有遮挡，播放过程中没有双嘴叠加。

## 2026-08-20 V1.0.2 人物一致性、延迟与控件收口

- Design Read：适老医疗竖屏终端的定向修复，保留现有信息架构和青绿色视觉，只消除人物机位跳变并降低回答首响。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 5`。
- 保留：9:16 竖屏结构、写实小安、青绿色临床视觉、语音优先与触控兜底、对话页主页入口、离线语音与 Viseme 失败回退。
- 增强：等待态与说话态统一使用同一张 Ditto 母版人物和同一套顶部居中机位；音量改为 0 到 100%，默认 80%，支持大触控滑杆、加减按钮和本地记忆，并即时作用于视频、浏览器语音与离线语音；重复回答加入内存和磁盘缓存及并发去重。
- 删除：人物下方重复且无独立交互的“数字健康管理师状态”和“可以直接问小安”模块；已配置状态下的设置按钮；额头隐藏入口的悬停、按下、聚焦与系统点击高亮；等待态与说话态之间的跨人物素材切换。
- 重做：人物素材升级为版本化 `xiaoa-ditto-master-v1.0.2.png`；渲染键统一包含文本、音色、语速和人物标识；网页端、桌面端与云端统一缓存命中、同键在途去重和合成、排队、渲染、总耗时记录。
- Taste 检查：只保留一个主页舞台动作，顶部控制继续使用单一青绿色强调；人物脸部不被控件遮挡；额头热区位于内容与控件层下方，不再截获音量按钮点击；未增加装饰动画。
- 人物一致性验证：静态母版与云端源图 SHA256 完全一致；静态图 941 x 1672、动态视频 940 x 1672；浏览器内二者共享 450 x 302.398 像素容器、`object-fit: cover`、`object-position: 50% 0` 与相同滤镜。
- 延迟验证：首次新短文本 6.530 秒，其中语音合成 1.415 秒、Ditto 4.552 秒；同文本服务端第二次 0.010 秒；真实页面重复点击到开始说话 0.443 秒；两条同文本并发请求约 4.0 秒且只合成、渲染一次。
- 边界：首次未缓存的动态长回答仍需完整语音合成、完整离线 Ditto 推理和 MP4 下载，通常约 4 到 7 秒，不是真正的流式首字即播；不同文本在单卡上仍串行排队。
- 自动验收：控件 3 项、人物连续性 1 项、人物服务 5 项、桌面资源 12 项、测评 15 项、站点 4 项、Skill 5 项、离线语音、Viseme、生产构建均通过。
- 视觉证据：`audit-v1.0.2/01-idle-v1.0.2.png`、`audit-v1.0.2/02-volume-v1.0.2.png`、`audit-v1.0.2/03-speaking-or-complete-v1.0.2.png`。

## 2026-08-20 V1.0.3 音量浮层生命周期复检

- Design Read：面向 60 岁以上用户的竖屏健康数字人大屏定向修复，保留 V1.0.2 的人物机位、适老字号和青绿色视觉，只处理临时控件跨页遮挡。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 5`。
- 保留：写实小安人物、各级页面统一机位、顶部音量入口、0 到 100% 大触控音量控件、语音优先与触控兜底流程。
- 增强：所有页面状态切换都会自动关闭音量面板，覆盖主页入口、返回、测评完成及自动结果跳转，避免临时浮层遮挡人物和二级页面内容。
- 删除：音量面板跨页面持续停留的状态残留。
- 重做：无视觉结构重做；仅将临时面板生命周期绑定到当前页面状态，减少不必要的界面变化风险。
- Taste 检查：保留单一青绿色强调色和统一圆角体系；未增加动画、标签或底部模块；临时控件不跨页，人物脸部、肩部和题目卡片均不被遮挡。
- 自动验收：桌面资源 12 项、测评与计划 15 项、Skill 5 项全部通过，生产构建成功。
- 页面实测：音量面板在首页打开时数量为 1，点击进入测评页后数量为 0；页面显示 `V1.0.3`，第一题和三项大触控答案完整可见。
- 视觉证据：`audit-v1.0.3/01-corrected-portrait-v1.0.3.png`（标准浏览器缩放下按应用真实边界裁切，不包含画布外空白）。

## 2026-08-20 V1.0.4 Skill打包增量

- Design Read：保留V1.0.3的适老竖屏界面和全部交互，只更新软件版本标识并把三套老年健康Skill作为独立资源随便携EXE交付。
- 参数：`DESIGN_VARIANCE: 0`、`MOTION_INTENSITY: 0`、`VISUAL_DENSITY: 0`。
- 保留：现有人物、布局、青绿色视觉、语音与触控交互、八题测评和V2默认运行时。
- 增强：安装包同时包含V1通用健康管理、V2.3多领域弹性问答和V3自适应健康问答三个版本。
- 删除：无。
- 重做：无；界面结构和视觉不变。
- 版本一致性：应用版本、产品名称、页面标题和EXE文件名统一为V1.0.4。
- 打包资源：`health-management-v1`、`health-management-multidomain-v2`和`health-management-adaptive-dialogue-v3`均已进入`release/win-unpacked/resources/skills`；V2内容版本为2.3.0并继续作为默认运行时。
- 自动验收：Skill 6项、测评与运行时15项、桌面资源12项、Sites 4项全部通过；生产构建和Windows便携包成功；打包后ASR与TTS实测通过。
- 交付文件：`release/XiaoAn-Health-Kiosk-1.0.4-x64.exe`，533708503字节，SHA256 `65C9FF20ED661D9C014A6C99DC8D7CC3D4DA61574DF1B1051EC5CF380B807203`。

## 2026-08-20 V1.0.5 症状对话闭环与柔和界面复检

- Design Read：面向60岁以上用户的竖屏健康服务终端，保留写实小安、青绿色健康视觉与现有语音优先流程，重点提高人物完整度、导航可辨识度、语音失败恢复和症状追问连续性。
- 参数：`DESIGN_VARIANCE: 3`、`MOTION_INTENSITY: 1`、`VISUAL_DENSITY: 5`。
- 保留：真人小安母版、顶部品牌与版本号、音量/大字/慢速、连续自动聆听、八题固定测评、三套健康管理Skill及离线ASR/TTS回退。
- 增强：二级页面人物区与内容区统一为46%边界，增加肩部与上身露出；顶部工具使用独立组件和固定粗细图标；“没有听清”改为语音模块下方4.8秒强提示；症状追问显示2到4个适老大按钮并与语音共用状态机。
- 删除：人物下方42%到49%的独立主页按钮带、深色舞台主页卡、顶部控件对旧底栏`.dock-*`样式的继承、慢速的波形图标、视频未解码首帧时立即隐藏静态人物、非健康闲聊默认强推健康测评。
- 重做：主页入口移入顶部导航；音量使用扬声器图标、大字使用`TextAa`、慢速使用`Speedometer`；真人视频以`requestVideoFrameCallback`确认首个有效画面后原子切换，结束或失败立即恢复静态人物；语音失败提示使用`role="alert"`和适老双层文案。
- 症状闭环：输入“我最近有点头痛”首轮直接进入头痛专项且页面不出现“健康测评”；触控“没有这些情况”进入下一题；语音文本与触控选项走同一状态；危险选项立即停止普通追问；闲聊降级不再推荐测评；只有明确请求“做健康测评”才进入固定八题。
- 安全边界：危险提示统一为“请立即停止当前问答并立即就医；不要自行驾车，也不要继续等待测评结果。”；不包含急救、120、人工转接或工作人员措辞；程序继续控制题序、状态与结果等级，模型不直接改分。
- 自动验收：全项目59/59项通过；症状状态机与App接入13/13项通过，其中状态机9/9；桌面主进程与语音服务语法检查通过；生产构建成功。
- 实机验收：浏览器完成头痛首轮、触控推进、危险停止、显式测评与触控无二次确认流程；成品EXE启动22秒保持6个正常应用进程；打包后SenseVoice普通话识别与离线女声合成均通过。
- 视觉证据：`audit-v1.0.5/01-home-v1.0.5-cropped.png`、`audit-v1.0.5/02-headache-first-question-v1.0.5-cropped.png`。
- 版本与资源：应用版本、产品名称、页面标题和EXE文件名统一为V1.0.5；三套Skill与SenseVoice、MeloTTS、四中文女声模型均存在于`release/win-unpacked/resources`。
- 交付文件：`release/XiaoAn-Health-Kiosk-1.0.5-x64.exe`，533715049字节，SHA256 `2C319774AE972096E58130E874C3C7ED9FDC68B1ADF0CDA05587CEAA7B2A187C`。
# 2026-08-29 V1.4.6 流式声音、实时口型与自然表情优化

- Design Read: 面向 60 岁以上用户的 9:16 医疗健康数字人，保持可信、克制、语音优先和完整触控兜底。
- 参数: `DESIGN_VARIANCE=2`、`MOTION_INTENSITY=3`、`VISUAL_DENSITY=4`。
- 保留: 现有竖屏页面结构、人物镜头、身份锁定口型与眨眼素材、单一默认女声、语音与触控等价路径。
- 增强: Sherpa PCM 分块回传、短语预合成、WebAudio 音频时钟、每块 PCM 的 SenseVoice 精确对齐、短语语义表情、标点驱动的低幅点头、随机化眨眼时长、流式取消和 TensorRT 参数化启动。
- 删除: 未达到实时帧率的 Ditto 画面直接覆盖本地口型；连续帧中位间隔超过 160ms 时保持 PCM 口型并取消慢帧流。
- 重做: 原先“整段合成结束后才播放”的链路改为 `worker progress -> Electron event -> renderer queue -> AudioContext`；口型始终以播放音频时钟为准，精确对齐到达后原地接管。
- 工程证据: 113/113 自动化测试通过；Vite 生产构建通过；流式服务探针首块约 2.20s、精确字符时间戳在首块后约 0.78s返回；取消后不再继续发出 PCM 块。
- Ditto 对照: 12步/1280 首帧 5.59s、1.46 FPS；8步/768 首帧 4.67s、1.33 FPS；6步/640 首帧 3.03s、1.34 FPS。选择 6步/640 缩短首帧，但由于持续帧率不够，实时展示仍以 PCM 口型为主。
- Taste 结论: 本轮属于定向演进，不改变信息架构、品牌色、圆角和排版；所有新增动作只表达发声、语义和状态变化，未增加装饰性循环动画。
