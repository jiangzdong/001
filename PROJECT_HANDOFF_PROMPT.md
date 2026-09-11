# Newcode / 小安站点咨询顾问 Codex 接力提示词

> 将下面“接力提示词”一节完整粘贴给另一台机器上的 Codex。不要把本机密钥、令牌、用户数据或运行时目录一并粘贴或提交。

## 接力提示词

你现在接手 **Newcode / 小安站点咨询顾问**，不要把本项目与 Astra、Apple Silicon / MLX 实验或其它 SHU 项目合并。

### 1. 项目身份与事实源

- GitHub 远程：`https://github.com/jiangzdong/001.git`
- 工作分支：`feat/station-advisor-local-demo`
- 实际 Git 仓库目录：`health-kiosk-demo`
- 项目状态唯一事实源：`DigitalHuman2D-Handoff-20260901/PROJECT_STATUS.md`
- 在原机器上的绝对路径：`/Users/luc/Desktop/SHU/DigitalHuman2D-Handoff-20260901/PROJECT_STATUS.md`
- 从原仓库目录到状态文件的相对路径：`../../../../PROJECT_STATUS.md`

`PROJECT_STATUS.md` 不在当前 Git 仓库的提交范围内。换机时必须从项目接力包或受信任备份单独恢复到对应位置；找不到它时停止更新项目完成率，不得新建第二套状态文件或根据 README、聊天记录和预计结果猜测进度。每次状态变化后同步更新新机器上的 `~/.codex/PROJECT_STATUS_INDEX.md` 摘要行。

### 2. 先从远端恢复，不复用旧目录

确保目标机已安装 Git 与 Git LFS，然后执行：

```bash
git clone --branch feat/station-advisor-local-demo --single-branch https://github.com/jiangzdong/001.git health-kiosk-demo
cd health-kiosk-demo
git lfs install --local
git lfs pull
git lfs checkout
git lfs fsck
```

必须先完成全新克隆和 LFS 检出，再复制任何本机专属配置。不要用旧目录覆盖新克隆，也不要跳过 `git lfs install --local`；只看到 LFS 指针文件不算恢复成功。

### 3. 恢复后的强制核对

```bash
git status --short --branch
git rev-parse HEAD
git ls-remote --heads origin feat/station-advisor-local-demo
git lfs ls-files | wc -l
git lfs fsck
shasum -a 256 prompt-engineering/station-digital-human-test.zip
shasum -a 256 prompt-engineering/station-digital-human-test-v1.0/station-digital-human-test/SKILL.md
unzip -p prompt-engineering/station-digital-human-test.zip station-digital-human-test/SKILL.md | shasum -a 256
unzip -t prompt-engineering/station-digital-human-test.zip
```

验收条件：

- 本地 `HEAD` 必须与远端工作分支 ref 完全一致；以 `git ls-remote` 的当前结果为准，不把旧聊天里的哈希当作最新远端状态。
- 工作树必须干净。
- 当前树应列出 **341 个** Git LFS 文件；`git lfs fsck` 必须通过，模型、图片、音视频必须是实体文件而不是 100 多字节的 LFS 指针。
- `station-digital-human-test.zip` 预期 SHA-256 为 `44ff01767a9259a5aece8a57ba6b6ce1894ac2a0bddd18268ee1ceff2695eef4`。
- 展开的 V1.0.9 `SKILL.md` 及 ZIP 内同名文件预期 SHA-256 均为 `63c0df35469d88158d8c370c894faf1195b883259c7559476195d1ec877b2b84`；两者必须一致，ZIP CRC 必须通过。

任何哈希、LFS 数量、远端 ref 或工作树状态不一致时，先记录证据并停止，不要自动覆盖本地、强制推送或改写历史。

### 4. 已通过项，不要无变化重做

- 站点数字人测试 Skill 已更新为 **V1.0.9**，展开源文件与发布 ZIP 已通过一致性和敏感模式检查。
- 与产品身份权限边界直接相关的 `tests/skills.test.mjs`、`tests/harness-runtime.test.mjs`、`tests/station-advisor.test.mjs` 已合计 **51/51 PASS**。
- 当前 341 个 LFS 文件已完成远端恢复验证；如果提交、LFS 指针、环境和验收条件均未变化，不要为形式重复下载或重跑。

只有输入、代码、依赖、LFS 指针或验收条件变化，或者出现失败证据时，才重跑相应的最小测试；扩大测试范围必须有明确原因。

### 5. 身份与权限边界

- V1.0.9 测试 Skill 中允许手工输入 `seniorId` 和 `orgId`，只属于当前测试 Skill 的身份参数规则。
- 这不代表生产个人数据访问已获授权，也不改变 Newcode 产品运行时合同。
- 产品 Harness 继续要求 `verified-self`、有效 scope，并由运行时生成 `authorizationId`；不得由模型、用户文本或测试 Skill 伪造、补全或绕过。
- 不得把测试身份参数、Fixture 成功、合成数据或平台上传状态描述成生产授权或真实个人数据链路已验收。

### 6. 产品基线边界

- VITS 继续作为低延迟默认回答语音。
- Qwen3-TTS 仅是管理员显式选择的高质量可选项，不替换 VITS。
- SenseVoice 保留在语音识别与验收链路。
- 不得把其它 Apple Silicon / MLX 项目中的 Qwen、模型权重、实验结论或完成率写入 Newcode 默认产品基线。

### 7. 禁止提交或上传的内容

不得提交真实 API Key、GitHub Token、密码、私钥、`.env.local`、用户身份凭证、`deepseek.credential`、`mcp.credential` 或任何生产/个人健康数据。

以下本地依赖、构建物、运行资产和大规模 QA 数据继续按忽略规则或独立资源渠道管理，不得用 `git add -f` 强行加入：

- `node_modules/`、`dist/`、`release/`、`qa/`、日志和临时文件；
- `QA-EXTERNAL/virtual-senior-community/`；
- `ditto-validation/downloads/`、TensorRT/虚拟环境、checkpoint、输出和运行缓存；
- 外置 Qwen3-TTS 资源包、机器专属模型缓存和用户配置。

依赖应从锁文件重建；未进入 Git 的必要运行资产必须先通过受信任存储、资源清单和哈希单独恢复。绝不把凭证发到聊天或写入接力文档。

### 8. 恢复后继续工作的顺序

1. 读取完整的 `AGENTS.md` 和唯一 `PROJECT_STATUS.md`，确认项目边界、当前阶段、阻塞与剩余门禁。
2. 核对远端 HEAD、干净工作树、341 个 LFS 文件及 Skill/ZIP 哈希。
3. 按锁文件重建依赖；先检查现有缓存和隔离运行时，避免重复下载与破坏已验证环境。
4. 只对发生变化的范围运行聚焦检查；不得重做输入未变化的 Skill V1.0.9 与 51 项权限测试。
5. 按 `PROJECT_STATUS.md` 的未完成门禁推进，继续严格区分源码、测试包、真实 GUI、实际播放、长稳、目标设备、生产 MCP 与用户验收证据。
6. 每个阶段只根据真实命令、测试、哈希、日志、截图或设备证据更新状态；未验证事项标记为未验证、未完成、受阻或条件通过。
7. 后续提交前再次扫描敏感信息、运行适用测试并检查 LFS；只使用普通 fast-forward push，不 force push、不改写历史、不覆盖用户修改。

完成恢复并通过上述核对后，先汇报：本地/远端 HEAD、LFS 文件数与 fsck、两个 Skill 哈希、ZIP CRC、工作树状态、唯一状态源是否已恢复，以及仍未完成的产品门禁；然后再开始开发。
