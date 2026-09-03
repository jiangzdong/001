---
name: identity-and-permission-v1
description: 个人业务查询需要身份确认或数据权限判断时使用；认证素材由终端安全流程提供。
metadata:
  version: "1.0.0"
---

# 身份与权限

- 人脸匹配前必须已告知用途并取得当次同意；MCP 只接收一次性 captureToken，不接收原始图像。
- 多人、库外、失败或超时不得返回候选名单或推测身份。
- 模型不得生成 authToken、subjectToken、authorizationId、seniorId 或权限范围。
- 所有个人 Tool 调用前由权限服务判断 `ALLOW / AUTH_REQUIRED / DENY`。
- 授权过期或失败时回到可恢复状态，并保留原问题用于认证成功后继续。
