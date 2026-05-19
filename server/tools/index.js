// server/tools/index.js
// 纯 JS 工具注册中心 — 替代 LangChain 的 DynamicStructuredTool + zod
// 每个工具就是一个普通对象：{ name, description, parameters, execute }

import axios from "axios";

// ========== 站点代码映射 ==========
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
  '临汾': 'LFV', '临汾西': 'ILV',
  '太原': 'TYV', '太原南': 'TNV'
};

// ========== 格式化金额 ==========
function formatFinanceNumber(num) {
  if (num === null || num === undefined) return '-';
  const absNum = Math.abs(num);
  if (absNum >= 1e12) return (num / 1e12).toFixed(2) + ' 万亿';
  if (absNum >= 1e8) return (num / 1e8).toFixed(2) + ' 亿';
  if (absNum >= 1e4) return (num / 1e4).toFixed(2) + ' 万';
  return num.toFixed(2);
}

// ========== 工具定义 ==========

// 计算器工具 — 替代 @langchain/community/tools/calculator
const calculatorTool = {
  name: "calculator",
  description: "计算数学表达式的值，支持加减乘除、幂运算等基本数学运算",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "数学表达式，如：(2 + 3) * 4 或 2 ** 10"
      }
    },
    required: ["expression"]
  },
  execute: async ({ expression }) => {
    try {
      // 安全的数学表达式求值：只允许数字、运算符和括号
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
      if (!sanitized.trim()) {
        return "无效的数学表达式";
      }
      // 使用 Function 构造器安全求值（已过滤危险字符）
      const result = new Function(`return (${sanitized})`)();
      if (typeof result !== 'number' || !isFinite(result)) {
        return "计算结果无效";
      }
      return `${expression} = ${result}`;
    } catch (error) {
      return `计算错误：${error.message}`;
    }
  }
};

// 天气查询工具
const weatherTool = {
  name: "weather",
  description: "获取指定城市的详细天气信息，包括气温、湿度、风速、风向等",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "城市名称，如：北京、上海"
      }
    },
    required: ["city"]
  },
  execute: async ({ city }) => {
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
};

// 高铁票查询工具
const trainTicketTool = {
  name: "train_ticket",
  description: "查询高铁/火车票信息。支持的城市：北京、上海、广州、深圳、杭州、南京、武汉、成都、重庆、西安、郑州、天津、长沙、合肥、苏州、无锡、济南、青岛、沈阳、大连、哈尔滨、长春、昆明、贵阳、南宁、福州、厦门、南昌、兰州、乌鲁木齐、临汾、太原等",
  parameters: {
    type: "object",
    properties: {
      fromStation: {
        type: "string",
        description: "出发站，如：北京"
      },
      toStation: {
        type: "string",
        description: "到达站，如：上海"
      },
      date: {
        type: "string",
        description: "日期，格式：2026-03-18，可选，默认今天"
      }
    },
    required: ["fromStation", "toStation"]
  },
  execute: async ({ fromStation, toStation, date }) => {
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
};

// 新闻查询工具
const newsTool = {
  name: "news",
  description: "查询最新热门新闻资讯，返回热门新闻来源链接",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "新闻类别"
      }
    },
    required: []
  },
  execute: async () => {
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
};

// 财务报告查询工具
const financialReportTool = {
  name: "financial_report",
  description: "查询上市公司财务报告，获取营业收入、净利润、每股收益、ROE等关键财务指标。支持A股、港股和美股上市公司，如比亚迪、特斯拉、腾讯、茅台等",
  parameters: {
    type: "object",
    properties: {
      company: {
        type: "string",
        description: "公司名称或股票代码，如：比亚迪、特斯拉、腾讯、茅台、AAPL"
      }
    },
    required: ["company"]
  },
  execute: async ({ company }) => {
    try {
      // 1. 搜索股票代码
      const searchRes = await axios.get('https://searchapi.eastmoney.com/api/suggest/get', {
        params: {
          input: company,
          type: 14,
          token: 'D43BF722C8E33BDC906FB84D85E326E8',
          count: 5
        },
        timeout: 10000
      });

      const stockList = searchRes.data?.QuotationCodeTable?.Data;
      if (!stockList?.length) {
        return `未找到 "${company}" 的相关股票信息，请检查公司名称或股票代码`;
      }

      const stock = stockList[0];
      const stockCode = stock.Code;
      const stockName = stock.Name;
      const securityType = stock.SecurityTypeName || '';

      // 判断市场类型
      const isUS = securityType.includes('美股') || securityType.includes('纳斯达克') || /^[A-Z]{1,6}$/.test(stockCode);
      const isHK = securityType.includes('港股') || securityType.includes('香港');

      // 2. 获取财务数据
      let reportName = 'RPT_LICO_FN_CPD';
      if (isUS) reportName = 'RPT_USFN_LICO_FN_CPD';
      else if (isHK) reportName = 'RPT_HKFNFN_CPD';

      const columns = 'SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,BASIC_EPS,WEIGHTAVG_ROE,MGJYXJJE,BPS,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,OPERATE_INCOME_YOY,PARENT_NETPROFIT_YOY';

      const financeRes = await axios.get('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
        params: {
          reportName,
          columns,
          filter: `(SECURITY_CODE="${stockCode}")`,
          pageSize: 4,
          sortTypes: -1,
          sortColumns: 'REPORT_DATE',
          source: 'WEB',
          client: 'WEB'
        },
        timeout: 15000
      });

      const financeData = financeRes.data?.result?.data;
      if (!financeData?.length) {
        return `暂无 ${stockName}(${stockCode}) 的财务报告数据`;
      }

      // 3. 格式化输出
      let result = `📊 ${stockName}(${stockCode}) 财务报告摘要\n`;
      result += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      financeData.forEach((item) => {
        const date = item.REPORT_DATE?.split(' ')[0] || item.REPORT_DATE || '未知';
        result += `\n📅 报告期：${date}\n`;
        result += `  💰 营业收入：${formatFinanceNumber(item.TOTAL_OPERATE_INCOME)}\n`;
        result += `  📈 归母净利润：${formatFinanceNumber(item.PARENT_NETPROFIT)}\n`;
        result += `  📊 营收同比：${item.OPERATE_INCOME_YOY != null ? item.OPERATE_INCOME_YOY.toFixed(2) + '%' : '-'}\n`;
        result += `  📊 净利润同比：${item.PARENT_NETPROFIT_YOY != null ? item.PARENT_NETPROFIT_YOY.toFixed(2) + '%' : '-'}\n`;
        result += `  💵 每股收益：${item.BASIC_EPS != null ? item.BASIC_EPS.toFixed(2) : '-'}\n`;
        result += `  📉 加权ROE：${item.WEIGHTAVG_ROE != null ? item.WEIGHTAVG_ROE.toFixed(2) + '%' : '-'}\n`;
        result += `  💳 每股经营现金流：${item.MGJYXJJE != null ? item.MGJYXJJE.toFixed(2) : '-'}\n`;
        result += `  🏦 每股净资产：${item.BPS != null ? item.BPS.toFixed(2) : '-'}\n`;
      });

      return result;
    } catch (error) {
      return `财务报告查询失败：${error.message}`;
    }
  }
};

// 交互问卷工具 — 前端渲染为可交互表单，服务端拦截后转为正文输出
const questionnaireTool = {
  name: "agent_questionnaire",
  description: "向用户展示一份可交互的结构化问卷表单（支持单选、多选、文本输入）。当你需要一次性收集用户多项信息（如旅行定制、需求调研、偏好配置等）时，调用此工具。前端会将 JSON 渲染为可点选的卡片，用户填完后自动提交。",
  parameters: {
    type: "object",
    properties: {
      v: { type: "number", description: "固定为 1" },
      title: { type: "string", description: "问卷卡片标题，如「请告诉我你的需求」" },
      description: { type: "string", description: "可选，简短说明" },
      submitLabel: { type: "string", description: "可选，提交按钮文案，默认「提交给助手」" },
      fields: {
        type: "array",
        description: "问卷字段数组",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "字段唯一标识，英文蛇形命名" },
            label: { type: "string", description: "用户可见的中文标签" },
            emoji: { type: "string", description: "可选，字段前的 emoji 图标" },
            type: { type: "string", enum: ["choice", "multi", "text"], description: "choice 单选、multi 多选、text 纯文本" },
            options: { type: "array", items: { type: "string" }, description: "选项列表（choice/multi 时使用）" },
            allowCustom: { type: "boolean", description: "是否允许用户自行输入补充" },
            placeholder: { type: "string", description: "输入框占位文字" },
            required: { type: "boolean", description: "是否必填，默认 true" }
          },
          required: ["id", "label", "type"]
        }
      }
    },
    required: ["v", "fields"]
  },
  execute: async () => "问卷已展示给用户"
};

// ========== 工具注册 ==========
const tools = [calculatorTool, weatherTool, trainTicketTool, newsTool, financialReportTool, questionnaireTool];

// 转换为 OpenAI function calling 格式
function getToolDefinitions() {
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

// 按名称查找工具
function getToolByName(name) {
  return tools.find(t => t.name === name);
}

// 执行工具
async function executeTool(name, args) {
  const tool = getToolByName(name);
  if (!tool) {
    return `工具 "${name}" 不存在`;
  }
  try {
    return await tool.execute(args);
  } catch (error) {
    return `工具执行错误：${error.message}`;
  }
}

export { tools, getToolDefinitions, getToolByName, executeTool };
