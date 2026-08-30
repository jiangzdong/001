# 本地口型对齐与 MFA 标定

V1.4.12 的运行时优先级固定为：

1. `vits-native-phoneme-durations`：当 sherpa-onnx Node 绑定提供音素和时长字段时直接采用。
2. `sensevoice-character-timestamps`：当前默认，以实际生成的 PCM 重新识别并取得字符时间戳。
3. `weighted-pcm-fallback`：只有前两级都不可用时才按文本权重和声学包络生成时间线。

当前随包的 VITS ONNX 图内部含时长预测节点，但 `sherpa-onnx-node` 的 `GeneratedAudio` 尚未导出时长。运行以下命令可复查当前能力，不会修改模型：

```powershell
pnpm audit:vits-durations
```

## MFA 离线标定

MFA 只用于发布前 QA，不进入 Electron 运行时，也不会增加终端启动时间。

首次准备（需要已安装 Miniforge/conda 或 mamba）：

```powershell
pnpm mfa:setup
```

对一条 WAV 与完全一致的 UTF-8 文本做普通话强制对齐：

```powershell
pnpm mfa:align -- -AudioPath qa\mfa\sample.wav -TextPath qa\mfa\sample.txt -OutputPath qa\mfa\sample.json
```

把 MFA phone tier 转成产品的十类口型，并与运行时导出的 `visemes` 时间线比较：

```powershell
pnpm mfa:audit -- --mfa qa\mfa\sample.json --runtime qa\mfa\runtime-timeline.json --out qa\mfa\report.json
```

默认门槛：可匹配口型覆盖率不低于 70%，中位漂移不超过 90 ms，P95 漂移不超过 180 ms。报告失败时应检查文本是否与音频逐字一致、词典 OOV、录音头尾静音，以及 VITS/SenseVoice 分段边界；不要直接放宽门槛。

参考：MFA 官方建议通过 conda-forge 安装；普通话模型名为 `mandarin_mfa`，中国大陆普通话词典名为 `mandarin_china_mfa`。MFA 3.4 已提示旧版 `align_one` 签名将在 4.0 调整，因此包装脚本集中维护命令入口，避免业务代码绑定 CLI 细节。
