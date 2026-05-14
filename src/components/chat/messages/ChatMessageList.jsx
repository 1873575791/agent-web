import { useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { MessageRow } from "./MessageRow.jsx";
import { ChatTypingFooter } from "../ui/ChatTypingFooter.jsx";
import { ChatWelcome } from "../ui/ChatWelcome.jsx";

/** react-virtuoso 在 components 为 undefined 或空列表时可能读 EmptyPlaceholder，用稳定对象兜底 */
function EmptyList() {
  return null;
}

export function ChatMessageList({
  messages,
  showWelcome,
  isLoading,
  isThinking,
  thinkingText,
  formatContent,
  onQuestionnaireSubmit,
}) {
  const lastIndex = messages.length - 1;

  const showTypingFooter =
    isLoading &&
    messages.length > 0 &&
    messages[messages.length - 1]?.type !== "agent";

  const itemContent = useCallback(
    (index, msg) => (
      <MessageRow
        msg={msg}
        index={index}
        lastIndex={lastIndex}
        isLoading={isLoading}
        isThinking={isThinking}
        thinkingText={thinkingText}
        formatContent={formatContent}
        onQuestionnaireSubmit={onQuestionnaireSubmit}
      />
    ),
    [lastIndex, isLoading, isThinking, thinkingText, formatContent, onQuestionnaireSubmit],
  );

  const computeItemKey = useCallback(
    (index, msg) => String(msg.id ?? `idx-${index}-${msg.type}`),
    [],
  );

  const components = useMemo(
    () => ({
      EmptyPlaceholder: EmptyList,
      ...(showTypingFooter ? { Footer: ChatTypingFooter } : {}),
    }),
    [showTypingFooter],
  );

  if (messages.length === 0) {
    return (
      <div className="chat-container">
        {showWelcome ? (
          <ChatWelcome />
        ) : (
          <div className="chat-empty-hint">暂无消息，在下方输入开始对话</div>
        )}
      </div>
    );
  }

  return (
    <div className="chat-container">
      <Virtuoso
        className="chat-virtuoso"
        style={{ height: "100%" }}
        data={messages}
        computeItemKey={computeItemKey}
        defaultItemHeight={96}
        increaseViewportBy={{ top: 120, bottom: 280 }}
        // 首次进入列表时视口对齐最后一条（底部），之后仍由 followOutput 在贴底时跟随新消息
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        followOutput={(atBottom) => (atBottom ? "auto" : false)}
        itemContent={itemContent}
        components={components}
      />
    </div>
  );
}
