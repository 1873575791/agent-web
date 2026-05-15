import { useState, useRef, useEffect, useCallback } from "react";
import {
  addMessage,
  getAllMessages,
  clearAllMessages,
} from "../utils/chatDB";
import {
  fetchModels,
  fetchBalances,
  postSwitchModel,
  postChat,
  handleChatStreamEvent,
  QUICK_ACTIONS,
  useMarkdownContent,
  ChatHeader,
  ChatMessageList,
} from "./chat/index.js";
import "./ChatAgent.less";

/** 从当前界面状态构造发给后端的 history（含本条 user），避免每次全表读 IndexedDB */
function buildChatHistoryForApi(prevMessages, currentUserText) {
  const prior = prevMessages
    .filter(
      (m) =>
        (m.type === "user" || m.type === "agent") &&
        String(m.content || "").trim(),
    )
    .map((m) => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.content,
    }));
  const cleanedHistory = prior.filter((h, idx) => {
    if (
      h.role === "assistant" &&
      idx === prior.length - 1 &&
      !String(h.content || "").trim()
    )
      return false;
    return true;
  });
  cleanedHistory.push({ role: "user", content: currentUserText });
  return cleanedHistory;
}

function ChatAgent() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState("doubao");
  const [balances, setBalances] = useState({});
  const [lastUsage, setLastUsage] = useState(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const inputRef = useRef(null);
  const chatAbortRef = useRef(null);

  const formatContent = useMarkdownContent();

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const data = await fetchModels();
        if (!alive) return;
        setModels(data.models);
        setCurrentModel(data.current);
      } catch {
        console.error("加载模型列表失败");
      }

      try {
        const saved = await getAllMessages();
        if (!alive || saved.length === 0) return;
        const msgs = saved.map((s) => ({
          id: s.id,
          type: s.type,
          content: s.content,
          steps: s.steps || [],
        }));
        setMessages(msgs);
        setShowWelcome(false);
      } catch {
        console.error("加载历史消息失败");
      }

      try {
        const data = await fetchBalances();
        if (!alive) return;
        setBalances(data.balances);
      } catch {
        console.error("加载余额失败");
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, []);

  const loadBalances = useCallback(async () => {
    try {
      const data = await fetchBalances();
      setBalances(data.balances);
    } catch {
      console.error("加载余额失败");
    }
  }, []);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
    };
  }, []);

  const handleClearHistory = async () => {
    if (isLoading) return;
    try {
      await clearAllMessages();
      setMessages([]);
      setShowWelcome(true);
      setLastUsage(null);
    } catch {
      console.error("清空历史失败");
    }
  };

  const handleSwitchModel = async (newModel) => {
    if (newModel === currentModel) return;

    try {
      const data = await postSwitchModel(newModel);
      if (data.success) {
        setCurrentModel(newModel);
        const content = `✅ ${data.message}`;
        const id = await addMessage({ type: "agent", content });
        setMessages((prev) => [...prev, { id, type: "agent", content }]);
      } else {
        const content = data.error || "切换模型失败";
        const id = await addMessage({ type: "error", content });
        setMessages((prev) => [...prev, { id, type: "error", content }]);
      }
    } catch {
      const content = "切换模型失败，请稍后重试";
      const id = await addMessage({ type: "error", content });
      setMessages((prev) => [...prev, { id, type: "error", content }]);
    }
  };

  const sendMessage = async (text) => {
    const message = text || inputValue.trim();
    if (!message || isLoading) return;

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;

    const userId = await addMessage({ type: "user", content: message });
    setMessages((prev) => [
      ...prev,
      { id: userId, type: "user", content: message },
    ]);
    setShowWelcome(false);
    setInputValue("");
    setIsLoading(true);
    setIsThinking(true);
    setThinkingText("正在思考...");

    const agentId = await addMessage({ type: "agent", content: "", steps: [] });
    setMessages((prev) => [
      ...prev,
      { id: agentId, type: "agent", content: "", steps: [] },
    ]);

    const streamCtx = {
      setMessages,
      setIsThinking,
      setThinkingText,
      setLastUsage,
      loadBalances,
    };

    try {
      const cleanedHistory = buildChatHistoryForApi(messages, message);

      const response = await postChat(
        {
          message,
          history: cleanedHistory,
          model: currentModel,
        },
        abortController.signal,
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            handleChatStreamEvent(data, streamCtx);
          } catch {
            // JSON 解析失败，忽略
          }
        }
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated.length - 1;
        if (last >= 0 && updated[last].type === "agent") {
          updated[last] = {
            type: "error",
            content: "网络错误，请稍后重试",
          };
        }
        return updated;
      });
    } finally {
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      setIsLoading(false);
      setIsThinking(false);
      setThinkingText("");
      inputRef.current?.focus();
    }
  };

  const submitFromQuestionnaire = (text) => {
    void sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-agent">
      <ChatHeader
        models={models}
        currentModel={currentModel}
        balances={balances}
        isLoading={isLoading}
        messagesLength={messages.length}
        onSwitchModel={handleSwitchModel}
        onClearHistory={handleClearHistory}
      />

      {lastUsage && (
        <div className="usage-bar">
          <span>📊 本次消耗: </span>
          <span>输入 {lastUsage.promptTokens} tokens</span>
          <span className="usage-divider">|</span>
          <span>输出 {lastUsage.completionTokens} tokens</span>
          <span className="usage-divider">|</span>
          <span className="usage-total">共 {lastUsage.totalTokens} tokens</span>
        </div>
      )}

      <div className="features">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.text}
            type="button"
            className="feature-tag"
            onClick={() => sendMessage(action.text)}
            disabled={isLoading}
          >
            <span>{action.icon}</span> {action.label}
          </button>
        ))}
      </div>

      <ChatMessageList
        messages={messages}
        showWelcome={showWelcome}
        isLoading={isLoading}
        isThinking={isThinking}
        thinkingText={thinkingText}
        formatContent={formatContent}
        onQuestionnaireSubmit={submitFromQuestionnaire}
      />

      <div className="input-container">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，按 Enter 发送..."
            rows={1}
            disabled={isLoading}
          />
          <button
            type="button"
            className="send-btn"
            onClick={() => sendMessage()}
            disabled={isLoading || !inputValue.trim()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatAgent;
