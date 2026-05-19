export function ChatHeader({
  models,
  currentModel,
  balances,
  isLoading,
  messagesLength,
  onSwitchModel,
  onClearHistory,
}) {
  return (
    <header className="chat-header">
      <div className="header-logo">🤖</div>
      <h1 className="header-title">AI Agent 助手</h1>
      <div className="header-status">
        <div className="balance-display">
          {balances[currentModel] && (() => {
            const b = balances[currentModel];
            const modelName =
              models.find((m) => m.key === currentModel)?.name || currentModel;
            const inner = (
              <>
                <span className="balance-label">{modelName}:</span>
                <span className={`balance-value ${b.available ? "" : "unavailable"}`}>
                  {b.available ? (
                    <>
                      {b.balance}
                      {b.currency && (
                        <span className="balance-currency"> {b.currency}</span>
                      )}
                    </>
                  ) : (
                    <span className="balance-message">
                      {b.message || "不可用"}
                    </span>
                  )}
                </span>
              </>
            );

            return b.consoleUrl ? (
              <a
                className="balance-item active balance-link"
                href={b.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={b.message || "查看详情"}
              >
                {inner}
              </a>
            ) : (
              <div className="balance-item active">{inner}</div>
            );
          })()}
        </div>
        <div className="model-selector">
          <label>模型：</label>
          <select
            value={currentModel}
            onChange={(e) => onSwitchModel(e.target.value)}
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
          <button
            type="button"
            className="clear-history-btn"
            onClick={onClearHistory}
            title="清空聊天历史"
            disabled={isLoading || messagesLength === 0}
          >
            🗑️
          </button>
        </div>
      </div>
    </header>
  );
}
