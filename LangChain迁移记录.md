# LangChain 迁移至纯 JS/OpenAI SDK 实施记录

## 一、迁移概述

将 agent-web 项目从 LangChain 框架完全迁移至纯 JavaScript + OpenAI SDK 实现，手写 ReAct Agent 循环，消除对 LangChain 生态的依赖。

### 迁移目标

- 移除所有 `@langchain/*` 依赖包（6 个）
- 移除 `zod` 依赖（LangChain 工具 schema 专用）
- 使用 OpenAI SDK 原生 `function calling` + 流式 API 实现等效功能
- 前端代码零改动，SSE 协议完全兼容

### 迁移结果

| 指标           | 迁移前                          | 迁移后                   |
| -------------- | ------------------------------- | ------------------------ |
| npm 依赖包数量 | 500+                            | 383                      |
| AI 相关依赖    | 7 个（6 langchain + openai）    | 1 个（openai）           |
| Agent 核心代码 | 隐藏在 LangChain 内部           | 完全可控，约 130 行      |
| 工具定义方式   | `DynamicStructuredTool` + `zod` | 纯 JS 对象 + JSON Schema |

---

## 二、核心架构映射

| LangChain 组件                          | 纯 JS 替代方案                                          |
| --------------------------------------- | ------------------------------------------------------- |
| `ChatOpenAI`                            | `new OpenAI({ apiKey, baseURL })`                       |
| `createReactAgent`                      | 手写 `runAgent()` — ReAct 循环                          |
| `DynamicStructuredTool` + `z.object()`  | 纯 JS 对象 `{ name, description, parameters, execute }` |
| `@langchain/community/tools/calculator` | 手写 `calculatorTool`（安全表达式求值）                 |
| `agent.streamEvents({ version: 'v2' })` | `client.chat.completions.create({ stream: true })`      |
| LangChain `tool_choice`                 | OpenAI 原生 `tool_choice: "auto"`                       |
| `zod` schema 校验                       | JSON Schema 对象（OpenAI 原生格式）                     |

---

## 三、文件变更明细

### 3.1 新建文件

#### `server/tools/index.js` — 工具注册中心

替代 LangChain 的 `DynamicStructuredTool` + `@langchain/community/tools/calculator`。

**工具定义格式：**

```js
const tool = {
  name: "tool_name",           // 工具名称
  description: "工具描述",      // LLM 读取的描述
  parameters: {                // JSON Schema 格式（OpenAI 原生）
    type: "object",
    properties: { ... },
    required: [...]
  },
  execute: async (args) => {   // 执行函数
    // 业务逻辑
    return result;
  }
};
```

**包含的工具：**

| 工具名             | 功能           | 替代来源                                |
| ------------------ | -------------- | --------------------------------------- |
| `calculator`       | 数学表达式计算 | `@langchain/community/tools/calculator` |
| `weather`          | 天气查询       | 原 `DynamicStructuredTool`              |
| `train_ticket`     | 高铁票查询     | 原 `DynamicStructuredTool`              |
| `news`             | 新闻资讯       | 原 `DynamicStructuredTool`              |
| `financial_report` | 财务报告       | 原 `DynamicStructuredTool`              |

**导出接口：**

- `tools` — 工具数组（供 `systemPrompt.js` 生成描述）
- `getToolDefinitions()` — 转换为 OpenAI function calling 格式
- `getToolByName(name)` — 按名查找工具
- `executeTool(name, args)` — 执行工具并返回结果

---

#### `server/agent.js` — ReAct Agent 核心

替代 LangChain 的 `createReactAgent` + `agent.streamEvents()`。

**核心函数：** `runAgent(options)`

**ReAct 循环流程：**

```
┌─────────────────────────────────────────┐
│  1. 构建消息：system prompt + 历史 + 工具  │
│                    ↓                     │
│  2. 调用 OpenAI 流式 API                  │
│     client.chat.completions.create({     │
│       stream: true,                      │
│       tools: toolDefs,                   │
│       tool_choice: "auto"                │
│     })                                   │
│                    ↓                     │
│  3. 收集 LLM 回复                         │
│     ├── 有 content → onContent() 流式输出  │
│     └── 有 tool_calls → 执行步骤 4        │
│                    ↓                     │
│  4. 执行工具调用                           │
│     onToolCall(name, args)               │
│     result = executeTool(name, args)     │
│     onToolResult(name, result)           │
│     将结果追加到消息历史                     │
│                    ↓                     │
│  5. 回到步骤 2（最多 maxIterations 次）     │
└─────────────────────────────────────────┘
```

**回调接口（与前端 SSE 协议完全对齐）：**

| 回调                         | SSE 事件                  | 说明         |
| ---------------------------- | ------------------------- | ------------ |
| `onContent(text)`            | `{ type: "content" }`     | 流式文本输出 |
| `onToolCall(name, args)`     | `{ type: "tool_call" }`   | 工具调用开始 |
| `onToolResult(name, result)` | `{ type: "tool_result" }` | 工具调用结果 |
| `onUsage(usage)`             | `{ type: "usage" }`       | Token 使用量 |

**关键实现细节：**

- 流式工具调用解析：使用 `Map<index, { id, name, arguments }>` 收集分片
- `stream_options: { include_usage: true }` 获取 token 使用量
- `maxIterations = 10` 防止工具调用死循环
- 工具参数 `arguments` 为 JSON 字符串，需 `JSON.parse()` 解析

---

### 3.2 重写文件

#### `server/server.js` — 主服务

**移除的 import：**

```diff
- import { ChatOpenAI } from "@langchain/openai";
- import { Calculator } from "@langchain/community/tools/calculator";
- import { DynamicStructuredTool } from "@langchain/core/tools";
- import { z } from "zod";
- import { createReactAgent } from "@langchain/langgraph/prebuilt";
+ import { runAgent } from "./agent.js";
+ import { tools } from "./tools/index.js";
```

**聊天接口核心变更：**

```diff
- agent = initAgent(currentModelKey);
- const stream = await agent.streamEvents({ messages }, { version: 'v2' });
- for await (const event of stream) { ... }

+ const systemPrompt = buildSystemPrompt(tools);
+ await runAgent({
+   config,
+   systemPrompt,
+   messages,
+   onContent: (text) => { ... },
+   onToolCall: (name, args) => { ... },
+   onToolResult: (name, result) => { ... },
+   onUsage: (usage) => { ... },
+ });
```

**其他变更：**

- 移除了 `initAgent()` 函数（不再需要预构建 LangChain Agent）
- 移除了所有 `DynamicStructuredTool` 工具定义（5 个工具，约 200 行）
- 移除了 `stationCodeMap` 和 `formatFinanceNumber`（迁移到 `tools/index.js`）
- API Key 校验从 `initAgent()` 前移到 `/api/chat` 路由入口（提前返回 400 错误）

---

### 3.3 无需改动

#### `server/skills/systemPrompt.js`

`buildSystemPrompt(tools)` 仅使用 `tool.name` 和 `tool.description`，纯 JS 工具对象格式完全兼容，无需任何修改。

#### 前端代码（`src/` 目录下所有文件）

SSE 协议（`content` / `tool_call` / `tool_result` / `usage` / `done`）与迁移前完全一致，前端代码零改动。

---

### 3.4 依赖变更

#### `package.json` — 移除的依赖

```diff
- "@langchain/classic": "^1.0.23"
- "@langchain/community": "^1.1.23"
- "@langchain/core": "^1.1.32"
- "@langchain/langgraph": "^1.2.2"
- "@langchain/openai": "^1.2.13"
- "langchain": "^1.2.32"
- "zod": "^4.3.6"
```

#### 保留的依赖

```json
{
  "openai": "^6.31.0",
  "axios": "^1.13.6",
  "cors": "^2.8.5",
  "dotenv": "^17.3.1",
  "express": "^4.18.2",
  "https-proxy-agent": "^8.0.0"
}
```

---

## 四、验证结果

### 4.1 服务启动

```
🤖 Agent 服务已启动：http://localhost:3001
📝 API 端点：POST http://localhost:3001/api/chat
🌐 前端页面：http://localhost:3001
```

### 4.2 健康检查

```bash
$ curl http://localhost:3001/api/health
{"status":"ok","timestamp":"2026-05-08T09:56:10.654Z"}
```

### 4.3 普通对话（流式输出）

```bash
$ curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","history":[]}'

data: {"type":"content","content":"你"}
data: {"type":"content","content":"好"}
data: {"type":"content","content":"呀"}
...
data: {"type":"done"}
```

### 4.4 工具调用（ReAct 循环）

```bash
$ curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"计算 123 * 456","history":[]}'

data: {"type":"tool_call","name":"calculator","args":{"expression":"123 * 456"}}
data: {"type":"tool_result","name":"calculator","result":"123 * 456 = 56088"}
data: {"type":"content","content":"计算"}
data: {"type":"content","content":"结果"}
...
data: {"type":"usage","usage":{"promptTokens":2760,"completionTokens":158,"totalTokens":2918}}
data: {"type":"done"}
```

验证通过：工具调用 → 工具执行 → 基于结果生成回答，全流程正常。

---

## 五、文件结构对比

```
server/
├── agent.js          ← 新建：纯 JS ReAct Agent 核心
├── server.js         ← 重写：移除 LangChain，集成 runAgent
├── skills/
│   └── systemPrompt.js   ← 无改动
└── tools/
    └── index.js      ← 新建：纯 JS 工具注册中心
```

---

## 六、优势与注意事项

### 优势

1. **依赖精简**：移除 7 个包，node_modules 减少 ~120 个包
2. **完全可控**：Agent 核心逻辑约 130 行，调试和定制不再受框架黑盒限制
3. **性能更优**：无 LangChain 中间层开销，流式输出更直接
4. **兼容性好**：OpenAI SDK 的 function calling 是各模型厂商的事实标准（豆包、DeepSeek 均兼容）
5. **前端零改动**：SSE 协议不变，前端无需任何修改

### 注意事项

1. **计算器工具安全性**：使用正则过滤危险字符 + `new Function` 求值，仅允许数字和基本运算符
2. **最大循环次数**：`maxIterations = 10`，防止工具调用死循环
3. **模型兼容性**：要求模型支持 OpenAI 格式的 `tools` / `tool_choice` 参数（豆包、DeepSeek 均已验证）
