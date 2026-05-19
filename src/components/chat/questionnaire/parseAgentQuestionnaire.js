/**
 * 从 agent 回复中提取问卷 JSON。
 *
 * 兼容多种模型输出变体：
 *   1. ```agent-questionnaire\n{...}```   —— 标准格式
 *   2. ```json\n{...}``` / ```\n{...}```  —— 千问等模型常用；需 JSON 含 v:1 + fields
 *   3. 无代码围栏的裸 JSON 对象            —— 少数模型直接输出 JSON
 */

/** 优先：精确语言标记 */
const FENCE_EXACT_RE =
  /```agent-questionnaire\s*\n([\s\S]*?)```(?:\s*\n)?/i;

/** 回退：json / 空语言标记的代码围栏 */
const FENCE_GENERIC_RE =
  /```(?:json)?\s*\n([\s\S]*?)```(?:\s*\n)?/gi;

/** 最终兜底：文本中嵌入的 {..."v":1..."fields":...} 裸 JSON */
const BARE_JSON_RE = /\{[\s\S]*?"v"\s*:\s*1[\s\S]*?"fields"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/g;

/**
 * 尝试将字符串解析为问卷 spec；非问卷 JSON 返回 null。
 * @param {string} raw
 * @returns {import('./questionnaireTypes').AgentQuestionnaireSpec | null}
 */
function tryParseSpec(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  return normalizeQuestionnaireSpec(parsed);
}

/**
 * 从完整消息正文中拆出 Markdown 与问卷 JSON。
 * @param {string} content
 * @returns {{ markdown: string, spec: import('./questionnaireTypes').AgentQuestionnaireSpec | null }}
 */
export function parseAgentQuestionnaire(content) {
  if (!content || typeof content !== "string") {
    return { markdown: content || "", spec: null };
  }

  // —— 1. 精确匹配 agent-questionnaire 围栏 ——
  const exact = content.match(FENCE_EXACT_RE);
  if (exact) {
    const spec = tryParseSpec(exact[1]);
    if (spec) {
      return { markdown: content.slice(0, exact.index).trimEnd(), spec };
    }
  }

  // —— 2. 回退：```json 或 ``` 围栏中寻找含 v:1+fields 的 JSON ——
  let genericMatch;
  FENCE_GENERIC_RE.lastIndex = 0;
  while ((genericMatch = FENCE_GENERIC_RE.exec(content)) !== null) {
    const body = genericMatch[1];
    if (!/\bfields\b/.test(body)) continue;
    const spec = tryParseSpec(body);
    if (spec) {
      return { markdown: content.slice(0, genericMatch.index).trimEnd(), spec };
    }
  }

  // —— 3. 兜底：裸 JSON 对象 ——
  let bareMatch;
  BARE_JSON_RE.lastIndex = 0;
  while ((bareMatch = BARE_JSON_RE.exec(content)) !== null) {
    const spec = tryParseSpec(bareMatch[0]);
    if (spec) {
      return { markdown: content.slice(0, bareMatch.index).trimEnd(), spec };
    }
  }

  return { markdown: content, spec: null };
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
