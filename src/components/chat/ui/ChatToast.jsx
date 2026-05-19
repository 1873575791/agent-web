/** 顶部轻提示（模型切换等），不进入消息列表 */
export function ChatToast({ toast, onDismiss }) {
  if (!toast?.text) return null;

  return (
    <div
      className={`chat-toast chat-toast--${toast.variant || "info"}`}
      role="status"
    >
      <span className="chat-toast-text">{toast.text}</span>
      <button
        type="button"
        className="chat-toast-close"
        onClick={onDismiss}
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}
