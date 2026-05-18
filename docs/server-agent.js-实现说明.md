# `server/agent.js` 实现说明（清晰版）

本文档用更直白的方式说明 `server/agent.js` 在做什么，以及每个方法的职责和执行过程。

---

## 1. 这个文件整体在做什么

`server/agent.js` 实现了一个**基于 ReAct 思路的流式 Agent 运行器**，核心目标是：

- 用原生 `fetch + ReadableStream` 调用 OpenAI 兼容的 Chat Completions 接口（`stream: true`）。
- 一边接收模型增量输出，一边实时回调文本内容（`onContent`）。
- 当模型发起工具调用（`tool_calls`）时，执行本地工具并把结果写回对话上下文。
- 自动进入下一轮模型请求，让模型基于工具结果继续回答。
- 在“模型不再调用工具”或达到最大轮数时结束。

可以把它理解为：  
**模型流式输出 → 发现工具调用 → 执行工具 → 把结果喂回模型 → 继续流式输出** 的循环控制器。

---

## 2. 文件中的方法与职责总览

文件里一共 4 个核心方法：

1. `completionsUrl(baseURL)`  
   规范化接口地址，拼出 `/chat/completions` 完整路径。

2. `streamDataLines(body)`（异步生成器）  
   把 HTTP 流按 SSE 规则切成一条条 `data: ...` payload 字符串。

3. `chatCompletionStreamChunks(params)`（异步生成器）  
   发起一次流式聊天请求，逐条产出已经解析好的 JSON chunk。

4. `runAgent(options)`（主入口）  
   驱动 ReAct 外层循环：收流、拼文本、拼工具调用、执行工具、续轮请求、累计 token 使用量。

---

## 3. 执行流程（从调用到结束）

### 第一步：初始化

`runAgent` 启动后会：

- 校验 `config` 中的 `apiKey / baseURL / model` 是否齐全。
- 通过 `getToolDefinitions()` 获取工具定义（给模型看，告诉它可调用哪些工具）。
- 构造 `allMessages = [system, ...历史消息]` 作为完整上下文。
- 初始化 `totalUsage`，用于累计各轮 token 消耗。

### 第二步：进入 ReAct 外层循环（最多 `maxIterations` 轮）

每一轮都会调用一次 `chatCompletionStreamChunks(...)` 来获取模型流式响应：

- 解析 `delta.content`：拼到 `assistantContent`，并通过 `onContent` 向外实时输出。
- 解析 `delta.tool_calls`：按 `index` 合并分片（`id/name/arguments` 可能被拆成多段传输）。
- 解析 `chunk.usage`：累加到 `totalUsage`。

### 第三步：判断本轮是否调用了工具

- **没有工具调用**：  
  将本轮 `assistantContent` 写入 `allMessages`，然后 `break`，Agent 结束。

- **有工具调用**：  
  先把带 `tool_calls` 的 assistant 消息写入 `allMessages`；  
  再并行执行所有工具（`Promise.all`），得到结果后按顺序写入 `role: "tool"` 消息；  
  最后进入下一轮，让模型继续基于工具结果推理和回答。

### 第四步：结束时上报使用量

如果累计到 token（`total_tokens > 0`），调用 `onUsage` 返回：

- `promptTokens`
- `completionTokens`
- `totalTokens`

---

## 4. 每个方法的详细说明

## `completionsUrl(baseURL)`

### 作用

把输入的 `baseURL` 去掉尾部多余 `/`，再拼接 `/chat/completions`。

### 为什么需要它

不同环境下 `baseURL` 可能写成：

- `https://xxx/v1`
- `https://xxx/v1/`

直接拼接容易出现双斜杠或路径不稳定，这个方法统一处理。

### 输入 / 输出

- 输入：`baseURL: string`
- 输出：`string`（完整请求地址）

---

## `streamDataLines(body)`

### 作用

把 `ReadableStream<Uint8Array>` 按 SSE 行协议解析成可迭代的 payload（去掉 `data:` 前缀后的文本）。

### 关键处理点

- **处理 TCP 分包**：网络包不一定按行边界到达，所以用 `buffer` 累积后再按 `\n` 切行。
- **保留半行**：最后一段可能是不完整行，暂存在 `buffer`，等下一包补齐。
- **过滤无效行**：忽略空行、注释行（以 `:` 开头）。
- **兼容格式差异**：支持 `data:xxx` 与 `data: xxx`。
- **流结束兜底**：若最后一行没有换行，也会尝试解析 tail。

### 输入 / 输出

- 输入：`body: ReadableStream<Uint8Array>`
- 输出：异步生成器，逐条 `yield payload: string`

---

## `chatCompletionStreamChunks(params)`

### 作用

发起**单次**流式 Chat Completions 请求，并把 SSE payload 解析成 JSON chunk 对象后逐条产出。

### 它做了哪些事

1. 通过 `completionsUrl(baseURL)` 生成请求 URL。  
2. 组装请求体（`model/messages/stream/stream_options/temperature`）。  
3. 若有工具定义，附加 `tools` 和 `tool_choice: "auto"`。  
4. `fetch` 发起 POST。  
5. 校验 HTTP 状态和 `res.body`。  
6. 调用 `streamDataLines(res.body)` 拿到每条 payload：  
   - 遇到 `[DONE]` 结束；  
   - 尝试 `JSON.parse`，失败则跳过该行；  
   - 成功则 `yield chunk`。

### 输入 / 输出

- 输入：`{ apiKey, baseURL, model, messages, tools?, signal? }`
- 输出：异步生成器，逐条 `yield chunk: object`

### 错误处理策略

- 非 2xx：抛出包含状态码和部分错误正文的异常。
- 无响应流 body：抛错。
- 单行 JSON 解析失败：忽略并继续，不中断整条流。

---

## `runAgent(options)`（核心）

### 作用

管理完整 ReAct 生命周期，是外部调用的唯一主入口。

### 参数（按职责理解）

- **模型配置**：`config`（`apiKey/baseURL/model`）
- **上下文输入**：`systemPrompt`、`messages`
- **流式事件回调**：`onContent`、`onToolCall`、`onToolResult`、`onUsage`
- **安全阈值**：`maxIterations`（默认 10，避免无限工具循环）

### 内部状态

- `allMessages`：真实发给模型的完整上下文（会不断 append）。
- `assistantContent`：当前轮拼接中的自然语言输出。
- `toolCallsMap`：按 `index` 合并工具调用分片，得到完整 `{id, name, arguments}`。
- `totalUsage`：跨轮累计 token。

### 核心循环逻辑

1. 调 `chatCompletionStreamChunks` 读本轮流。  
2. 消费 chunk：
   - 有 `usage` 就累计；
   - 有 `delta.content` 就拼文本并回调；
   - 有 `delta.tool_calls` 就按 index 合并片段。
3. 流结束后判断：
   - 无工具调用：写 assistant 文本，结束；
   - 有工具调用：写 assistant + `tool_calls`，执行工具并写 `tool` 消息，然后下一轮。

### 工具执行细节

- 同轮多个工具用 `Promise.all` 并行执行，降低等待时间。
- `arguments` 用 `JSON.parse` 解析；解析失败时兜底为空对象 `{}`。
- 每个工具都会触发：
  - `onToolCall(name, args)`
  - `onToolResult(name, result)`
- 工具结果最终写成 `role: "tool"` 消息，并用 `tool_call_id` 与 assistant 的 `tool_calls` 对齐。

---

## 5. 关键设计点（为什么这样实现）

- **分层清晰**：SSE 解析、单轮请求、ReAct 控制器三层职责分离，便于维护。
- **对流式分片友好**：`tool_calls` 的 `name/arguments` 采用字符串拼接，适配分段传输。
- **容错优先**：个别脏行 JSON 解析失败不影响整个响应流。
- **上下文严格对齐**：assistant 的 `tool_calls` 与后续 `tool_call_id` 成对写入，符合 OpenAI 兼容协议预期。
- **防死循环**：`maxIterations` 作为上限，避免模型持续调用工具导致无限轮询。

---

## 6. 一句话总结

`server/agent.js` 是一个“流式 Chat + 工具调用编排器”：它负责把模型流式输出、工具执行、上下文续写和多轮 ReAct 循环串成一个稳定可用的 Agent 运行流程。

