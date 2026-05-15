/**
 * 聊天模块入口。
 *
 * 目录约定：
 * - lib/        请求、常量、SSE 流处理（无 React UI）
 * - hooks/      可复用 React 逻辑
 * - questionnaire/  助手消息内嵌问卷（解析 + 卡片）
 * - ui/         头部、欢迎页、列表脚注等展示组件
 * - messages/   消息列表与单行
 */

export { API_URL } from "./lib/constants.js";
export {
  fetchModels,
  fetchBalances,
  postSwitchModel,
  postChat,
} from "./lib/api.js";
export { QUICK_ACTIONS } from "./lib/quickActions.js";
export { handleChatStreamEvent } from "./lib/streamHandler.js";

export { useMarkdownContent } from "./hooks/useMarkdownContent.jsx";

export {
  parseAgentQuestionnaire,
  normalizeQuestionnaireSpec,
} from "./questionnaire/parseAgentQuestionnaire.js";
export { QuestionnaireCard } from "./questionnaire/QuestionnaireCard.jsx";

export { ChatHeader } from "./ui/ChatHeader.jsx";
export { ChatWelcome } from "./ui/ChatWelcome.jsx";
export { ChatTypingFooter } from "./ui/ChatTypingFooter.jsx";

export { ChatMessageList } from "./messages/ChatMessageList.jsx";
export { MessageRow } from "./messages/MessageRow.jsx";
