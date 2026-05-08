// server/agent.js
// 纯 JS ReAct Agent — 替代 LangChain 的 createReactAgent + ChatOpenAI
// 核心思路：手写 ReAct 循环，通过 OpenAI SDK 的流式 API + function calling 实现

import OpenAI from "openai";
import { getToolDefinitions, executeTool } from "./tools/index.js";

/**
 * 创建 OpenAI 客户端
 * @param {Object} config - { apiKey, baseURL, model }
 * @returns {OpenAI}
 */
function createClient(config) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
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
  const client = createClient(config);
  const toolDefs = getToolDefinitions();

  // 构建完整的消息列表
  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (let i = 0; i < maxIterations; i++) {
    // 调用 OpenAI Chat Completions API（流式）
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: allMessages,
      tools: toolDefs,
      tool_choice: "auto",
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0,
    });

    // 收集本轮 LLM 的完整回复
    let assistantContent = "";
    const toolCallsMap = new Map(); // index -> { id, name, arguments }

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      const usage = chunk.usage;

      // 收集 token 使用量（最后一个 chunk 包含 usage）
      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens || 0;
        totalUsage.completion_tokens += usage.completion_tokens || 0;
        totalUsage.total_tokens += usage.total_tokens || 0;
      }

      if (!delta) continue;

      // 处理文本内容
      if (delta.content) {
        assistantContent += delta.content;
        onContent?.(delta.content);
      }

      // 处理工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
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

    // 如果没有工具调用，本轮结束
    if (toolCallsMap.size === 0) {
      // 将助手消息加入历史
      allMessages.push({ role: "assistant", content: assistantContent });
      break;
    }

    // 构建助手消息（含 content + tool_calls）
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

    // 依次执行每个工具调用
    for (const tc of toolCallsMap.values()) {
      let args = {};
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      // 通知前端：工具调用开始
      onToolCall?.(tc.name, args);

      // 执行工具
      const result = await executeTool(tc.name, args);

      // 通知前端：工具调用结果
      onToolResult?.(tc.name, result);

      // 将工具结果加入消息历史
      allMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    // 继续循环，让 LLM 基于工具结果生成回复
  }

  // 发送最终 token 使用量
  if (totalUsage.total_tokens > 0) {
    onUsage?.({
      promptTokens: totalUsage.prompt_tokens,
      completionTokens: totalUsage.completion_tokens,
      totalTokens: totalUsage.total_tokens,
    });
  }
}
