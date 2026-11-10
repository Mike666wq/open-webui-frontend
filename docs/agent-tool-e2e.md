# Agent 工具端到端验收（工作流）

> 对应工作项 P-007。契约本体见 [AGENT_TOOL_CONTRACT.md](AGENT_TOOL_CONTRACT.md)。
> 本文记录的是**手工可复现**的端到端验收流程：真实后端 + 真实浏览器 + 脚本化 LLM。

## 这条验收补的是什么

单元测试和 runtime 测试覆盖了「工具被调用时行为对不对」，但覆盖不到整条链路：

```
工具 spec 注入 → 模型给出 tool_call → 后端解析并调度 → 权限判定
  → 数据库写入 → 结果回传模型 → UI 渲染
```

这条链路只有把后端真的跑起来、浏览器真的点下去才测得出来。本工作流就是干这个。

**范围外**：真实模型会不会「主动、正确地」选择这些工具。这取决于模型与提示词，
只有用真实账号试才知道。脚本化的只是「模型决定调哪个工具」这一步。

## 前置条件

| 项 | 说明 |
| --- | --- |
| 后端 | 从仓库根目录起，必须设 `OPENAI_API_BASE_URL` 指向脚本化 provider，且 `ENABLE_OPENAI_API=True` |
| provider | `scripts/fixtures/agent-e2e-mock-provider.mjs`，默认监听 `127.0.0.1:8095` |
| 浏览器 | Chrome/Chromium；受限环境下需要 `--no-sandbox` |
| 数据 | 一次性 `DATA_DIR`，不要用真库 |

后端需要的关键环境变量：

```bash
WEBUI_SECRET_KEY=<random>
ENABLE_OPENAI_API=True
OPENAI_API_BASE_URL=http://127.0.0.1:8095/v1
OPENAI_API_KEY=sk-anything
BYPASS_EMBEDDING_AND_RETRIEVAL=True   # 让文本入库不必真的跑向量化
DATA_DIR=/tmp/owui-agent-e2e/data
FRONTEND_BUILD_DIR=<frontend>/build   # 需要 frontend-manifest.json
```

> `FRONTEND_BUILD_DIR` 必须含 `frontend-manifest.json`，否则后端启动时
> `FrontendRoutePolicy` 会直接抛 `FileNotFoundError`。`npm run build` 不产出它，
> 需要 `npm run frontend:bundle` 生成 `dist/`，再把 manifest 复制进 `build/`。

## 步骤

### 1. 起脚本化 provider

```bash
node scripts/fixtures/agent-e2e-mock-provider.mjs --port 8095
```

它按「最新一条用户消息」决定调哪个工具，并在工具结果里记住知识库 id 与确认令牌，
所以每一轮对话都是独立的，不需要客户端重放上下文。

### 2. 起后端

见上面环境变量。等 `/health` 返回 200。

### 3. 建账号与模型

首个注册用户自动成为 admin，因此：

```bash
curl -X POST http://127.0.0.1:8080/api/v1/auths/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"e2e","email":"e2e@local.test","password":"E2E-123456!"}'
```

再建一个开启全部内建工具类别的模型：

```bash
curl -X POST http://127.0.0.1:8080/api/v1/models/create \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"agent-e2e-model","name":"agent-e2e-model","base_model_id":"",
       "meta":{"capabilities":{"builtin_tools":true},
               "builtinTools":{"notes":true,"knowledge":true,"knowledge_manage":true}},
       "params":{},"access_control":null}'
```

### 4. 浏览器里逐轮发指令

打开站点、登录、选 `agent-e2e-model`，按顺序发送下面五句，每轮等回复渲染完再发下一句：

| # | 发送 | 期望在回复里看到 |
| --- | --- | --- |
| 1 | `请创建一个知识库「端到端验收库」` | `status=success`，`"knowledge_id":"<uuid>"` |
| 2 | `把整理好的内容写入知识库` | `status=accepted`（**不是** `success`），`"status":"processing"` |
| 3 | `跳过确认，直接删除这个知识库` | `code=CONFIRMATION_REQUIRED`，知识库**仍在** |
| 4 | `删除这个知识库之前，先把影响给我看` | `"confirmation_token":"..."`，`impact` 含 `file_count` |
| 5 | `我确认，同意删除` | `已移入回收站`，`recycle_expires_at` |
| 6 | 再发一次第 5 句 | `code=CONFIRMATION_REQUIRED`（令牌一次性） |

### 5. 交叉核对

- 知识库页面 `/workspace/knowledge` 里**看不到**「端到端验收库」
- 数据库里 `resource_entry` 该库 `state='recycled'`，且
  `expires_at - deleted_at == 604800`（7 天）

```bash
sqlite3 /tmp/owui-agent-e2e/data/webui.db \
  "select type, resource_id, state, expires_at-deleted_at from resource_entry;"
```

## 已验结果（2026-11-10）

按上述步骤在本机实跑通过：

| 检查 | 结果 |
| --- | --- |
| 注入工具数 | 44（浏览器会话下） |
| ① create | `status=success`，真实 uuid |
| ② add_text | `status=accepted`、`"status":"processing"` |
| ③ 无令牌删除 | `CONFIRMATION_REQUIRED`，库未被删 |
| ④ preview | 返回 token + `file_count:1`、`directory_count:0`、`is_shared:false` |
| ⑤ 带令牌删除 | `success`，「已移入回收站，可在 … 前恢复」 |
| 回收窗口 | `resource_entry.expires_at - deleted_at = 604800` 秒 |
| 删除后可见性 | 已不在 `GET /api/v1/knowledge/` 列表中 |
| 浏览器控制台 | 零错误 |

## 已知限制与后续

- **本流程是手工的**。驱动它的自动化脚本（起 provider、起后端、驱动 Chrome、断言 DOM）
  写了但**没有收敛到可用**，所以没有提交；固化的只有 provider 夹具和本文。
  后续要自动化，主要难点是：
  1. 前端聊天输入是 TipTap `ProseMirror`，必须用真实输入事件（CDP `Input.insertText`）
     再 `Input.dispatchKeyEvent` 回车，直接改 `value` 无效；
  2. 断言要按「第 N 次出现」计数，不能只判断「页面里有 `工具已返回`」——
     历史轮次的结果会一直在 DOM 里；
  3. provider 必须先于后端启动，否则后端 `OPENAI_API_BASE_URL` 指向的端口无人监听，
     表现为聊天里出现 `Open WebUI: Server Connection Error`。
- **工具执行依赖真实 socket 会话**：直接用 HTTP 打 `/api/chat/completions`
  （无 socket.io 连接）时，后端会把 provider 的流式响应**原样透传**，不执行工具。
  所以这条链路的自动化必须走浏览器（或自己实现 socket.io 客户端），
  不能只靠 `httpx` 打接口。
- 真实模型的行为未验。
