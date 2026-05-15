# `server/agent.js` 方法说明

本文按文件内**自上而下**的顺序，说明每个函数的职责、输入输出、与上下游的关系。该文件实现的是：**不依赖 OpenAI 官方 SDK**，用 `fetch` + `ReadableStream` 调用「OpenAI 兼容」流式 Chat Completions，并在应用层手写 **ReAct 工具循环**。

---

## 文件整体在做什么

| 阶段 | 说明 |
|------|------|
| **URL** | `completionsUrl` 把环境里的 `baseURL` 变成可请求的 `.../chat/completions`。 |
| **读流** | `streamDataLines` 把 HTTP 响应 body 从二进制流切成一条条 `data:` 后面的字符串。 |
| **单次对话** | `chatCompletionStreamChunks` 发起一次流式请求，并把每行 JSON 解析成 `chunk` 逐个 `yield`。 |
| **Agent 循环** | `runAgent` 多次调用「单次对话」，根据是否有 `tool_calls` 决定是否执行工具并再问模型。 |

依赖：`./tools/index.js` 的 `getToolDefinitions`、`executeTool`（工具 Schema 与本地执行）。

---

## 1. `completionsUrl(baseURL)`

**类型**：普通函数（模块内私有）。

**要干的事**

- 接收配置里的 **`baseURL`**（例如火山 `.../api/v3` 或 DeepSeek `.../v1`）。
- 去掉末尾多余的 **`/`**，再拼接 **`/chat/completions`**，得到本次 `POST` 的完整 URL。

**为什么单独拆出来**

- 避免双斜杠或漏路径；所有流式请求共用一个拼 URL 规则。

**注意**

- `baseURL` 为空时会得到以 `/chat/completions` 开头的相对路径（通常不应发生；`runAgent` 里会对空配置抛错）。

---

## 2. `streamDataLines(body)`（异步生成器）

**类型**：`async function*` —— 用 `for await...of` 消费，每次 `yield` 一条 **payload 字符串**（还不是完整 JSON 对象）。

**参数**

- **`body`**：`fetch` 返回的 `Response.body`，即 `ReadableStream<Uint8Array>`。

**要干的事**

1. 用 **`ReadableStreamDefaultReader`** 按块 `read()`。
2. 用 **`TextDecoder`** 把 `Uint8Array` 转成文本，**追加到 `buffer`**（因为 TCP 分包不一定按行切断）。
3. 对 `buffer` 按 **`\n` 拆行**；**最后一段**可能是不完整行，留在 `buffer` 里等下一次 `read`。
4. 对每一行 `trim` 后：
   - 空行、**SSE 注释行**（以 `:` 开头）跳过；
   - 若以 **`data:`** 开头，则去掉前缀，把剩余部分 **`yield`** 出去（例如一段 JSON 字符串，或 `[DONE]`）。
5. 流 **`done` 之后**，若 `buffer` 里还剩**没以换行结束的一行**，同样按 `data:` 规则再 `yield` 一次，避免丢最后一包。

**设计要点**

- 解决「半行」问题；兼容 `data: {...}` 与 `data:{...}`。
- 本函数**不负责** `JSON.parse`，只负责从 SSE 字节流里稳定抽出 **payload 字符串**。

---

## 3. `chatCompletionStreamChunks({ apiKey, baseURL, model, messages, tools, signal })`（异步生成器）

**类型**：`async function*` —— 每次 `yield` 一个 **已 `JSON.parse` 的 chunk 对象**（OpenAI 兼容流式 chunk）。

**参数简要说明**

| 参数 | 含义 |
|------|------|
| `apiKey` | `Authorization: Bearer` 用的密钥。 |
| `baseURL` | 网关根路径，经 `completionsUrl` 拼出完整 URL。 |
| `model` | 模型名或接入点 ID。 |
| `messages` | 当前完整消息数组（含 system、多轮 user/assistant/tool）。 |
| `tools` | 可选；有长度时带上 `tools` + `tool_choice: "auto"`。 |
| `signal` | 可选 `AbortSignal`，用于取消请求。 |

**要干的事**

1. 拼 **`POST`** 的 JSON body：`model`、`messages`、`stream: true`、`stream_options.include_usage`、`temperature: 0`；若有工具则附加 `tools` / `tool_choice`。
2. **`fetch(url, { method, headers, body, signal })`**。
3. 若 **`!res.ok`**：尽量读 **`res.text()`** 前 500 字符，拼进 `Error` 抛出，便于排查网关返回体。
4. 若无 **`res.body`**：抛错（无法流式读）。
5. **`for await (const payload of streamDataLines(res.body))`**：
   - 若 `payload === "[DONE]"`**：结束生成器（流结束）。
   - 否则尝试 **`JSON.parse(payload)`**；失败则 **跳过**（容错脏行）。
   - 成功则 **`yield chunk`**。

**chunk 里常见字段**（由上游实现决定）

- **`choices[0].delta`**：增量正文 `content`、增量 `tool_calls`。
- **`usage`**：有的包只有 `usage`、没有 `delta`（例如最后一个统计包）。

**与 `runAgent` 的关系**

- `runAgent` 的内层循环 **`for await...of chatCompletionStreamChunks(...)`** 消费这里产出的每个 chunk，做聚合与回调。

---

## 4. `runAgent(options)`（导出函数）

**类型**：`async function`，**对外主入口**。

**参数 `options`**

| 字段 | 含义 |
|------|------|
| `config` | `{ apiKey, baseURL, model }`，缺任一会在开头 **抛错**。 |
| `systemPrompt` | 系统提示，会作为第一条 **`role: "system"`** 消息。 |
| `messages` | 调用方传入的对话历史（通常不含 system；由本函数拼进 `allMessages`）。 |
| `onContent` | 可选；每收到一段 **`delta.content`** 就调用，参数为**增量字符串**（用于 SSE 推前端）。 |
| `onToolCall` | 可选；每次即将执行工具前调用 `(name, args)`。 |
| `onToolResult` | 可选；工具执行完调用 `(name, result)`。 |
| `onUsage` | 可选；若累计 `total_tokens > 0`，在结束前调用一次，字段为 **camelCase**（`promptTokens` 等）。 |
| `maxIterations` | 默认 `10`；**外层 for** 最多跑多少轮「模型↔工具」，防止死循环。 |

**要干的事（分块说明）**

### 4.1 初始化

- 校验 `config`。
- **`getToolDefinitions()`**：拿到发给模型的 tools 定义。
- 构造 **`allMessages`**：`[system, ...messages]`，后续所有 assistant / tool 回复都 **append** 到这一数组里，保证下一轮请求上下文完整。

### 4.2 累计用量

- 维护 **`totalUsage`** 三个整数；每个 chunk 若有 **`usage`** 就累加（兼容「单独 usage 包」）。

### 4.3 外层循环（ReAct 轮次）

每一轮：

1. 清空本轮 **`assistantContent`**，新建 **`toolCallsMap`**（`index → { id, name, arguments }`）。
2. **内层**：再次调用 **`chatCompletionStreamChunks`**，把当前 **`allMessages`** 和 **`toolDefs`** 发给模型。
3. 对每个 **chunk**：
   - 若有 **`usage`**：累加到 `totalUsage`。
   - 若无 **`delta`**：跳过（纯 usage 包）。
   - 若有 **`delta.content`**：拼到 `assistantContent`，并 **`onContent?.(delta.content)`**。
   - 若有 **`delta.tool_calls`**：按 **`tc.index`**（缺省 `0`）在 `toolCallsMap` 里**累加** `id`、`function.name`、`function.arguments`（流式分片必须 **字符串拼接**）。

4. **内层结束后**分支：
   - **`toolCallsMap.size === 0`**：认为本轮模型**只回了自然语言、没要工具** → `allMessages.push({ role: "assistant", content: assistantContent })`，**`break` 跳出外层**，Agent 结束。
   - **否则**：本轮有工具调用：
     - 先 `push` 一条带 **`tool_calls`** 的 assistant 消息（`content` 可为 `null`）。
     - 对 `toolCallsMap` 里每一项：`JSON.parse(arguments)`（失败则用 `{}`），**`onToolCall`**，**`executeTool`**，**`onToolResult`**，再 `push` **`role: "tool"`** 且 **`tool_call_id`** 与上文 id 对齐。
     - **不 `break`**，外层进入下一轮 **`i+1`**，再次请求模型，让其根据工具结果继续生成或继续调工具。

### 4.4 收尾

- 若 **`totalUsage.total_tokens > 0`**：调用 **`onUsage`**，把字段转成前端常用的 camelCase。

**安全与边界**

- **`maxIterations`**：限制「模型反复要工具」的上限；达到上限后循环结束，**不会**再自动提示用户（若需可在外层扩展）。
- **工具参数 JSON 非法**：用 `{}` 执行，避免 `JSON.parse` 抛错中断整个 Agent。

---

## 调用链小结（便于对照代码）

```
runAgent
  ├─ completionsUrl          （仅被 chatCompletionStreamChunks 使用）
  └─ 循环 maxIterations 次
        └─ chatCompletionStreamChunks
              ├─ fetch POST …/chat/completions
              └─ streamDataLines(res.body)
                    └─ yield payload → JSON.parse → yield chunk
        └─ 聚合 delta → 无 tool_calls 则结束；有则 executeTool 并扩充 allMessages
```

---

## 与 `server/server.js` 的典型配合

`server.js` 在 `/api/chat` 里组装 `systemPrompt`、`messages`，把 **`onContent` / `onToolCall` / `onToolResult` / `onUsage`** 写成 **SSE `data: JSON`** 推给浏览器；**业务逻辑与协议解析**集中在 `agent.js`，HTTP  framing 在 `server.js`。

---

*文档生成自仓库中的 `server/agent.js`，若实现变更请以源码为准。*
