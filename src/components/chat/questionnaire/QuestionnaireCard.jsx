import { useCallback, useState } from "react";

/**
 * @param {import('./questionnaireTypes').AgentQuestionnaireSpec} spec
 * @param {import('./questionnaireTypes').QuestionnaireField} field
 * @param {{ choice: Record<string, string>; multi: Record<string, string[]>; custom: Record<string, string>; text: Record<string, string> }} form
 */
function summarizeField(field, form) {
  const { choice, multi, custom, text } = form;
  if (field.type === "text") {
    return (text[field.id] || "").trim();
  }
  if (field.type === "choice") {
    const c = (choice[field.id] || "").trim();
    const x = (custom[field.id] || "").trim();
    if (c && x) return `${c}（补充：${x}）`;
    if (c) return c;
    if (x) return x;
    return "";
  }
  const parts = [...(multi[field.id] || [])];
  const x = (custom[field.id] || "").trim();
  if (parts.length && x) return `${parts.join("、")}（补充：${x}）`;
  if (parts.length) return parts.join("、");
  if (x) return x;
  return "";
}

/**
 * @param {import('./questionnaireTypes').AgentQuestionnaireSpec} spec
 * @param {{ choice: Record<string, string>; multi: Record<string, string[]>; custom: Record<string, string>; text: Record<string, string> }} form
 */
function buildSubmitMessage(spec, form) {
  const lines = spec.fields.map((f) => {
    const v = summarizeField(f, form);
    const prefix = f.emoji ? `${f.emoji} ` : "";
    return `- **${prefix}${f.label}**：${v || "（未填）"}`;
  });
  return `根据我的选择补充如下信息：\n\n${lines.join("\n")}`;
}

/**
 * 将助手消息里的问卷 JSON 渲染为可选可填的交互卡片。
 * @param {{ spec: import('./questionnaireTypes').AgentQuestionnaireSpec; disabled?: boolean; onSubmit: (text: string) => void }} props
 */
export function QuestionnaireCard({ spec, disabled, onSubmit }) {
  const [form, setForm] = useState({
    choice: {},
    multi: {},
    custom: {},
    text: {},
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const setChoice = useCallback((id, value) => {
    setForm((prev) => ({
      ...prev,
      choice: { ...prev.choice, [id]: value },
    }));
  }, []);

  const toggleMulti = useCallback((id, option) => {
    setForm((prev) => {
      const cur = prev.multi[id] || [];
      const has = cur.includes(option);
      const next = has ? cur.filter((o) => o !== option) : [...cur, option];
      return {
        ...prev,
        multi: { ...prev.multi, [id]: next },
      };
    });
  }, []);

  const setCustom = useCallback((id, value) => {
    setForm((prev) => ({
      ...prev,
      custom: { ...prev.custom, [id]: value },
    }));
  }, []);

  const setText = useCallback((id, value) => {
    setForm((prev) => ({
      ...prev,
      text: { ...prev.text, [id]: value },
    }));
  }, []);

  const handleSubmit = useCallback(() => {
    setError("");
    const missing = spec.fields.filter((f) => {
      if (!f.required) return false;
      return !summarizeField(f, form);
    });
    if (missing.length) {
      setError(`请填写：${missing.map((f) => f.label).join("、")}`);
      return;
    }
    const text = buildSubmitMessage(spec, form);
    onSubmit(text);
    setSubmitted(true);
  }, [form, onSubmit, spec]);

  if (submitted) {
    return (
      <div className="questionnaire-card questionnaire-card--done">
        <span className="questionnaire-done-icon">✓</span>
        <span>已提交给助手，请稍候回复</span>
      </div>
    );
  }

  return (
    <div className="questionnaire-card">
      <div className="questionnaire-card-head">
        <span className="questionnaire-card-title">{spec.title}</span>
        {spec.description ? (
          <p className="questionnaire-card-desc">{spec.description}</p>
        ) : null}
      </div>

      <div className="questionnaire-fields">
        {spec.fields.map((field) => (
          <div key={field.id} className="questionnaire-field">
            <div className="questionnaire-field-label">
              {field.emoji ? <span className="q-emoji">{field.emoji}</span> : null}
              <span>{field.label}</span>
              {field.required ? (
                <span className="questionnaire-required">必填</span>
              ) : (
                <span className="questionnaire-optional">选填</span>
              )}
            </div>

            {field.type === "text" ? (
              <textarea
                className="questionnaire-textarea"
                rows={2}
                disabled={disabled}
                placeholder={field.placeholder || "请输入…"}
                value={form.text[field.id] || ""}
                onChange={(e) => setText(field.id, e.target.value)}
              />
            ) : null}

            {(field.type === "choice" || field.type === "multi") &&
            field.options.length > 0 ? (
              <div className="questionnaire-chips">
                {field.options.map((opt) => {
                  const selected =
                    field.type === "choice"
                      ? form.choice[field.id] === opt
                      : (form.multi[field.id] || []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`questionnaire-chip${selected ? " is-selected" : ""}`}
                      disabled={disabled}
                      onClick={() => {
                        if (field.type === "choice") {
                          setChoice(
                            field.id,
                            form.choice[field.id] === opt ? "" : opt,
                          );
                        } else {
                          toggleMulti(field.id, opt);
                        }
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {field.type === "choice" && field.options.length === 0 ? (
              <p className="questionnaire-hint">此项无预设选项，请在下方填写</p>
            ) : null}

            {field.allowCustom && field.type !== "text" ? (
              <input
                type="text"
                className="questionnaire-custom-input"
                disabled={disabled}
                placeholder={
                  field.placeholder || "其他（自行输入，可与选项组合）"
                }
                value={form.custom[field.id] || ""}
                onChange={(e) => setCustom(field.id, e.target.value)}
              />
            ) : null}
          </div>
        ))}
      </div>

      {error ? <div className="questionnaire-error">{error}</div> : null}

      <button
        type="button"
        className="questionnaire-submit"
        disabled={disabled}
        onClick={handleSubmit}
      >
        {spec.submitLabel}
      </button>
    </div>
  );
}
