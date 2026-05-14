import { API_URL } from "./constants.js";

export async function fetchModels() {
  const res = await fetch(`${API_URL}/api/models`);
  if (!res.ok) throw new Error("models");
  return res.json();
}

export async function fetchBalances() {
  const res = await fetch(`${API_URL}/api/balance`);
  if (!res.ok) throw new Error("balance");
  return res.json();
}

export async function postSwitchModel(modelKey) {
  const res = await fetch(`${API_URL}/api/model/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelKey }),
  });
  return res.json();
}

/**
 * @param {{ message: string, history: unknown[], model: string }} body
 * @param {AbortSignal} [signal]
 */
export function postChat(body, signal) {
  return fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
