import { memo, useMemo } from "react";
import { MESSAGE_TYPE } from "../lib/chatHistory.js";
import { parseAgentQuestionnaire } from "../questionnaire/parseAgentQuestionnaire.js";
import { QuestionnaireCard } from "../questionnaire/QuestionnaireCard.jsx";

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
  onQuestionnaireSubmit,
}) {
  const isLastAgent =
    isLoading &&
    isThinking &&
    index === lastIndex &&
    msg.type === MESSAGE_TYPE.AGENT;

  const isModelSwitch = msg.type === MESSAGE_TYPE.MODEL_SWITCH;

  const { markdown, spec } = useMemo(
    () =>
      msg.type === MESSAGE_TYPE.AGENT
        ? parseAgentQuestionnaire(msg.content || "")
        : { markdown: msg.content || "", spec: null },
    [msg.type, msg.content],
  );

  const questionnaireKey = spec
    ? `${msg.id}__${JSON.stringify(spec)}`
    : `${msg.id}__none`;

  if (isModelSwitch) {
    return (
      <div className="virtuoso-msg-row model_switch">
        <div className="message model_switch">
          <div className="message-content model-switch-notice">
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`virtuoso-msg-row ${msg.type}`}>
      <div className={`message ${msg.type}`}>
        <div className="message-avatar">
          {msg.type === MESSAGE_TYPE.USER ? "👤" : "🤖"}
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
          {formatContent(markdown)}
          {msg.type === MESSAGE_TYPE.AGENT && spec && onQuestionnaireSubmit ? (
            <QuestionnaireCard
              key={questionnaireKey}
              spec={spec}
              disabled={isLoading}
              onSubmit={onQuestionnaireSubmit}
            />
          ) : null}
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
