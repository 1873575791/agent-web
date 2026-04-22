import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./ChatAgent.less";

const API_URL = "http://localhost:3001";

function ChatAgent() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState("doubao");
  const [balances, setBalances] = useState({});
  const [lastUsage, setLastUsage] = useState(null);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);

  // 加载模型列表
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${API_URL}/api/models`);
        const data = await res.json();
        setModels(data.models);
        setCurrentModel(data.current);
      } catch {
        console.error("加载模型列表失败");
      }
    };
    loadModels();
  }, []);

  // 加载余额信息（供其他地方调用）
  const loadBalances = async () => {
    try {
      const res = await fetch(`${API_URL}/api/balance`);
      const data = await res.json();
      setBalances(data.balances);
    } catch {
      console.error("加载余额失败");
    }
  };

  // 初始化加载余额
  useEffect(() => {
    const initBalances = async () => {
      try {
        const res = await fetch(`${API_URL}/api/balance`);
        const data = await res.json();
        setBalances(data.balances);
      } catch {
        console.error("加载余额失败");
      }
    };
    initBalances();
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // 切换模型
  const handleSwitchModel = async (newModel) => {
    if (newModel === currentModel) return;

    try {
      const res = await fetch(`${API_URL}/api/model/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel }),
      });

      const data = await res.json();
      if (data.success) {
        setCurrentModel(newModel);
        setMessages((prev) => [
          ...prev,
          { type: "agent", content: `✅ ${data.message}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: "error", content: data.error || "切换模型失败" },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { type: "error", content: "切换模型失败，请稍后重试" },
      ]);
    }
  };

  // 发送消息
  const sendMessage = async (text) => {
    const message = text || inputValue.trim();
    if (!message || isLoading) return;

    setShowWelcome(false);
    setMessages((prev) => [...prev, { type: "user", content: message }]);
    setInputValue("");
    setIsLoading(true);

    // 先添加一个空的 AI 消息，用于流式填充
    setMessages((prev) => [...prev, { type: "agent", content: "", steps: [] }]);

    try {
      const history = messages.map((msg) => ({
        role: msg.type === "user" ? "user" : "assistant",
        content: msg.content,
      }));

      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, model: currentModel }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop(); // 保留未完成的部分

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);

              if (data.type === "content") {
                // 流式追加内容 - 更新最后一条消息
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex].type === "agent") {
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      content: updated[lastIndex].content + data.content,
                    };
                  }
                  return updated;
                });
              } else if (data.type === "tool_call") {
                // 添加工具调用步骤
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex].type === "agent") {
                    const steps = updated[lastIndex].steps || [];
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      steps: [...steps, data],
                    };
                  }
                  return updated;
                });
              } else if (data.type === "tool_result") {
                // 添加工具结果步骤
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex].type === "agent") {
                    const steps = updated[lastIndex].steps || [];
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      steps: [...steps, data],
                    };
                  }
                  return updated;
                });
              } else if (data.type === "error") {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0) {
                    updated[lastIndex] = {
                      type: "error",
                      content: data.error || "处理请求失败",
                    };
                  }
                  return updated;
                });
              } else if (data.type === "usage") {
                // 更新 token 使用量
                setLastUsage(data.usage);
                // 刷新余额
                loadBalances();
              }
            } catch {
              // JSON 解析失败，忽略
            }
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].type === "agent") {
          updated[lastIndex] = {
            type: "error",
            content: "网络错误，请稍后重试",
          };
        }
        return updated;
      });
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  // 快捷功能
  const quickActions = [
    { icon: "🌤️", label: "查天气", text: "查询北京天气" },
    { icon: "🚄", label: "查高铁", text: "查询北京到上海的高铁票" },
    { icon: "📰", label: "看新闻", text: "今日新闻热点" },
    { icon: "🔢", label: "计算", text: "计算 123 * 456" },
  ];

  // 处理键盘事件
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 复制代码到剪贴板
  const copyToClipboard = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      // 可选：显示复制成功提示
    });
  }, []);

  // 格式化内容 - 使用 Markdown 渲染
  const formatContent = (content) => {
    if (!content) return null;

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");

            if (!inline && (match || codeString.includes("\n"))) {
              return (
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-block-lang">
                      {match ? match[1] : "code"}
                    </span>
                    <button
                      className="code-block-copy"
                      onClick={() => copyToClipboard(codeString)}
                    >
                      复制
                    </button>
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match ? match[1] : "text"}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: "0 0 8px 8px",
                      fontSize: "13px",
                    }}
                    {...props}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          },
          // 链接在新窗口打开
          a({ children, href, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          // 表格样式
          table({ children, ...props }) {
            return (
              <div className="table-wrapper">
                <table {...props}>{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  return (
    <div className="chat-agent">
      {/* 头部 */}
      <header className="chat-header">
        <div className="header-logo">🤖</div>
        <h1 className="header-title">AI Agent 助手</h1>
        <div className="header-status">
          {/* 余额展示 */}
          <div className="balance-display">
            {balances[currentModel] && (
              <div className="balance-item active">
                <span className="balance-label">
                  {models.find((m) => m.key === currentModel)?.name ||
                    currentModel}
                  :
                </span>
                <span
                  className={`balance-value ${balances[currentModel].available ? "" : "unavailable"}`}
                >
                  {balances[currentModel].available ? (
                    <>
                      {balances[currentModel].balance}
                      {balances[currentModel].currency && (
                        <span className="balance-currency">
                          {" "}
                          {balances[currentModel].currency}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="balance-message">
                      {balances[currentModel].message || "不可用"}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          <div className="model-selector">
            <label>模型：</label>
            <select
              value={currentModel}
              onChange={(e) => handleSwitchModel(e.target.value)}
              disabled={isLoading}
            >
              {models.map((model) => (
                <option
                  key={model.key}
                  value={model.key}
                  disabled={!model.configured}
                >
                  {model.name}
                  {!model.configured ? " (未配置)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="status-wrapper">
            <span className="status-dot"></span>
            <span>在线</span>
          </div>
        </div>
      </header>

      {/* Token 使用量显示 */}
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

      {/* 功能标签 */}
      <div className="features">
        {quickActions.map((action, i) => (
          <button
            key={i}
            className="feature-tag"
            onClick={() => sendMessage(action.text)}
            disabled={isLoading}
          >
            <span>{action.icon}</span> {action.label}
          </button>
        ))}
      </div>

      {/* 聊天区域 */}
      <div className="chat-container" ref={chatContainerRef}>
        {showWelcome && (
          <div className="welcome">
            <div className="welcome-icon">👋</div>
            <h2 className="welcome-title">你好！我是 AI 助手</h2>
            <p className="welcome-desc">
              我可以帮你查询天气、高铁票、新闻资讯等。选择上方功能标签快速开始，或直接输入你的问题。
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.type}`}>
            <div className="message-avatar">
              {msg.type === "user" ? "👤" : "🤖"}
            </div>
            <div className="message-content">
              {/* 工具调用步骤 */}
              {msg.steps && msg.steps.length > 0 && (
                <div className="tool-steps">
                  {msg.steps
                    .filter((s) => s.type === "tool_call")
                    .map((step, j) => (
                      <div key={j} className="tool-step">
                        <span className="tool-step-icon">🔧</span>
                        <span>调用</span>
                        <span className="tool-step-name">{step.name}</span>
                        {step.args && Object.keys(step.args).length > 0 && (
                          <span>
                            (
                            {Object.entries(step.args)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(", ")}
                            )
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              )}
              {formatContent(msg.content)}
            </div>
          </div>
        ))}

        {/* 加载状态 - 仅当没有正在填充的内容时显示 */}
        {isLoading && messages[messages.length - 1]?.type !== "agent" && (
          <div className="message agent">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
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
