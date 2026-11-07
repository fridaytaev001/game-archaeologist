// Checks whether the Meta API accepts a reasoning_effort setting.
// Run: node src/agent/effort.ts
import { loadApiKey, META_BASE_URL, META_MODEL } from "./meta.ts";

const key = loadApiKey();
for (const effort of ["low", "high"]) {
  const response = await fetch(`${META_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: META_MODEL,
      reasoning_effort: effort,
      messages: [{ role: "user", content: "How many primes are below 60? Reply with the number only." }],
    }),
  });
  const body = await response.json();
  console.log(
    effort,
    response.status,
    body.choices?.[0]?.message?.content,
    JSON.stringify(body.usage?.completion_tokens_details ?? body.error ?? body).slice(0, 300),
  );
}
