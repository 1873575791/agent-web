// server/tokenUsageTracker.js
// 按模型累计 token 用量，持久化到 JSON 文件（重启不丢）

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, "../.token-usage.json");

let usageData = {};

function load() {
  try {
    if (existsSync(DATA_FILE)) {
      usageData = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    }
  } catch {
    usageData = {};
  }
}

function save() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(usageData, null, 2), "utf-8");
  } catch {
    // 写不进去就算了，不阻断主流程
  }
}

load();

/**
 * 记录一次请求的 token 用量
 * @param {string} modelKey  如 "qwen" / "deepseek" / "doubao"
 * @param {{ promptTokens?: number, completionTokens?: number, totalTokens?: number }} usage
 */
export function recordUsage(modelKey, usage) {
  if (!modelKey || !usage) return;
  if (!usageData[modelKey]) {
    usageData[modelKey] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUsedAt: null,
    };
  }
  const entry = usageData[modelKey];
  entry.promptTokens += usage.promptTokens || 0;
  entry.completionTokens += usage.completionTokens || 0;
  entry.totalTokens += usage.totalTokens || 0;
  entry.requestCount += 1;
  entry.lastUsedAt = new Date().toISOString();
  save();
}

/**
 * 获取某模型的累计用量
 * @param {string} modelKey
 */
export function getUsage(modelKey) {
  return usageData[modelKey] || null;
}

/** 获取全部模型用量 */
export function getAllUsage() {
  return { ...usageData };
}
