# 当前验收清单

核对日期：2026-10-27（对应规划件 P-001 r2）。共同进度见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。
勾选只代表**该项的证据已经存在**；自动检查通过**不等于**人工验收完成。

# 当前验收清单

核对日期：2026-10-28（对应规划件 P-001 r2 与 P-002）。共同进度见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。
勾选只代表**该项的证据已经存在**；自动检查通过**不等于**人工验收完成。

## P-002 供应商按服务接入（2026-10-28，规划件 P-002）

以下勾选的证据来自本地 vitest 预检（28 文件 / 126 项全部通过）；`npm run build`、手机浏览器冒烟与 GitHub Actions 尚在收尾，见「尚未完成」。

### 已验证的自动交付

- [x] 按用途过滤的模型选择器：`providerModelsForPurpose` 只保留声明了该用途的模型，未知媒体模型不落进聊天列表；`getProviderModels(purpose)` 请求带 `purpose=` 参数。
      证据：`src/lib/utils/provider-models.test.ts`、`src/lib/components/common/ProviderModelSelect.test.ts`。
- [x] 验证状态三态（untested/passed/failed）与跨用途回落显示；空状态提供进入服务商设置的按钮（`data-testid="provider-model-select-settings"`）。
      证据：`src/lib/components/common/ProviderModelSelect.test.ts`。
- [x] 服务声明前端消费：`serviceOperations` / `serviceSupportsOperation` 按 `operations` 元数据判定；generate-only 的服务拒绝 edit，无 `operations` 的服务视为单一用途（操作名即用途名）。
      证据：`src/lib/utils/provider-services.test.ts`。
- [x] 图片设置中的编辑预警：所选连接不支持编辑时显示警告（`data-testid="image-edit-unsupported-operation"`），最终拒绝由后端出站前执行。
      证据：`src/lib/components/admin/Settings/Images.svelte` 及其源码断言。
- [x] 分用途配置 UI：添加向导按「选择服务 → 凭据 → 获取列表 / 官方预设 / 手工填写」推进，MiniMax 媒体服务无需远程列表即可保存；ProviderServiceSettings / ProviderModelTestDialog 支持音频样本上传、音色选择与受支持尺寸。
      证据：`src/lib/components/providers/provider-services.test.ts`、`provider-model-test.test.ts`、`provider-i18n.test.ts`。
- [x] 新增 i18n 键在 zh-CN 与 en-US 中都存在（两仓 locale 各新增 45 条；`provider-i18n.test.ts` 守卫）。

### 尚未完成的验收（P-002）

- [ ] `npm run build` 与 `npm run test:mobile:browser` 的本轮结果；svelte-check 与改前基线的错误数对比（进行中）。
- [ ] 本分支 GitHub Actions 全绿、PR 开启与合并；正式发布与前端锁不在本轮。
- [ ] 浏览器人工验收：服务选择、无列表保存、音色 / 文件测试对话框在 390×844、489×550、1280×800 及浅深主题下键盘可完成。
- [ ] 真实 MiniMax 账号下的 ASR / TTS / 文生图验收；需要账号所有者触发。
- [ ] Android 真机。

## 已验证的自动交付（P-001 r2）

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

## 尚未完成的验收（P-001 r2）

- [ ] 真实浏览器里的人工交互验收：模型选择器 → 「查看连接」→ 连接详情的恢复按钮 → 重新登录 / 更换 Key 的完整链路。
- [ ] 管理员与普通用户的权限差异人工核对：普通用户不应看到部署变量与他人连接。
- [ ] 真实厂商凭据下的重新获取模型列表与一次真实推理；需要账号所有者。
- [ ] Android 真机上的模型选择器与连接详情；本轮未做真机验证。

## 不作为验收依据的东西

- 冒烟脚本使用合成夹具与假数据，**不**连接真实厂商。
- 界面上的「建议操作」只是**建议**：能不能恢复取决于凭据、账号权限与部署网络，界面不代替真实调用结果。
