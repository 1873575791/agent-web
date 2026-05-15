import { updateMessage } from "../../../utils/chatDB";

/** 流式正文写入 IndexedDB 节流，避免每 token 一次写库阻塞主线程 */
let agentContentFlushTimer = null;
let pendingAgentContent = { id: null, content: "" };

function scheduleAgentContentPersist(agentId, fullContent) {
  pendingAgentContent = { id: agentId, content: fullContent };
  if (agentContentFlushTimer) clearTimeout(agentContentFlushTimer);
  agentContentFlushTimer = setTimeout(() => {
    agentContentFlushTimer = null;
    const { id, content } = pendingAgentContent;
    if (id != null) void updateMessage(id, { content });
  }, 200);
}

function flushAgentContentPersist() {
  if (agentContentFlushTimer) {
    clearTimeout(agentContentFlushTimer);
    agentContentFlushTimer = null;
  }
  const { id, content } = pendingAgentContent;
  if (id != null) void updateMessage(id, { content });
  pendingAgentContent = { id: null, content: "" };
}

/** 处理单条 SSE JSON 事件（与 server 推送的 type 对齐） */
export function handleChatStreamEvent(data, ctx) {
  const {
    setMessages,
    setIsThinking,
    setThinkingText,
    setLastUsage,
    loadBalances,
  } = ctx;

  if (data.type === "content") {
    setIsThinking(false);
    setThinkingText("");
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (last >= 0 && updated[last].type === "agent") {
        updated[last] = {
          ...updated[last],
          content: updated[last].content + data.content,
        };
        scheduleAgentContentPersist(updated[last].id, updated[last].content);
      }
      return updated;
    });
    return;
  }

  if (data.type === "tool_call") {
    flushAgentContentPersist();
    setIsThinking(true);
    setThinkingText(`正在调用 ${data.name}...`);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (last >= 0 && updated[last].type === "agent") {
        const steps = updated[last].steps || [];
        const newSteps = [...steps, { ...data, status: "running" }];
        updated[last] = {
          ...updated[last],
          steps: newSteps,
        };
        void updateMessage(updated[last].id, { steps: newSteps });
      }
      return updated;
    });
    return;
  }

  if (data.type === "tool_result") {
    setIsThinking(true);
    setThinkingText("正在分析结果...");
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (last >= 0 && updated[last].type === "agent") {
        const steps = [...(updated[last].steps || [])];
        const lastCallIdx = [...steps]
          .reverse()
          .findIndex(
            (s) => s.type === "tool_call" && s.status === "running",
          );
        if (lastCallIdx !== -1) {
          const realIdx = steps.length - 1 - lastCallIdx;
          steps[realIdx] = { ...steps[realIdx], status: "done" };
        }
        updated[last] = {
          ...updated[last],
          steps,
        };
        void updateMessage(updated[last].id, { steps });
      }
      return updated;
    });
    return;
  }

  if (data.type === "error") {
    flushAgentContentPersist();
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (last >= 0) {
        updated[last] = {
          type: "error",
          content: data.error || "处理请求失败",
        };
      }
      return updated;
    });
    return;
  }

  if (data.type === "done") {
    flushAgentContentPersist();
    setIsThinking(false);
    setThinkingText("");
    return;
  }

  if (data.type === "usage") {
    flushAgentContentPersist();
    setLastUsage(data.usage);
    void loadBalances();
  }
}
