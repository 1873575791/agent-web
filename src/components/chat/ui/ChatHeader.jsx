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
