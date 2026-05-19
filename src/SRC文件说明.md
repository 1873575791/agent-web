# src 目录文件说明

本文档按 `src/` 现有文件整理，包含每个文件的职责和主要方法说明。

## 根目录

### `src/main.jsx`
- **职责**：前端入口，挂载 React 应用。
- **关键逻辑**
  - `createRoot(document.getElementById("root")).render(...)`：将 `App` 渲染到根节点，并启用 `StrictMode`。

### `src/App.jsx`
- **职责**：应用壳组件，当前仅负责承载聊天主组件。
- **方法/组件**
  - `App()`：返回 `<ChatAgent />`。

### `src/index.less`
- **职责**：全局基础样式（reset、全局字体和背景、根节点高度）。
- **方法说明**：无 JS 方法，主要是全局样式规则。

### `src/App.less`
- **职责**：模板遗留样式（`counter`、`hero`、`next-steps` 等）。
- **方法说明**：无 JS 方法，主要是样式变量与选择器。
- **备注**：当前主界面样式主要在 `ChatAgent.less`，该文件更偏初始化模板样式。

## 顶层组件

### `src/components/ChatAgent.jsx`
- **职责**：聊天页核心容器，串联模型切换、消息收发、SSE 流处理、历史存储、UI 组件渲染。
- **主要状态**
  - `messages`：消息列表（用户/助手/错误）。
  - `inputValue`：输入框内容。
  - `isLoading`：是否正在请求中。
  - `showWelcome`：是否展示欢迎页。
  - `models` / `currentModel`：模型列表与当前模型。
  - `balances` / `lastUsage`：余额和 token 消耗信息。
  - `isThinking` / `thinkingText`：助手“思考中”状态显示。
- **关键方法**
  - `loadBalances()`：刷新余额信息。
  - `handleClearHistory()`：清空 IndexedDB 与页面消息状态。
  - `handleSwitchModel(newModel)`：调用切换模型接口并弹出 toast。
  - `sendMessage(text?)`：
    - 组装并发送用户消息；
    - 新建 agent 占位消息；
    - 调用 `postChat` 建立流式响应；
    - 逐段解析 SSE（`data: ...`）并委托 `handleChatStreamEvent` 更新界面；
    - 处理中断、错误、收尾状态（loading/thinking/focus）。
  - `submitFromQuestionnaire(text)`：问卷提交后复用 `sendMessage`。
  - `handleKeyDown(e)`：回车发送（`Shift+Enter` 保留换行）。

### `src/components/ChatAgent.less`
- **职责**：聊天页面全部主样式（头部、消息区、输入区、Markdown 样式、问卷卡片、响应式）。
- **方法说明**：无 JS 方法，核心是样式变量、动画和组件 class 定义。

## 聊天模块聚合入口

### `src/components/chat/index.js`
- **职责**：聊天子模块 barrel 文件，对外统一导出 API、hooks、UI、消息处理与问卷能力。
- **导出内容**
  - 网络请求：`fetchModels`、`fetchBalances`、`postSwitchModel`、`postChat`
  - 常量与工具：`API_URL`、`QUICK_ACTIONS`
  - 流处理：`handleChatStreamEvent`
  - 历史工具：`MESSAGE_TYPE`、`isApiHistoryMessage`、`isModelSwitchNotice`、`filterMessagesForList`、`buildChatHistoryForApi`
  - hooks：`useToast`、`useMarkdownContent`
  - 问卷：`parseAgentQuestionnaire`、`normalizeQuestionnaireSpec`、`QuestionnaireCard`
  - UI：`ChatHeader`、`ChatWelcome`、`ChatTypingFooter`、`ChatToast`
  - 消息列表：`ChatMessageList`、`MessageRow`

## 数据与请求层

### `src/utils/chatDB.js`
- **职责**：IndexedDB 持久化封装，保存/读取聊天消息。
- **关键常量**
  - `DB_NAME`、`DB_VERSION`、`STORE_NAME`：数据库配置。
- **关键方法**
  - `openDB()`：打开或初始化数据库及对象仓库（包含 `timestamp` 索引）。
  - `addMessage(message)`：新增消息，自动补 `timestamp`，返回 `id`。
  - `updateMessage(id, updates)`：按 `id` 合并更新消息字段。
  - `getAllMessages()`：按索引获取全部消息。
  - `clearAllMessages()`：清空消息仓库。
  - `getChatHistory()`：提取仅 `user/agent` 且有内容的历史，转换为 `role/content` 格式。

### `src/components/chat/lib/constants.js`
- **职责**：请求地址常量。
- **关键常量**
  - `API_URL`：目前为空串，表示走同源或开发代理。

### `src/components/chat/lib/api.js`
- **职责**：与后端 HTTP API 交互。
- **关键方法**
  - `fetchModels()`：获取模型列表与当前模型。
  - `fetchBalances()`：获取模型余额信息。
  - `postSwitchModel(modelKey)`：切换模型。
  - `postChat(body, signal?)`：发起聊天请求（支持 `AbortSignal` 取消）。

### `src/components/chat/lib/quickActions.js`
- **职责**：预置快捷提问按钮配置。
- **关键常量**
  - `QUICK_ACTIONS`：天气/高铁/新闻/计算等快捷项（`icon`、`label`、`text`）。

### `src/components/chat/lib/chatHistory.js`
- **职责**：消息类型定义与“展示历史/模型上下文历史”过滤构建逻辑。
- **关键常量**
  - `MESSAGE_TYPE`：`USER`、`AGENT`、`ERROR`、`MODEL_SWITCH`。
  - `LEGACY_MODEL_SWITCH`：旧版“切模型成功”文案兼容正则。
- **关键方法**
  - `isApiHistoryMessage(msg)`：判断消息是否可进模型上下文。
  - `isModelSwitchNotice(msg)`：识别模型切换提示（含历史兼容）。
  - `filterMessagesForList(messages)`：过滤系统提示，只保留列表需要展示的消息。
  - `buildChatHistoryForApi(prevMessages, currentUserText)`：构造发送给后端的历史，并追加当前用户输入。

### `src/components/chat/lib/streamHandler.js`
- **职责**：处理聊天 SSE 流事件，把流式内容同步到 React 状态和 IndexedDB。
- **内部方法**
  - `scheduleAgentContentPersist(agentId, fullContent)`：200ms 节流写库，避免 token 级别频繁写入。
  - `flushAgentContentPersist()`：立即刷盘未落库内容。
- **核心导出**
  - `handleChatStreamEvent(data, ctx)`：按事件类型分发处理：
    - `content`：追加助手文本；
    - `tool_call`：追加工具步骤并切换“思考中”文案；
    - `tool_result`：把最近运行中的工具步骤标记为完成；
    - `error`：写入错误消息；
    - `done`：结束思考态；
    - `usage`：更新 token 消耗并刷新余额。

## Hooks

### `src/components/chat/hooks/useToast.js`
- **职责**：统一 toast 状态与自动消失逻辑。
- **关键方法**
  - `useToast(durationMs?)`：返回 `{ toast, showToast, dismissToast }`。
  - `dismissToast()`：立即清理 toast 并清除定时器。
  - `showToast(text, variant?)`：显示提示并按设定时长自动关闭。

### `src/components/chat/hooks/useMarkdownContent.jsx`
- **职责**：将 Markdown 文本转换为 React 节点（支持 GFM、代码高亮、复制代码、表格包装、外链安全属性）。
- **关键方法**
  - `useMarkdownContent()`：返回 `formatContent(content)`。
  - `copyToClipboard(text)`：复制代码到剪贴板。
  - `formatContent(content)`：使用 `ReactMarkdown` 渲染，重写 `code` / `a` / `table` 三类节点：
    - 代码块：语言识别 + `SyntaxHighlighter` + 复制按钮；
    - 行内代码：应用 `inline-code` 样式；
    - 链接：默认新窗口打开；
    - 表格：包裹在可横向滚动容器中。

## 问卷模块

### `src/components/chat/questionnaire/questionnaireTypes.js`
- **职责**：问卷结构 JSDoc 类型定义。
- **内容**
  - `QuestionnaireField`：单字段结构（`choice/multi/text` 等）。
  - `AgentQuestionnaireSpec`：问卷总体结构（版本、标题、字段列表等）。
- **方法说明**：无运行时方法，主要用于类型提示与约束文档。

### `src/components/chat/questionnaire/parseAgentQuestionnaire.js`
- **职责**：从助手文本中提取并校验问卷 JSON，同时保留普通 Markdown 部分。
- **关键常量**
  - `FENCE_EXACT_RE`：匹配 ```agent-questionnaire``` 围栏。
  - `FENCE_GENERIC_RE`：回退匹配 ```json``` 或无语言围栏。
  - `BARE_JSON_RE`：兜底匹配裸 JSON。
- **关键方法**
  - `tryParseSpec(raw)`：尝试 JSON 解析并走规范化校验。
  - `parseAgentQuestionnaire(content)`：输出 `{ markdown, spec }`，按“精确围栏 -> 通用围栏 -> 裸 JSON”顺序提取。
  - `normalizeQuestionnaireSpec(raw)`：把原始对象归一化为合法 `spec`，并过滤非法字段。

### `src/components/chat/questionnaire/QuestionnaireCard.jsx`
- **职责**：把问卷 spec 渲染成交互表单，支持单选、多选、文本、自定义补充输入与必填校验。
- **内部方法**
  - `summarizeField(field, form)`：把单字段用户输入整理成可读文本。
  - `buildSubmitMessage(spec, form)`：把所有字段拼成最终提交给助手的 Markdown 文本。
- **核心组件方法**
  - `QuestionnaireCard({ spec, disabled, onSubmit })`：
    - 管理表单状态（`choice/multi/custom/text`）；
    - `setChoice` / `toggleMulti` / `setCustom` / `setText` 更新各类输入；
    - `handleSubmit` 校验必填并调用 `onSubmit(text)`；
    - 提交后显示“已提交”状态。

## 消息展示模块

### `src/components/chat/messages/ChatMessageList.jsx`
- **职责**：聊天消息虚拟滚动容器（`react-virtuoso`），控制欢迎页/空态/typing footer 展示。
- **关键方法**
  - `EmptyList()`：Virtuoso 空占位兜底组件。
  - `ChatMessageList(props)`：消息列表主组件。
  - `itemContent(index, msg)`：渲染每一项 `MessageRow`。
  - `computeItemKey(index, msg)`：生成稳定 key，优先使用消息 id。
- **关键逻辑**
  - 首次对齐到最后一条消息；
  - 仅在贴底时自动跟随新消息；
  - 当最后一条不是 agent 且正在加载时显示 `ChatTypingFooter`。

### `src/components/chat/messages/MessageRow.jsx`
- **职责**：单条消息渲染（头像、内容、工具步骤、问卷卡、思考状态），并通过 `memo` 优化滚动性能。
- **关键方法/逻辑**
  - `MessageRow(props)`：单行消息组件。
  - `isLastAgent`：判断是否需要展示“思考中”指示器。
  - `useMemo(parseAgentQuestionnaire(...))`：仅对 agent 消息解析问卷，减少重复计算。
  - `questionnaireKey`：确保问卷 spec 变化时正确重建表单组件。
  - 工具步骤展示：只显示 `tool_call`，并根据 `status` 展示执行中/已完成。

## UI 子组件

### `src/components/chat/ui/ChatHeader.jsx`
- **职责**：顶部栏（标题、余额、模型切换、在线状态、清空历史按钮）。
- **关键逻辑**
  - 按当前模型显示余额；
  - 若存在 `consoleUrl` 则余额块可点击跳转；
  - 模型下拉禁用未配置模型；
  - 根据 `isLoading` 与消息数量禁用“清空历史”。

### `src/components/chat/ui/ChatTypingFooter.jsx`
- **职责**：列表底部“助手输入中”占位动画。
- **方法/组件**
  - `ChatTypingFooter()`：输出三点跳动动画的 agent 样式消息行。

### `src/components/chat/ui/ChatWelcome.jsx`
- **职责**：首次进入或空消息状态下的欢迎说明。
- **方法/组件**
  - `ChatWelcome()`：展示欢迎 icon、标题和功能提示文案。

### `src/components/chat/ui/ChatToast.jsx`
- **职责**：顶部轻提示组件（如模型切换成功/失败）。
- **方法/组件**
  - `ChatToast({ toast, onDismiss })`：
    - 无 toast 文本时不渲染；
    - 按 `variant` 拼接样式类；
    - 提供关闭按钮触发 `onDismiss`。

