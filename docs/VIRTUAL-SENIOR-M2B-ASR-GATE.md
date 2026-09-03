# 虚拟长者 M2b 固定 WAV ASR 门禁

M2b 使用版本化的纯合成 WAV 真实运行本机 SenseVoice，再把识别文本送入 M0/M1 的同一 Harness、Fixture MCP 和固定 hard oracle。它不修改界面、语音交互实现或 V34 口型。

## 固定输入合同

- Manifest：`tests/fixtures/virtual-senior-asr/manifest.v1.json`
- 音频：PCM16、mono、16 kHz、RIFF/WAVE；当前样例由项目自带 VITS `zh-ll-2` 合成，不含真人语音或生产数据。
- 请求、manifest 和 case 都固定为 `dataClassification: "synthetic-test-only"`；persona/scenario 使用当前 allowlist，未知字段与越权枚举关闭失败。
- WAV 在识别前验证 SHA-256、格式、声道、采样率、位深和最小时长；路径必须位于 manifest 目录内。
- 文本按 NFKC、忽略空白和标点计算字符错误率（CER），与 `expectedText` 或显式 `allowedTranscripts` 中的最佳匹配比较。

## 硬门禁

- 真实门禁只接受 `sherpa-onnx-sensevoice-local` 且 `trustedFinal=true`；未知或远程 provider 关闭失败。
- 单元测试可使用 `asrMode: "stub"`，但报告固定为 `NON_GATING`，顶层结果不能是 PASS。
- renderer IPC 不能直接伪造 `fixed-wav-asr`；只有音频门禁验证 WAV 和 provider 后才能调用 orchestrator 的内部 `runAsrCase`。
- ASR 通过后仍须满足固定场景的路由、Tool、Policy、Fixture 来源和回答断言；识别模型无权更改 oracle。

## 报告

`npm run test:virtual-senior-asr`（或用现有 Node 直接运行 `scripts/run-virtual-senior-asr-gate.cjs`）保存 WAV hash、provider、识别耗时、文本、CER、Harness 状态、Tool trace 和结果。批次分析包含 ASR pass rate、P50/P95/max、按场景/画像/音频条件分组、错误码、失败聚类和跨批次趋势。

M2b 当前只覆盖一条干净合成助餐查询。噪声、远场、不同语速、多画像、多场景、Windows 打包运行、真实麦克风、TTS/Viseme/V34 均仍是后续门禁。
