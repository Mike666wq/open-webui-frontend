# Provider accounts

The Connections settings include server-managed provider accounts alongside the existing direct-connection controls. Personal accounts are saved by the backend and remain available when browser direct connections are disabled.

## Add an account

Choose **Settings → Connections → Add provider**, select a provider, enter its API key or choose ChatGPT sign-in, then verify the endpoint and select the models to expose. API keys are write-only: the UI never reads them back. For a provider that cannot verify its credentials or list models, choose **Enter model IDs manually** and provide upstream IDs; the account is labeled as unverified.

OpenAI, DeepSeek and Bailian use their presets, with region and workspace options for Bailian. Custom providers can set a base URL and choose Chat Completions or the Responses API.

## Private and shared accounts

Personal provider accounts are private to their owner. An administrator can create a private account for their own use or choose **Share with selected people** and grant access to existing users or groups. ChatGPT and Kimi Code subscription sign-in are always private. People who can see a shared account can use its models, while its key remains hidden.

## First ChatGPT sign-in

The first sign-in needs a computer with Python 3 and a browser. Copy the command shown in the UI into that computer's terminal and enter the one-time pairing code when the local helper asks for it. The helper opens the official OpenAI sign-in page and sends the resulting credentials directly to the configured backend. Return to Open WebUI when the account shows as connected. To reconnect later, use **Reconnect** on the ChatGPT account. Removing it clears the local credential and reports whether remote revocation was confirmed.

## Existing connections

The legacy OpenAI and Ollama settings and browser direct connections remain available. Existing entries and saved chats need no migration. Direct connections continue to follow their existing feature setting.

For the backend API contract, provider adapters, credential storage and security behavior, see the [backend provider connections guide](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md).

## 中文说明

在 **设置 → 连接 → 添加提供商** 中选择提供商，输入 API 密钥或选择 ChatGPT 登录，然后验证连接并选择要开放的模型。API 密钥仅写入服务器，界面不会读取或显示密钥。若无法验证凭据或读取模型，可手动输入上游模型 ID；未验证的账户会明确标记。

个人提供商账户由服务器管理，仅账户所有者可见，并且不受浏览器直连开关影响。管理员可以为自己创建私有账户，也可以选择与指定用户或群组共享。共享账户可供获授权者使用，但密钥保持隐藏。ChatGPT 和 Kimi Code 订阅登录始终为私有账户。

首次 ChatGPT 登录需要安装 Python 3 的电脑和浏览器。在界面复制命令，在该电脑终端中运行，并在本地辅助程序提示时输入一次性配对码。辅助程序会打开 OpenAI 官方登录页，并将凭据直接发送到配置的服务器。账户显示已连接后即可返回使用；之后可以通过 **重新连接** 更新登录。移除账户时，界面会说明远程令牌撤销是否得到确认。

原有 OpenAI、Ollama 和浏览器直连设置继续可用，已保存的连接和聊天无需迁移。更多 API 契约、适配器和凭据安全说明见[后端提供商连接指南](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md)。

## Kimi Code and media

Choose **Kimi Code** to start device authorization. Open the official verification
page on any device, confirm the displayed code, and return to Open WebUI. Cancel,
expiry and denied authorization are shown in the wizard. Tokens stay on the
backend. This is an experimental compatibility integration for personal
interactive coding; third-party access depends on Kimi granting this client
access. The backend identifies itself as Open WebUI. Disconnect clears local
tokens; remote revocation is not claimed.

Account sign-in does not include image generation, speech synthesis or
transcription APIs. Add a separate API-key connection, then choose **Saved
provider connection** in the administrator's Images or Audio settings. Select the
connection and enter the provider's media model ID (and voice for TTS). Every
request checks connection permissions; share the key connection explicitly if
other users should use it. Realtime calls still use their dedicated API-key
settings. These controls appear only after the updated backend advertises media
connection support.

在 **设置 → 连接** 选择 **Kimi Code**，开始设备授权。在任意设备打开官方验证页并确认验证码，然后返回等待连接完成。后端保存令牌，界面支持取消、过期和拒绝状态。这是供个人交互式编程使用的实验性兼容接入，实际权限由 Kimi 决定。断开连接会清除本地凭据，暂不声明远程撤销成功。

ChatGPT/Kimi 套餐授权不包含生图、语音合成或音频转写 API。如需使用这些功能，请先添加独立 API 密钥连接，再在 **管理面板 → 图片/音频** 中选择 **已保存的厂商连接**，填写模型 ID 和音色。其他用户使用时仍需获得连接共享授权。Realtime 通话继续使用原有独立 API 密钥配置。媒体连接入口会在后端更新后显示。
