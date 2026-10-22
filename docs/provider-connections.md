# Provider accounts

The Connections settings include server-managed provider accounts alongside the existing direct-connection controls. Personal accounts are saved by the backend and remain available when browser direct connections are disabled.

## Add an account

Choose **Settings → Connections → Add provider**, select a provider, enter its API key or choose ChatGPT sign-in, then verify the endpoint and select the models to expose. API keys are write-only: the UI never reads them back. For a provider that cannot verify its credentials or list models, choose **Enter model IDs manually** and provide upstream IDs; the account is labeled as unverified.

OpenAI, DeepSeek and Bailian use their presets, with region and workspace options for Bailian. Custom providers can set a base URL and choose Chat Completions or the Responses API.

## Private and shared accounts

Personal provider accounts are private to their owner. An administrator can create a private account for their own use or choose **Share with selected people** and grant access to existing users or groups. ChatGPT subscription sign-in is always private. People who can see a shared account can use its models, while its key remains hidden.

## First ChatGPT sign-in

The first sign-in needs a computer with Python 3 and a browser. Copy the command shown in the UI into that computer's terminal and enter the one-time pairing code when the local helper asks for it. The helper opens the official OpenAI sign-in page and sends the resulting credentials directly to the configured backend. Return to Open WebUI when the account shows as connected. To reconnect later, use **Reconnect** on the ChatGPT account. Removing it clears the local credential and reports whether remote revocation was confirmed.

## Existing connections

The legacy OpenAI and Ollama settings and browser direct connections remain available. Existing entries and saved chats need no migration. Direct connections continue to follow their existing feature setting.

For the backend API contract, provider adapters, credential storage and security behavior, see the [backend provider connections guide](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md).

## 中文说明

在 **设置 → 连接 → 添加提供商** 中选择提供商，输入 API 密钥或选择 ChatGPT 登录，然后验证连接并选择要开放的模型。API 密钥仅写入服务器，界面不会读取或显示密钥。若无法验证凭据或读取模型，可手动输入上游模型 ID；未验证的账户会明确标记。

个人提供商账户由服务器管理，仅账户所有者可见，并且不受浏览器直连开关影响。管理员可以为自己创建私有账户，也可以选择与指定用户或群组共享。共享账户可供获授权者使用，但密钥保持隐藏。ChatGPT 订阅登录始终为私有账户。

首次 ChatGPT 登录需要安装 Python 3 的电脑和浏览器。在界面复制命令，在该电脑终端中运行，并在本地辅助程序提示时输入一次性配对码。辅助程序会打开 OpenAI 官方登录页，并将凭据直接发送到配置的服务器。账户显示已连接后即可返回使用；之后可以通过 **重新连接** 更新登录。移除账户时，界面会说明远程令牌撤销是否得到确认。

原有 OpenAI、Ollama 和浏览器直连设置继续可用，已保存的连接和聊天无需迁移。更多 API 契约、适配器和凭据安全说明见[后端提供商连接指南](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md)。
