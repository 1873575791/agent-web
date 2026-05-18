// server/tokenBudget.js
// Token 预算：在发往模型前裁剪 history / tool 结果 / 单条消息，降低 prompt 体积。

const TRUNCATE_SUFFIX = "\n\n…（内容已截断以节省上下文）";

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name, defaultTrue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultTrue;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/** 可通过环境变量覆盖的默认预算 */
export const tokenBudgetConfig = {
  /** 保留最近多少轮 user+assistant（按 user 消息计轮） */
  maxHistoryTurns: envInt("AGENT_MAX_HISTORY_TURNS", 8),
  /** history 总字符上限（含当前 user） */
  maxHistoryChars: envInt("AGENT_MAX_HISTORY_CHARS", 12000),
  /** 单条 user/assistant 最大字符 */
  maxMessageChars: envInt("AGENT_MAX_MESSAGE_CHARS", 4000),
  /** 写入上下文的 tool 结果最大字符 */
  maxToolResultChars: envInt("AGENT_MAX_TOOL_RESULT_CHARS", 2000),
  /** 使用精简 system（去掉问卷长 JSON 示例等） */
  compactSystemPrompt: envBool("AGENT_COMPACT_SYSTEM_PROMPT", true),
};

/**
 * 截断单条文本，保留开头。
 * @param {string} text
 * @param {number} maxChars
 */
export function truncateText(text, maxChars) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (s.length <= maxChars) return s;
  const keep = Math.max(0, maxChars - TRUNCATE_SUFFIX.length);
  return s.slice(0, keep) + TRUNCATE_SUFFIX;
}

/**
 * 裁剪发给模型的对话历史（不修改 DB / 前端展示，仅 API 入参）。
 * 策略：1) 只保留最近 N 轮  2) 总字符预算  3) 单条上限
 *
 * @param {Array<{ role: string, content: string }>} messages
 */
export function trimChatHistory(messages) {
  const { maxHistoryTurns, maxHistoryChars, maxMessageChars } = tokenBudgetConfig;
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let list = messages.map((m) => ({
    role: m.role,
    content: truncateText(m.content ?? "", maxMessageChars),
  }));

  // 按 user 计轮：从末尾保留最近 maxHistoryTurns 个 user 及其后的消息
  let userCount = 0;
  let startIdx = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === "user") {
      userCount++;
      if (userCount > maxHistoryTurns) {
        startIdx = i + 1;
        break;
      }
    }
  }
  list = list.slice(startIdx);

  // 总字符预算：从末尾往前累加，丢弃更早的消息
  let total = 0;
  let cutFrom = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const len = (list[i].content || "").length;
    if (total + len > maxHistoryChars) {
      cutFrom = i + 1;
      break;
    }
    total += len;
  }
  if (cutFrom > 0) {
    list = list.slice(cutFrom);
  }

  return list;
}

/**
 * 工具结果写入 allMessages 前的截断。
 * @param {string} content
 */
export function trimToolResultForContext(content) {
  return truncateText(content, tokenBudgetConfig.maxToolResultChars);
}
