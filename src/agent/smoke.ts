// Checks that the Meta API works, including a full tool-calling round trip.
// Run: node src/agent/smoke.ts
import { chat, loadApiKey, type Message, type Tool } from "./meta.ts";

const key = loadApiKey();

const plain = await chat(key, [{ role: "user", content: "Reply with exactly: ready" }]);
console.log("plain reply:", plain.message.content);
console.log("plain usage:", JSON.stringify(plain.usage));

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_memory",
      description: "Read one byte of emulator memory at a hex address.",
      parameters: {
        type: "object",
        properties: { address: { type: "string", description: "Hex address, like 0x300" } },
        required: ["address"],
      },
    },
  },
];

const messages: Message[] = [
  {
    role: "user",
    content: "Use read_memory to read address 0x300, then tell me the value you got.",
  },
];

const first = await chat(key, messages, tools);
console.log("tool finish reason:", first.finishReason);
console.log("tool calls:", JSON.stringify(first.message.tool_calls));

const call = first.message.tool_calls?.[0];
if (!call) {
  console.log("NO TOOL CALL. Reply was:", first.message.content);
  process.exit(1);
}

messages.push(first.message);
messages.push({ role: "tool", tool_call_id: call.id, content: "0x2a" });

const second = await chat(key, messages, tools);
console.log("after tool result:", second.message.content);
console.log("tool usage:", JSON.stringify(second.usage));
