// IndexedDB 封装模块 — 聊天历史持久化
const DB_NAME = "AgentChatDB";
const DB_VERSION = 1;
const STORE_NAME = "messages";

/**
 * 打开/创建数据库
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 添加一条消息
 * @param {Object} message - { type, content, steps?, timestamp }
 * @returns {Promise<number>} 消息 id
 */
export async function addMessage(message) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const record = {
      ...message,
      timestamp: Date.now(),
    };
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * 更新一条消息（按 id）
 * @param {number} id
 * @param {Object} updates - 要合并的字段
 */
export async function updateMessage(id, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        Object.assign(record, updates);
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * 获取所有消息（按 timestamp 排序）
 * @returns {Promise<Array>}
 */
export async function getAllMessages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("timestamp");
    const request = index.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * 清空所有消息
 * @returns {Promise<void>}
 */
export async function clearAllMessages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * 获取聊天历史（用于发送给模型）
 * 仅取 user 和 agent 类型的消息，转为 role/content 格式
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function getChatHistory() {
  const messages = await getAllMessages();
  return messages
    .filter((m) => m.type === "user" || m.type === "agent")
    .filter((m) => m.content && m.content.trim())
    .map((m) => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.content,
    }));
}
