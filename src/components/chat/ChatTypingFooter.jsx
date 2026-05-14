/**
 * Virtuoso Footer：最后一条不是 agent 时的占位 typing
 */
export function ChatTypingFooter() {
  return (
    <div className="virtuoso-msg-row agent">
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
    </div>
  );
}
