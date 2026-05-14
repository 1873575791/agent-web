// server/agent.js
// 从零实现的 ReAct Agent：仅用原生 fetch + ReadableStream，无 OpenAI SDK
// 协议：OpenAI 兼容 Chat Completions（流式 SSE / NDJSON）

import { getToolDefinitions, executeTool } from "./tools/index.js";

/**
 * 规范化 baseURL，请求路径为 /chat/completions
 * @param {string} baseURL
 */
function completionsUrl(baseURL) {
  const trimmed = (baseURL || "").replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

/**
 * 按行解析 SSE：每行 `data: {...}` 或 `data: [DONE]`
 * @param {ReadableStream<Uint8Array>} body
 */
async function* streamDataLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const raw of parts) {
      const line = raw.trim();
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload) yield payload;
      }
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const payload = tail.slice(5).trim();
    if (payload) yield payload;
  }
}

/**
 * 单次流式 Chat Completions 调用，产出解析后的 chunk 对象
 * @param {Object} p
 * @param {string} p.apiKey
 * @param {string} p.baseURL
 * @param {string} p.model
 * @param {Array} p.messages
 * @param {Array} [p.tools]
 * @param {AbortSignal} [p.signal]
 */
async function* chatCompletionStreamChunks({
  apiKey,
  baseURL,
  model,
  messages,
  tools,
  signal,
}) {
  const url = completionsUrl(baseURL);
  const body = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Chat API ${res.status}: ${errText.slice(0, 500) || res.statusText}`
    );
  }

  if (!res.body) {
    throw new Error("响应无 body，无法流式读取");
  }

  for await (const payload of streamDataLines(res.body)) {
    if (payload === "[DONE]") break;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    yield chunk;
  }
}

/**
 * 运行 ReAct Agent（流式输出）
 *
 * ReAct 循环：
 *   1. 发送消息给 LLM（含 system prompt + 历史 + 工具定义）
 *   2. 如果 LLM 返回 content → 流式输出给前端
 *   3. 如果 LLM 返回 tool_calls → 执行工具，将结果追加到消息，回到步骤 1
 *   4. 直到 LLM 不再调用工具为止
 *
 * @param {Object} options
 * @param {Object} options.config - 模型配置 { apiKey, baseURL, model }
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array}  options.messages - 对话历史 [{ role, content }]
 * @param {Function} options.onContent - 收到文本内容回调 (text: string)
 * @param {Function} options.onToolCall - 工具调用开始回调 (name, args)
 * @param {Function} options.onToolResult - 工具调用结果回调 (name, result)
 * @param {Function} options.onUsage - token 使用量回调 (usage)
 * @param {number}  options.maxIterations - 最大循环次数（防死循环）
 */
export async function runAgent({
  config,
  systemPrompt,
  messages,
  onContent,
  onToolCall,
  onToolResult,
  onUsage,
  maxIterations = 10,
}) {
  const { apiKey, baseURL, model } = config;
  if (!apiKey || !baseURL || !model) {
    throw new Error("缺少 apiKey、baseURL 或 model 配置");
  }

  const toolDefs = getToolDefinitions();

  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  for (let i = 0; i < maxIterations; i++) {
    let assistantContent = "";
    const toolCallsMap = new Map();

    for await (const chunk of chatCompletionStreamChunks({
      apiKey,
      baseURL,
      model,
      messages: allMessages,
      tools: toolDefs,
    })) {
      const delta = chunk.choices?.[0]?.delta;
      const usage = chunk.usage;

      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens || 0;
        totalUsage.completion_tokens += usage.completion_tokens || 0;
        totalUsage.total_tokens += usage.total_tokens || 0;
      }

      if (!delta) continue;

      if (delta.content) {
        assistantContent += delta.content;
        onContent?.(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: tc.id || "",
              name: "",
              arguments: "",
            });
          }
          const entry = toolCallsMap.get(idx);
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }

    if (toolCallsMap.size === 0) {
      allMessages.push({ role: "assistant", content: assistantContent });
      break;
    }

    const assistantMessage = {
      role: "assistant",
      content: assistantContent || null,
      tool_calls: Array.from(toolCallsMap.values()).map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    };
    allMessages.push(assistantMessage);

    for (const tc of toolCallsMap.values()) {
      let args = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        args = {};
      }

      onToolCall?.(tc.name, args);

      const result = await executeTool(tc.name, args);

      onToolResult?.(tc.name, result);

      allMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

  if (totalUsage.total_tokens > 0) {
    onUsage?.({
      promptTokens: totalUsage.prompt_tokens,
      completionTokens: totalUsage.completion_tokens,
      totalTokens: totalUsage.total_tokens,
    });
  }
}
