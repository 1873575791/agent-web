/** 聊天消息类型（持久化到 IndexedDB 的 type 字段） */
export const MESSAGE_TYPE = {
  USER: "user",
  AGENT: "agent",
  ERROR: "error",
  /** 切换模型等系统提示，不参与模型上下文 */
  MODEL_SWITCH: "model_switch",
};

/** 是否应进入 Chat Completions 的 messages */
export function isApiHistoryMessage(msg) {
  const t = msg?.type;
  return t === MESSAGE_TYPE.USER || t === MESSAGE_TYPE.AGENT;
}

/** 旧数据：切换成功误存为 agent */
const LEGACY_MODEL_SWITCH = /^✅\s*已切换到/;

/**
 * 从 DB 读出后规范化 type（兼容历史脏数据）
 * @param {Object} record
 */
export function normalizeStoredMessage(record) {
  if (
    record.type === MESSAGE_TYPE.AGENT &&
    LEGACY_MODEL_SWITCH.test(String(record.content || ""))
  ) {
    return { ...record, type: MESSAGE_TYPE.MODEL_SWITCH };
  }
  return record;
}

/**
 * 构造发给后端的 history（含本条 user），排除 model_switch / error 等
 * @param {Array} prevMessages
 * @param {string} currentUserText
 */
export function buildChatHistoryForApi(prevMessages, currentUserText) {
  const prior = prevMessages
    .filter(
      (m) =>
        isApiHistoryMessage(m) && String(m.content || "").trim(),
    )
    .map((m) => ({
      role: m.type === MESSAGE_TYPE.USER ? "user" : "assistant",
      content: m.content,
    }));

  const cleanedHistory = prior.filter((h, idx) => {
    if (
      h.role === "assistant" &&
      idx === prior.length - 1 &&
      !String(h.content || "").trim()
    ) {
      return false;
    }
    return true;
  });

  cleanedHistory.push({ role: "user", content: currentUserText });
  return cleanedHistory;
}
