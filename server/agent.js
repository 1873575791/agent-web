// server/agent.js
//
// 从零实现的 ReAct Agent：仅用原生 fetch + ReadableStream，不依赖 OpenAI SDK。
// 对接「OpenAI 兼容」Chat Completions：流式响应为 SSE 风格（多行 data: JSON，末行 data: [DONE]）。
//
// 数据流概要：
//   fetch(POST .../chat/completions, stream:true) → 按行解析 → JSON chunk
//   → 聚合 delta.content / delta.tool_calls → 无工具则结束；有工具则执行并写入 role:tool，再请求下一轮。

import { getToolDefinitions, executeTool } from "./tools/index.js";
import { trimToolResultForContext } from "./tokenBudget.js";

// ---------- URL ----------

/**
 * 规范化 baseURL，拼出 Chat Completions 完整路径。
 * 环境变量里的 BASE_URL 通常已含版本前缀（如 .../v1、.../api/v3），此处只追加 /chat/completions。
 * @param {string} baseURL
 */
function completionsUrl(baseURL) {
  const trimmed = (baseURL || "").replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

// ---------- SSE 流解析（ReadableStream → 逐条 JSON 字符串）----------

/**
 * 将响应 body 解析为一条条 SSE payload（去掉 "data: " 前缀后的字符串）。
 *
 * 原理：TCP 分包不保证按行边界到达，必须把 Uint8Array 解码后拼进 buffer，
 * 再按 \n 切行；最后一行可能不完整，留在 buffer 等下一包。
 * 忽略 SSE 注释行（以 : 开头）。兼容 "data: {...}" / "data:{...}"。
 *
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
    // 最后一段可能是半行，留到下次 read 再拼
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

  // 流正常结束：处理 buffer 里最后残留的一行（若无换行结尾）
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const payload = tail.slice(5).trim();
    if (payload) yield payload;
  }
}

// ---------- 单次流式 Chat 请求 ----------

/**
 * 发起一次流式 Chat Completions，异步产出每个已解析的 chunk 对象。
 *
 * chunk 结构见各厂商 OpenAI 兼容文档：常见含 choices[0].delta、部分包仅含 usage。
 *
 * @param {Object} p
 * @param {string} p.apiKey
 * @param {string} p.baseURL
 * @param {string} p.model
 * @param {Array} p.messages
 * @param {Array} [p.tools] OpenAI 格式的 tools 数组；为空则不传 tools
 * @param {AbortSignal} [p.signal] 可选，用于取消请求
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
    // 部分网关支持：在最后一个 chunk 附带 token 用量（也可能出现在无 choices 的包）
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
      // 偶发非 JSON 行：跳过
      continue;
    }
    yield chunk;
  }
}

// ---------- ReAct Agent 主入口 ----------

/**
 * 运行 ReAct Agent（流式输出）
 *
 * ReAct 循环（每一轮对应一次完整的流式 Chat 请求直到 [DONE]）：
 *   1. 发送 allMessages（system + 历史 + 此前轮次的 assistant/tool）
 *   2. 流式消费 delta：正文片段走 onContent；tool_calls 片段在内存中按 index 合并
 *   3. 若本轮无任何 tool_calls：将 assistant 正文写入历史，结束
 *   4. 若有 tool_calls：将带 tool_calls 的 assistant 写入历史，依次 executeTool，
 *      每条结果写 role:tool + tool_call_id，然后进入下一轮请求（让模型根据工具结果继续说或再调工具）
 *
 * @param {Object} options
 * @param {Object} options.config - 模型配置 { apiKey, baseURL, model }
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array}  options.messages - 对话历史 [{ role, content }]
 * @param {Function} options.onContent - 收到文本增量 (text: string)
 * @param {Function} options.onToolCall - 工具开始 (name, args)
 * @param {Function} options.onToolResult - 工具结束 (name, result)
 * @param {Function} options.onUsage - 累计 token（若服务端提供）
 * @param {number}  options.maxIterations - 外层最多轮数，防止工具死循环
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

  // 与模型交互的完整上下文（会在多轮 ReAct 中不断 append）
  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  // ---------- 外层：多轮「模型 → 工具 → 模型」----------
  for (let i = 0; i < maxIterations; i++) {
    // 本轮流式回复中拼出的 assistant 纯文本
    let assistantContent = "";
    // 流式 tool_calls 按 index 分片到达，用 Map 合并成完整 id/name/arguments
    const toolCallsMap = new Map();

    // ---------- 内层：消费单次 Chat 流式响应 ----------
    for await (const chunk of chatCompletionStreamChunks({
      apiKey,
      baseURL,
      model,
      messages: allMessages,
      tools: toolDefs,
    })) {
      const delta = chunk.choices?.[0]?.delta;
      console.log("delta", delta);
      const usage = chunk.usage;

      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens || 0;
        totalUsage.completion_tokens += usage.completion_tokens || 0;
        totalUsage.total_tokens += usage.total_tokens || 0;
      }

      // 仅含 usage、无 choices 的包：没有 delta
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
          // name / arguments 在流里可能拆成多段，必须字符串拼接
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }

    // 本轮模型只输出自然语言，未请求工具 → 写入 assistant 并结束整个 Agent
    if (toolCallsMap.size === 0) {
      allMessages.push({ role: "assistant", content: assistantContent });
      break;
    }

    // 本轮模型请求了工具：assistant 消息必须带 tool_calls，供后续 tool 消息用 tool_call_id 对齐
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

    // 同轮多工具并行执行，缩短总等待（结果仍按 tool_calls 顺序写入上下文）
    const toolEntries = Array.from(toolCallsMap.values());
    const parallelResults = await Promise.all(
      toolEntries.map(async (tc) => {
        let args = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          args = {};
        }
        onToolCall?.(tc.name, args);
        const result = await executeTool(tc.name, args);
        onToolResult?.(tc.name, result);
        const raw =
          typeof result === "string" ? result : JSON.stringify(result);
        return {
          tool_call_id: tc.id,
          content: trimToolResultForContext(raw),
        };
      }),
    );
    for (const row of parallelResults) {
      allMessages.push({
        role: "tool",
        tool_call_id: row.tool_call_id,
        content: row.content,
      });
    }
    // 未 break：进入外层下一轮 for，再次请求模型
  }

  if (totalUsage.total_tokens > 0) {
    onUsage?.({
      promptTokens: totalUsage.prompt_tokens,
      completionTokens: totalUsage.completion_tokens,
      totalTokens: totalUsage.total_tokens,
    });
  }
}
