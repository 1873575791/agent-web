import { memo } from "react";

/**
 * 虚拟列表单行：memo 减少 Markdown 子树在滚动时的无效重绘
 */
export const MessageRow = memo(function MessageRow({
  msg,
  index,
  lastIndex,
  isLoading,
  isThinking,
  thinkingText,
  formatContent,
}) {
  const isLastAgent =
    isLoading &&
    isThinking &&
    index === lastIndex &&
    msg.type === "agent";

  return (
    <div className={`virtuoso-msg-row ${msg.type}`}>
      <div className={`message ${msg.type}`}>
        <div className="message-avatar">
          {msg.type === "user" ? "👤" : "🤖"}
        </div>
        <div className="message-content">
          {msg.steps && msg.steps.length > 0 && (
            <div className="tool-steps">
              {msg.steps
                .filter((s) => s.type === "tool_call")
                .map((step, j) => (
                  <div
                    key={`${step.name}-${j}-${step.status}`}
                    className={`tool-step ${step.status === "running" ? "running" : "done"}`}
                  >
                    <span className="tool-step-icon">
                      {step.status === "running" ? "⏳" : "✅"}
                    </span>
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
                    {step.status === "running" && (
                      <span className="tool-step-status">执行中...</span>
                    )}
                  </div>
                ))}
            </div>
          )}
          {formatContent(msg.content)}
          {isLastAgent && (
            <div className="thinking-indicator">
              <div className="thinking-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="thinking-text">{thinkingText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
