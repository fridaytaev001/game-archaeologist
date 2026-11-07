// Minimal client for Meta's OpenAI-compatible chat API.

export const META_BASE_URL = "https://api.meta.ai/v1";
export const META_MODEL = "muse-spark-1.3";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatResult = {
  message: Message;
  finishReason: string;
  usage: Record<string, unknown> | undefined;
};

export function loadApiKey(): string {
  try {
    process.loadEnvFile(".env");
  } catch {
    // A key already set in the environment is fine too.
  }
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new Error("META_API_KEY is empty. Add it to .env.");
  return key;
}

export async function chat(
  apiKey: string,
  messages: Message[],
  tools?: Tool[],
  reasoningEffort?: "low" | "medium" | "high",
): Promise<ChatResult> {
  const response = await fetch(`${META_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: META_MODEL,
      messages,
      ...(tools ? { tools } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${text.slice(0, 800)}`);
  const body = JSON.parse(text);
  const choice = body.choices?.[0];
  if (!choice) throw new Error(`Unexpected response: ${text.slice(0, 800)}`);
  return { message: choice.message, finishReason: choice.finish_reason, usage: body.usage };
}
