/** 与系统提示约定的机器可读问卷块：```agent-questionnaire ... ``` */

const FENCE_RE =
  /```agent-questionnaire\s*\n([\s\S]*?)```(?:\s*\n)?/i;

/**
 * 从完整消息正文中拆出 Markdown 与问卷 JSON。
 * @param {string} content
 * @returns {{ markdown: string, spec: import('./questionnaireTypes').AgentQuestionnaireSpec | null }}
 */
export function parseAgentQuestionnaire(content) {
  if (!content || typeof content !== "string") {
    return { markdown: content || "", spec: null };
  }

  const m = content.match(FENCE_RE);
  if (!m) {
    return { markdown: content, spec: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return { markdown: content, spec: null };
  }

  const spec = normalizeQuestionnaireSpec(parsed);
  const markdown = spec
    ? content.slice(0, m.index).trimEnd()
    : content;

  return { markdown, spec };
}

/**
 * @param {unknown} raw
 * @returns {import('./questionnaireTypes').AgentQuestionnaireSpec | null}
 */
export function normalizeQuestionnaireSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  if (o.v !== 1 || !Array.isArray(o.fields)) return null;

  const fields = o.fields
    .filter(
      (f) =>
        f &&
        typeof f === "object" &&
        typeof f.id === "string" &&
        f.id.trim() &&
        typeof f.label === "string" &&
        ["choice", "multi", "text"].includes(f.type),
    )
    .map((f) => ({
      id: f.id.trim(),
      label: f.label.trim(),
      emoji: typeof f.emoji === "string" ? f.emoji : "",
      type: f.type,
      options: Array.isArray(f.options)
        ? f.options.map((x) => String(x).trim()).filter(Boolean)
        : [],
      allowCustom: Boolean(f.allowCustom),
      placeholder:
        typeof f.placeholder === "string" ? f.placeholder : "",
      required: f.required !== false,
    }));

  if (!fields.length) return null;

  return {
    v: 1,
    title: typeof o.title === "string" ? o.title.trim() : "补充信息",
    description: typeof o.description === "string" ? o.description.trim() : "",
    submitLabel:
      typeof o.submitLabel === "string" && o.submitLabel.trim()
        ? o.submitLabel.trim()
        : "提交给助手",
    fields,
  };
}
