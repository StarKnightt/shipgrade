// Dev probe: checks the configured LLM can do JSON mode and tool calling with
// the real PayPal toolkit schemas. Prints status only, never keys.
import { resolveLlm } from "../lib/llm-config";
import { createDryRunExecutor } from "../lib/paypal/toolkit";

async function main() {
  const llm = resolveLlm();
  if (!llm) {
    console.log("No LLM configured (set GROQ_API_KEY or OPENAI_API_KEY).");
    return;
  }
  console.log(`provider=${llm.provider} model=${llm.model} agentModel=${llm.agentModel}`);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` };

  const json = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: llm.model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: 'Reply with JSON {"ok": true}' }],
    }),
  });
  console.log(`json mode: ${json.status} ${json.ok ? "" : (await json.text()).slice(0, 300)}`);

  const executor = await createDryRunExecutor();
  const tools = executor.tools();
  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: llm.agentModel,
      tool_choice: "auto",
      tools,
      messages: [{ role: "user", content: 'Create a PayPal product named "Probe" of type SERVICE.' }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`tool calling: ${res.status} ${body.slice(0, 600)}`);
    return;
  }
  const msg = JSON.parse(body).choices?.[0]?.message;
  console.log(`tool calling: ${res.status} calls=${(msg?.tool_calls ?? []).map((c: { function: { name: string } }) => c.function.name).join(",") || "none"}`);
}

main();
