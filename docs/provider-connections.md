# Provider accounts

The Connections settings include server-managed provider accounts alongside the existing direct-connection controls. Personal accounts are saved by the backend and remain available when browser direct connections are disabled.

## Add an account

Choose **Settings → Connections → Add provider**, select a provider, enter its API key or choose ChatGPT sign-in, then verify the endpoint and select the models to expose. API keys are write-only: the UI never reads them back. For a provider that cannot verify its credentials or list models, choose **Enter model IDs manually** and provide upstream IDs; the account is labeled as unverified.

OpenAI, DeepSeek and Bailian use their presets, with region and workspace options for Bailian. Custom providers can set a base URL and choose Chat Completions or the Responses API.

## Private and shared accounts

Personal provider accounts are private to their owner. An administrator can create a private account for their own use or choose **Share with selected people** and grant access to existing users or groups. ChatGPT and Kimi Code subscription sign-in are always private. People who can see a shared account can use its models, while its key remains hidden.

## First ChatGPT sign-in

Select ChatGPT, start sign-in, and click **Open ChatGPT sign-in page**. After authorizing in the official page, copy the **entire callback URL** from the browser address bar and paste it into **Complete callback URL**, then select **Complete sign-in**. The callback targets `http://127.0.0.1:1455/auth/callback`; with a remote backend it is expected that this page may not load. The address still contains the one-time result. No Python, terminal, or downloaded helper is needed. Keep this URL private. Attempts expire after ten minutes and can be cancelled. Reconnect reuses the saved registration and verifies the same account. This follows Pi's browser/manual-callback interaction; it is not Codex device-code authentication.

## Existing connections

The legacy OpenAI and Ollama settings and browser direct connections remain available. Existing entries and saved chats need no migration. Direct connections continue to follow their existing feature setting.

For the backend API contract, provider adapters, credential storage and security behavior, see the [backend provider connections guide](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md).

## 中文说明

在 **设置 → 连接 → 添加提供商** 中选择提供商，输入 API 密钥或选择 ChatGPT 登录，然后验证连接并选择要开放的模型。API 密钥仅写入服务器，界面不会读取或显示密钥。若无法验证凭据或读取模型，可手动输入上游模型 ID；未验证的账户会明确标记。

个人提供商账户由服务器管理，仅账户所有者可见，并且不受浏览器直连开关影响。管理员可以为自己创建私有账户，也可以选择与指定用户或群组共享。共享账户可供获授权者使用，但密钥保持隐藏。ChatGPT 和 Kimi Code 订阅登录始终为私有账户。

选择 ChatGPT 并开始登录，点击 **打开 ChatGPT 登录页**。在官方页面完成授权后，从地址栏复制**完整回调地址**，粘贴到 WebUI 的输入框并点击 **完成登录**。回调目标是 `http://127.0.0.1:1455/auth/callback`，远程部署时该页面可能无法打开，地址栏仍保留一次性授权结果；这是正常现象。无需 Python、终端或下载辅助脚本。不要向他人发送回调地址。登录尝试十分钟后失效，可随时取消。重新连接会沿用原注册信息并校验同一账号。这采用 Pi 的网页授权/手动回调交互，不是 Codex 设备码认证。

原有 OpenAI、Ollama 和浏览器直连设置继续可用，已保存的连接和聊天无需迁移。更多 API 契约、适配器和凭据安全说明见[后端提供商连接指南](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/provider-connections.md)。

## When a connection fails

A failure is shown with its **stage** and its **reason**, not as a generic error:

| What you see                                       | Stage                  | Reason                             | Action offered                |
| -------------------------------------------------- | ---------------------- | ---------------------------------- | ----------------------------- |
| a domain resolves into `198.18.x.x` and is blocked | fetching models        | `address_blocked`                  | check the server network      |
| the sign-in expired                                | refreshing the sign-in | `token_expired`                    | sign in again                 |
| the account lacks a permission                     | fetching models        | `insufficient_permissions`         | check the account permissions |
| the key was rejected                               | fetching models        | `invalid_credentials`              | replace the API key           |
| the provider throttles or the quota is gone        | calling the model      | `rate_limited` / `quota_exhausted` | try again later               |

What to keep in mind:

- **A failed model list does not mean inference is broken.** A provider can refuse the model list and still answer requests. Real requests keep their own credential check.
- **A 403 is not a wrong key.** It means the account lacks a permission; replacing the key does not help.
- Signing in again **reuses the same connection**; it never creates a second one, and cancelling keeps the saved credentials.
- Replacing a key **does not** clear the whitelist, the names, the purposes, the enabled switches or the model references in your chats.

In the chat model selector, a failing connection shows a short reason and a **View connection** action that opens that connection. The long explanation and the deployment notes stay in the connection details; administrators see the DNS and proxy notes, other users see only what applies to them.

The network side (fake-ip, reserved ranges) is documented in the [recovery runbook](https://github.com/Mike666wq/open-webui-backend/blob/main/docs/PROVIDER_RECOVERY.md).

## Per-service access (P-002)

Each connection configures four purposes independently: **chat, transcription,
speech synthesis and image generation**. The add-provider dialog shows which
services a template really supports, which auth methods each service accepts,
and how its models are discovered (remote list, official preset or manual
entry). A subscription sign-in (ChatGPT, Kimi Code) never gains media services
by signing in.

Address fields support two modes: a `base_url` is the API root including the
version prefix and the adapter appends its registered relative path exactly
once; an `endpoint_url` is used verbatim once. The dialog names the two modes
and previews the final URL, so pasting a full operation URL into the API-root
field cannot silently produce a doubled suffix.

MiniMax uses its native media endpoints with the default root
`https://api.minimax.cn/v1`; it can be added and saved without fetching a
remote model list first. Transcription requires `model=asr-1.0` even though the
model is preset (a defaulted model is still sent, never omitted). Speech
synthesis decodes the hex audio of `POST /v1/t2a_v2` and lists voices through
`POST /v1/get_voice`; a zero HTTP status with a non-zero `base_resp.status_code`
is an error, not a success. Image generation is text-to-image only: the edit
entry is hidden when the connection's service declaration reports no `edit`
operation, and the backend re-checks the effective adapter before every edit
request. Model tests may upload an audio sample, pick a voice or set an image
size; the dialog shows the actual service, model and possible charge before the
test runs.

## Unified models and media

Chat, transcription, speech synthesis and image generation use the same server
model catalog. Save a provider API key once under **Admin settings →
Connections**, discover its models and classify each model by purpose. The
administrator's **Audio** and **Images** pages then select models from that
catalog; they do not ask for the key or base URL again. The chat model picker
only shows models with a chat use.

A provider flow has four distinct states: the connection is reachable, models
were discovered, a capability was declared or manually classified, and a real
inference test passed. Discovery and saving do not run paid inference. The
separate **Test model** action sends one explicitly confirmed request and never
retries automatically. Changing the endpoint, credential, model or purpose
invalidates the previous test result.

For SiliconFlow, use the native preset or enter
`https://api.siliconflow.cn/v1`. Its model adapter reads native chat,
transcription and image categories. Transcription sends only the model and file
because the public endpoint does not expose language, response-format,
timestamp or speaker controls. Speech voices use the public
`model:voice` format and include Alex, Benjamin, Charles, David, Anna, Bella,
Claire and Diana. Image generation sends `image_size` and reads the native
`images` response.

Recording uploads preselect the administrator's default transcription model and
allow a per-job choice. The job stores the stable connection-and-model reference
when submitted, so changing the global default while it is queued does not
silently switch providers. Retrying keeps that model unless the user explicitly
restarts the complete transcript with another model. Every operation checks
current connection and model permissions again on the backend.

Legacy OpenAI media settings remain visible as **Legacy configuration** until an
administrator previews and explicitly confirms migration. Confirmed migration
creates a private connection and is idempotent; defaults are not silently shared
with other users. Inaccessible defaults are reported instead of falling back to
another paid channel.

ChatGPT and Kimi account sign-in remain chat-only for the capabilities their
official protocols expose. They do not grant image, transcription, speech or
Realtime API access. Use a separate API-key connection for those media features.

## 按服务接入（P-002）

每个连接的**聊天 / 语音转写 / 语音合成 / 生图**四个用途分开配置。添加提供商时
会显示模板真正支持哪些服务、每种服务接受哪些鉴权方式、模型如何发现（远程列表 /
官方预设 / 手工录入）。ChatGPT、Kimi Code 这类订阅登录不会因为登录就获得媒体
服务权限。

地址字段分两种模式：`base_url` 是含版本前缀的 API 根，适配器只追加自己登记的
相对路径一次；`endpoint_url` 是完整请求地址，原样使用一次。界面会说明两种模式
并预览最终 URL，把完整操作地址误填进 API 根也不会悄悄产生重复后缀。

MiniMax 的媒体能力走厂商原生接口，默认根地址 `https://api.minimax.cn/v1`，
无需先拉取远程模型列表即可添加并保存。转写即使模型是预设的也必须发送
`model=asr-1.0`（有默认值不等于不发 model）；合成解码 `POST /v1/t2a_v2` 返回的
hex 音频，音色经 `POST /v1/get_voice` 查询；HTTP 200 但 `base_resp.status_code`
非零按业务失败处理，不算成功。生图本期只有文生图：连接的服务声明没有 `edit`
操作时，界面隐藏编辑入口，后端在每次编辑请求出站前还会按实际适配器再判定一次。
模型测试可以上传音频样本、选择音色或设置图片尺寸，点击测试前会展示实际服务、
模型与可能产生的费用。

## 统一模型与媒体

聊天、录音转写、语音合成和生图现在共用同一个服务端模型目录。只需在
**管理面板 → 连接** 保存一次厂商 API Key，获取模型并按用途分类；之后在
**语音** 和 **图片** 设置中直接选择模型，不再重复填写 Key 或 Base URL。
聊天选择器只显示带聊天用途的模型。

需要区分“连接可用”“模型已发现”“能力已声明或手动分类”和“真实推理测试通过”
四种状态。获取模型和保存配置不会发起付费推理；只有管理员明确点击“测试模型”
才会发送一次请求，失败不会自动重试。连接地址、凭据、模型或用途改变后，旧测试
结果会失效。

硅基流动可直接选择预设，或填写 `https://api.siliconflow.cn/v1`。其适配器读取
原生聊天、转写和生图分类。转写接口只发送模型与文件，因为官方公开接口没有可供
依赖的语言、响应格式、时间戳或说话人参数。语音音色使用
`模型名:音色` 格式，提供 Alex、Benjamin、Charles、David、Anna、Bella、
Claire、Diana 八种预置音色；生图使用 `image_size` 并读取原生 `images` 响应。

录音页会预选管理员设置的默认转写模型，也允许本次任务切换模型。上传时任务固定
保存“连接 + 模型”的稳定引用，排队期间修改全局默认值不会悄悄换模型。重试沿用
原选择；只有用户明确确认重新转写全部内容时才可更换模型。每次操作仍会在后端
重新检查连接、模型用途和用户权限。

旧 OpenAI 媒体配置会标为 **旧版配置**，直到管理员查看迁移预览并明确确认。迁移
创建私有连接且可重复执行，不会自动扩大共享范围。默认模型失去权限时会明确报错，
不会静默切换到其他付费渠道。

ChatGPT 和 Kimi 账号登录仍只提供各自官方协议允许的聊天能力，不会自动获得生图、
转写、语音合成或 Realtime 权限；这些功能需要使用独立的 API Key 连接。
