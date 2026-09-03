# 虚拟长者 M2a 变体制品合同

M2a 只扩展无界面测试基础，不修改产品 UI、口型或 V34 几何。固定场景仍是唯一硬 oracle；LLM 只生成合成测试话语，不能输出 Tool、权限、预期结果或 PASS 判定。

## 生成边界

- 仅在应用以 `--virtual-senior-test` 启动后可用。
- 调用 `virtual-senior:generate-variant` 时必须显式传入 `testMode: "generated-artifact"`。
- 请求、候选和最终制品都必须显式包含固定值 `dataClassification: "synthetic-test-only"`，候选还必须包含 `synthetic: true`；缺失或伪造值均关闭失败。
- persona 和 scenario 只能使用 `virtual-senior-catalog.cjs` 的当前 ID allowlist。
- LLM 返回值使用顶层及嵌套层均为 `additionalProperties: false` 的 Schema；未知字段、未知枚举、直接 PII 或密钥形态内容统一拒绝为 `GENERATION_SCHEMA_REJECTED`。
- 生成请求固定记录 `prompt`、`promptVersion`、`promptHash`、`provider`、`model`、`schemaHash`、`seed`、`temperature` 和 `top_p`；DeepSeek adapter 会强制元数据中的 provider 为 `deepseek`，API 密钥不进入请求制品或报告。

## 不可变存储与重放

- 制品按规范化内容的 SHA-256 命名，以 owner-only、只读文件写入 `userData/virtual-senior-artifacts/artifacts`。
- 同一生成请求先查不可变 request 索引；命中后直接返回原 artifact，不再次请求模型。
- 每次读取都会验证 artifact、candidate、prompt、schema 和 request 哈希；篡改后关闭失败。
- 运行变体时必须使用 `testMode: "generated-artifact"` 和 `artifactHash`。编排器只读取其中的 persona、scenario 和 turns，硬断言及 Tool allowlist仍来自版本化固定 manifest。

## 报告与限制

单项报告保留完整生成元数据；批次分析按模型、prompt hash、schema hash 和 seed 聚合，并继续使用既有 pass-rate 趋势。M2a 未执行真实模型调用、固定 WAV ASR、真实 TTS/Viseme/V34 或 Windows 2400×3840 验收，因此不能作为发布硬 PASS。
