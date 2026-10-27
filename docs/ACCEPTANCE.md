# 当前验收清单

核对日期：2026-10-27（对应规划件 P-001 r2）。共同进度见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。
勾选只代表**该项的证据已经存在**；自动检查通过**不等于**人工验收完成。

## 已验证的自动交付

- [x] 模型选择器按连接显示短原因，并提供可达的「查看连接」；长 DNS / 部署说明不再堆在模型列表上方。
      证据：`src/lib/components/chat/ModelSelector/Selector.test.ts`、`scripts/mobile-browser-smoke.mjs`。
- [x] 旧错误对象（只有 `category`）仍能显示；新字段缺失时按 category 回退出原因、动作与摘要。
      证据：`src/lib/utils/provider-errors.test.ts`。
- [x] 建议动作与认证方式匹配：OAuth 连接不会被要求「更换 API Key」，API Key 连接不会被要求「重新登录」；403 给「检查权限」。
      证据：`src/lib/components/providers/provider-reconnect.test.ts`。
- [x] 失败响应保留后端分类，而不是只剩一句话；重新登录沿用原连接 ID，不新建连接。
      证据：`src/lib/components/providers/provider-reconnect.test.ts`。
- [x] 手机浏览器冒烟覆盖 390×844、489×550 与桌面、浅色与深色主题下的告警：告警不挤掉搜索框与模型操作，多连接失败各自可点，键盘可完成「查看连接」。
      证据：`scripts/mobile-browser-smoke.mjs` 的 `catalogWarning` 场景与 `scripts/fixtures/mobile-layout-api-server.mjs` 的失败连接夹具。
- [x] 新增 i18n 键在 zh-CN 与 en-US 中都存在（`provider-i18n.test.ts` 守卫）。

## 尚未完成的验收

- [ ] 真实浏览器里的人工交互验收：模型选择器 → 「查看连接」→ 连接详情的恢复按钮 → 重新登录 / 更换 Key 的完整链路。
- [ ] 管理员与普通用户的权限差异人工核对：普通用户不应看到部署变量与他人连接。
- [ ] 真实厂商凭据下的重新获取模型列表与一次真实推理；需要账号所有者。
- [ ] Android 真机上的模型选择器与连接详情；本轮未做真机验证。

## 不作为验收依据的东西

- 冒烟脚本使用合成夹具与假数据，**不**连接真实厂商。
- 界面上的「建议操作」只是**建议**：能不能恢复取决于凭据、账号权限与部署网络，界面不代替真实调用结果。
