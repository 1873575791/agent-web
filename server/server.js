// server/server.js
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { ChatOpenAI } from "@langchain/openai";
import { Calculator } from "@langchain/community/tools/calculator";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import axios from "axios";

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

// 站点代码映射
const stationCodeMap = {
  '北京': 'BJP', '北京南': 'VNP', '北京西': 'BXP',
  '上海': 'SHH', '上海虹桥': 'AOH', '上海南': 'SNH',
  '广州': 'GZQ', '广州南': 'IZQ',
  '深圳': 'SZQ', '深圳北': 'IOQ',
  '杭州': 'HZH', '杭州东': 'HGH',
  '南京': 'NJH', '南京南': 'NKH',
  '武汉': 'WHN', '成都': 'CDW', '成都东': 'ICW',
  '重庆': 'CQW', '重庆北': 'CUW',
  '西安': 'XAY', '西安北': 'EAY',
  '郑州': 'ZZF', '郑州东': 'ZAF',
  '天津': 'TJP', '天津西': 'TXP',
  '长沙': 'CSQ', '长沙南': 'CWQ',
  '合肥': 'HFH', '合肥南': 'ENH',
  '苏州': 'SZH', '苏州北': 'OHH',
  '无锡': 'WXH', '无锡东': 'WGH',
  '济南': 'JNK', '济南西': 'JGK', '青岛': 'QDK',
  '沈阳': 'SYT', '沈阳北': 'SBT', '大连': 'DLT',
  '哈尔滨': 'HBB', '哈尔滨西': 'VAB', '长春': 'CCT',
  '昆明': 'KMM', '贵阳': 'GIW', '南宁': 'NNZ',
  '福州': 'FZS', '厦门': 'XMS', '厦门北': 'XKS',
  '南昌': 'NXG', '兰州': 'LZJ', '乌鲁木齐': 'WAR',
  '临汾': 'LFV', '临汾西': 'ILV'
};

// 自定义工具：天气查询
const weatherTool = new DynamicStructuredTool({
  name: "weather",
  description: "获取指定城市的详细天气信息，包括气温、湿度、风速、风向等",
  schema: z.object({
    city: z.string().describe("城市名称，如：北京、上海")
  }),
  func: async ({ city }) => {
    try {
      const res = await axios.get(`https://wttr.in/${city}?format=j1`, { timeout: 10000 });
      const data = res.data;
      const current = data.current_condition[0];
      const today = data.weather[0];

      return `📍 ${city} 天气详情\n` +
        `🌡️ 当前气温：${current.temp_C}°C（体感温度：${current.FeelsLikeC}°C）\n` +
        `📊 今日气温：${today.mintempC}°C ~ ${today.maxtempC}°C\n` +
        `💧 湿度：${current.humidity}%\n` +
        `💨 风速：${current.windspeedKmph} km/h\n` +
        `🧭 风向：${current.winddir16Point}\n` +
        `☁️ 天气状况：${current.lang_zh_cn?.[0]?.value || current.weatherDesc[0].value}\n` +
        `👁️ 能见度：${current.visibility} km\n` +
        `☀️ 紫外线指数：${current.uvIndex}`;
    } catch (error) {
      return `${city} 天气查询失败：${error.message}`;
    }
  }
});

// 自定义工具：高铁票查询
const trainTicketTool = new DynamicStructuredTool({
  name: "train_ticket",
  description: "查询高铁/火车票信息。支持的城市：北京、上海、广州、深圳、杭州、南京、武汉、成都、重庆、西安、郑州、天津、长沙、合肥、苏州、无锡、济南、青岛、沈阳、大连、哈尔滨、长春、昆明、贵阳、南宁、福州、厦门、南昌、兰州、乌鲁木齐、临汾等",
  schema: z.object({
    fromStation: z.string().describe("出发站，如：北京"),
    toStation: z.string().describe("到达站，如：上海"),
    date: z.string().optional().describe("日期，格式：2026-03-18，可选，默认今天")
  }),
  func: async ({ fromStation, toStation, date }) => {
    try {
      const queryDate = date || new Date().toISOString().split('T')[0];

      if (!stationCodeMap[fromStation] || !stationCodeMap[toStation]) {
        return `未找到站点。支持的站点：${Object.keys(stationCodeMap).join('、')}`;
      }

      const url = `https://train.qunar.com/dict/open/s2s.do?dptStation=${encodeURIComponent(fromStation)}&arrStation=${encodeURIComponent(toStation)}&date=${queryDate}&type=normal&user=neibu`;

      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://train.qunar.com/'
        },
        timeout: 15000
      });

      if (res.data?.data?.s2sBeanList?.length > 0) {
        const trains = res.data.data.s2sBeanList.slice(0, 10);
        let result = `📅 ${queryDate} ${fromStation}→${toStation} 高铁查询结果：\n`;
        trains.forEach((t, i) => {
          result += `${i + 1}. ${t.trainNo} | ${t.dptTime}→${t.arrTime} | ${t.extraBeanMap?.interval || ''} | `;
          if (t.seats) {
            const seats = [];
            if (t.seats['二等座']?.count > 0) seats.push(`二等座:¥${t.seats['二等座'].price}`);
            if (t.seats['一等座']?.count > 0) seats.push(`一等座:¥${t.seats['一等座'].price}`);
            if (t.seats['商务座']?.count > 0) seats.push(`商务座:¥${t.seats['商务座'].price}`);
            result += seats.join(' ') || '暂无余票';
          }
          result += '\n';
        });
        result += `共 ${res.data.data.extraData?.count || trains.length} 趟车次`;
        return result;
      }
      return `未查询到 ${queryDate} ${fromStation}→${toStation} 的车次`;
    } catch (error) {
      return `查询失败：${error.message}`;
    }
  }
});

// 自定义工具：新闻查询
const newsTool = new DynamicStructuredTool({
  name: "news",
  description: "查询最新热门新闻资讯，返回热门新闻来源链接",
  schema: z.object({
    category: z.string().optional().describe("新闻类别")
  }),
  func: async () => {
    const hotSites = [
      { name: '微博热搜', url: 'https://s.weibo.com/top/summary', desc: '实时热点话题' },
      { name: '知乎热榜', url: 'https://www.zhihu.com/hot', desc: '热门问答' },
      { name: '百度新闻', url: 'https://news.baidu.com', desc: '综合新闻' },
      { name: '今日头条', url: 'https://www.toutiao.com', desc: '个性化推荐' },
      { name: '网易新闻', url: 'https://news.163.com', desc: '深度报道' }
    ];

    let result = `📰 热门新闻资讯渠道：\n`;
    result += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    hotSites.forEach((site, i) => {
      result += `${i + 1}. ${site.name} - ${site.desc}\n`;
      result += `   🔗 ${site.url}\n`;
    });
    result += `\n💡 提示：点击链接即可查看最新新闻资讯`;
    return result;
  }
});

// 初始化 Agent
let agent = null;

function initAgent(modelKey = currentModelKey) {
  const config = MODEL_CONFIGS[modelKey];

  // 调试日志
  console.log(`[DEBUG] initAgent modelKey: ${modelKey}`);
  console.log(`[DEBUG] config.apiKey: ${config?.apiKey?.substring(0, 10)}...`);
  console.log(`[DEBUG] config.baseURL: ${config?.baseURL}`);
  console.log(`[DEBUG] config.model: ${config?.model}`);

  if (!config || !config.apiKey || config.apiKey.includes("your_")) {
    throw new Error(`模型 ${modelKey} 未配置或 API Key 无效`);
  }

  const llm = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    configuration: {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    },
    temperature: 0,
  });

  const tools = [new Calculator(), weatherTool, trainTicketTool, newsTool];
  return createReactAgent({ llm, tools });
}

// 切换模型
function switchModel(modelKey) {
  if (!MODEL_CONFIGS[modelKey]) {
    throw new Error(`不支持的模型: ${modelKey}`);
  }
  currentModelKey = modelKey;
  agent = null; // 重置 agent，下次请求时重新初始化
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

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 每次都重新初始化 agent，确保使用正确的模型配置
    agent = initAgent(currentModelKey);

    // 构建消息历史
    const messages = [];
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    messages.push({ role: 'user', content: message });

    // 使用 streamEvents 实现 token 级流式输出
    const stream = await agent.streamEvents({ messages }, { version: 'v2' });

    for await (const event of stream) {
      const { event: eventType, name, data } = event;

      // 处理 token 级流式内容
      if (eventType === 'on_chat_model_stream') {
        if (data?.chunk?.content) {
          res.write(`data: ${JSON.stringify({ type: 'content', content: data.chunk.content })}\n\n`);
        }
      }

      // 处理工具调用开始
      if (eventType === 'on_tool_start') {
        res.write(`data: ${JSON.stringify({
          type: 'tool_call',
          name: name,
          args: data?.input || {}
        })}\n\n`);
      }

      // 处理工具调用结果
      if (eventType === 'on_tool_end') {
        res.write(`data: ${JSON.stringify({
          type: 'tool_result',
          name: name,
          result: data?.output || ''
        })}\n\n`);
      }
    }

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Agent error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || '处理请求失败' })}\n\n`);
    res.end();
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

// 启动服务器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🤖 Agent 服务已启动：http://localhost:${PORT}`);
  console.log(`📝 API 端点：POST http://localhost:${PORT}/api/chat`);
});
