import { updateMessage } from "../../../utils/chatDB";

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
        void updateMessage(updated[last].id, {
          content: updated[last].content,
        });
      }
      return updated;
    });
    return;
  }

  if (data.type === "tool_call") {
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
    setIsThinking(false);
    setThinkingText("");
    return;
  }

  if (data.type === "usage") {
    setLastUsage(data.usage);
    void loadBalances();
  }
}
