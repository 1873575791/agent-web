// server/server.js
// 纯 JS 实现 — 无 LangChain、无 OpenAI SDK：fetch 流式 Chat Completions + 手写 ReAct
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from "axios";
import { runAgent } from "./agent.js";
import { tools } from "./tools/index.js";
import { buildSystemPrompt } from "./skills/systemPrompt.js";

dotenv.config();

const app = express();
const server = createServer(app);

// 中间件
app.use(cors());
app.use(express.json());

// ========== 模型配置 ==========
const MODEL_CONFIGS = {
  doubao: {
    name: "豆包",
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.BASE_URL,
    model: process.env.MODEL_NAME,
  },
  deepseek: {
    name: "DeepSeek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  },
};

// 当前模型
let currentModelKey = "doubao";

// 切换模型
function switchModel(modelKey) {
  if (!MODEL_CONFIGS[modelKey]) {
    throw new Error(`不支持的模型: ${modelKey}`);
  }
  currentModelKey = modelKey;
  return MODEL_CONFIGS[modelKey].name;
}

// API 路由：聊天（流式响应）
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, model } = req.body;

    if (!message) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    // 如果指定了模型且与当前不同，则切换
    if (model && model !== currentModelKey) {
      switchModel(model);
    }

    const config = MODEL_CONFIGS[currentModelKey];

    // 校验配置
    console.log(`[DEBUG] chat modelKey: ${currentModelKey}`);
    console.log(`[DEBUG] config.apiKey: ${config?.apiKey?.substring(0, 10)}...`);
    console.log(`[DEBUG] config.baseURL: ${config?.baseURL}`);
    console.log(`[DEBUG] config.model: ${config?.model}`);

    if (!config || !config.apiKey || config.apiKey.includes("your_")) {
      return res.status(400).json({ error: `模型 ${currentModelKey} 未配置或 API Key 无效` });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 构建消息历史（避免与 history 末条 user 重复追加，否则会加倍 token、拖慢首包与整段推理）
    const messages = [];
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    const last = messages[messages.length - 1];
    const lastAlreadyCurrentUser =
      last &&
      last.role === "user" &&
      typeof last.content === "string" &&
      last.content === message;
    if (!lastAlreadyCurrentUser) {
      messages.push({ role: "user", content: message });
    }

    // 构建系统提示词
    const systemPrompt = buildSystemPrompt(tools);

    // 使用纯 JS ReAct Agent
    await runAgent({
      config,
      systemPrompt,
      messages,
      onContent: (text) => {
        res.write(`data: ${JSON.stringify({ type: 'content', content: text })}\n\n`);
      },
      onToolCall: (name, args) => {
        res.write(`data: ${JSON.stringify({
          type: 'tool_call',
          name,
          args: args || {}
        })}\n\n`);
      },
      onToolResult: (name, result) => {
        res.write(`data: ${JSON.stringify({
          type: 'tool_result',
          name,
          result: result || ''
        })}\n\n`);
      },
      onUsage: (usage) => {
        res.write(`data: ${JSON.stringify({ type: 'usage', usage })}\n\n`);
      },
    });

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Agent error:', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || '处理请求失败' })}\n\n`);
      res.end();
    } catch {
      // 响应可能已关闭
    }
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取可用模型列表
app.get('/api/models', (req, res) => {
  const models = Object.entries(MODEL_CONFIGS).map(([key, config]) => ({
    key,
    name: config.name,
    configured: !!(config.apiKey && !config.apiKey.includes("your_")),
  }));
  res.json({ models, current: currentModelKey });
});

// 切换模型
app.post('/api/model/switch', (req, res) => {
  try {
    const { model } = req.body;
    if (!model) {
      return res.status(400).json({ error: '请指定模型' });
    }

    const modelName = switchModel(model);
    res.json({
      success: true,
      current: currentModelKey,
      name: modelName,
      message: `已切换到 ${modelName}`,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 获取模型余额
app.get('/api/balance', async (req, res) => {
  const balances = {};

  for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
    try {
      if (!config.apiKey || config.apiKey.includes('your_')) {
        balances[key] = { available: false, balance: 0, message: '未配置' };
        continue;
      }

      // DeepSeek 余额查询
      if (key === 'deepseek') {
        const response = await axios.get('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${config.apiKey}` },
          timeout: 10000
        });
        const data = response.data;
        if (data.is_available) {
          balances[key] = {
            available: true,
            balance: data.balance_infos?.find(b => b.currency === 'CNY')?.total_balance || '0',
            currency: 'CNY'
          };
        } else {
          balances[key] = { available: false, balance: 0, message: '账户不可用' };
        }
      }
      // 豆包/火山引擎 - 暂不支持余额查询 API
      else if (key === 'doubao') {
        balances[key] = {
          available: true,
          balance: '-',
          message: '火山引擎请在控制台查看',
          consoleUrl: 'https://console.volcengine.com/ark'
        };
      }
      else {
        balances[key] = { available: true, balance: '-', message: '暂不支持查询' };
      }
    } catch (error) {
      balances[key] = { available: false, balance: 0, message: error.message };
    }
  }

  res.json({ balances, current: currentModelKey });
});

// 获取当前目录路径（ESModule 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 托管前端静态文件（生产环境）
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// SPA 兜底：所有非 API 请求返回 index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// 启动服务器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🤖 Agent 服务已启动：http://localhost:${PORT}`);
  console.log(`📝 API 端点：POST http://localhost:${PORT}/api/chat`);
  console.log(`🌐 前端页面：http://localhost:${PORT}`);
});
