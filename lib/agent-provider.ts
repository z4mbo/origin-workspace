import { z } from "zod";
import type { AgentSettings } from "./agent-settings";

type RecordValue = Record<string, unknown>;
type Message = { role: "user" | "assistant"; content: string };
type Tool = { name: string; description: string; inputSchema: RecordValue };
type Options = { settings: AgentSettings; key: string; messages: Message[]; instructions: string; tools: Tool[]; signal: AbortSignal; onText: (text: string) => void; callTool: (id: string, name: string, args: unknown) => Promise<string>; check: () => Promise<void>; fetcher?: typeof fetch };
const endpoints = { openai: "https://api.openai.com/v1/responses", anthropic: "https://api.anthropic.com/v1/messages", openrouter: "https://openrouter.ai/api/v1/chat/completions" };
const responseShape = z.object({}).passthrough();
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter((item): item is RecordValue => !!item && typeof item === "object") : [];

// The provider protocol varies; authorization and tool execution do not.
export async function runProvider(options: Options) {
  const { settings: s, key, instructions, tools, signal, callTool, check, onText } = options;
  const history: RecordValue[] = options.messages.map(message => ({ ...message }));
  let text = "";
  for (let step = 0; step < 20; step++) {
    await check();
    const functions = tools.map(tool => ({ name: tool.name, description: tool.description, parameters: { type: "object", ...tool.inputSchema } }));
    let body: RecordValue;
    if (s.provider === "openai") body = { model: s.model, instructions, input: history, tools: functions.map(tool => ({ type: "function", ...tool, strict: false })), store: false, include: ["reasoning.encrypted_content"], max_output_tokens: 8192, ...(s.reasoning !== "default" ? { reasoning: { effort: s.reasoning } } : {}) };
    else if (s.provider === "anthropic") body = { model: s.model, system: instructions, messages: history, tools: functions.map(({ parameters, ...tool }) => ({ ...tool, input_schema: parameters })), max_tokens: 8192, ...(s.reasoning !== "default" && s.reasoning !== "none" ? { thinking: { type: "adaptive" }, output_config: { effort: s.reasoning } } : s.reasoning === "none" ? { thinking: { type: "disabled" } } : {}) };
    else body = { model: s.model, messages: [{ role: "system", content: instructions }, ...history], tools: functions.map(tool => ({ type: "function", function: tool })), max_tokens: 8192, ...(s.reasoning !== "default" ? { reasoning: s.reasoning === "none" ? { enabled: false } : { effort: s.reasoning } } : {}) };
    const response = await (options.fetcher || fetch)(endpoints[s.provider], { method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json", ...(s.provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) });
    // Never relay provider bodies: an upstream error can contain credentials or data.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${s.provider} returned ${response.status}. Check the API key, model, reasoning support and account limits in Agent settings.`); }
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("Provider response is too large");
    const result = responseShape.parse(JSON.parse(raw));
    await check();
    const calls: { id: string; name: string; args: unknown }[] = [];
    if (s.provider === "openai") {
      const output = records(result.output);
      history.push(...output);
      for (const item of output) {
        if (item.type === "message") text += records(item.content).filter(c => c.type === "output_text").map(c => String(c.text || "")).join("");
        if (item.type === "function_call") calls.push({ id: String(item.call_id), name: String(item.name), args: JSON.parse(String(item.arguments)) });
      }
      if (result.status === "incomplete") throw new Error("Provider output was truncated. Retry with a shorter request.");
    } else if (s.provider === "anthropic") {
      const content = records(result.content);
      history.push({ role: "assistant", content });
      text += content.filter(c => c.type === "text").map(c => String(c.text || "")).join("");
      for (const item of content) if (item.type === "tool_use") calls.push({ id: String(item.id), name: String(item.name), args: item.input });
      if (result.stop_reason === "max_tokens") throw new Error("Provider output was truncated. Retry with a shorter request.");
    } else {
      const choice = records(result.choices)[0];
      const message = choice?.message as RecordValue | undefined;
      if (!message) throw new Error("Provider returned no response");
      history.push(message);
      text += typeof message.content === "string" ? message.content : "";
      for (const item of records(message.tool_calls)) { const fn = item.function as RecordValue; calls.push({ id: String(item.id), name: String(fn.name), args: JSON.parse(String(fn.arguments)) }); }
      if (choice.finish_reason === "length") throw new Error("Provider output was truncated. Retry with a shorter request.");
    }
    if (text.length > 180000) throw new Error("Agent response is too long");
    onText(text);
    if (!calls.length) { if (!text.trim()) throw new Error("Provider returned an empty answer"); return text; }
    if (calls.length > 20) throw new Error("Too many tool calls");
    const results: RecordValue[] = [];
    for (const call of calls) {
      await check();
      let output: string;
      try { output = await callTool(call.id, call.name, call.args); } catch (error) { output = JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" }); }
      if (s.provider === "openai") history.push({ type: "function_call_output", call_id: call.id, output });
      else if (s.provider === "anthropic") results.push({ type: "tool_result", tool_use_id: call.id, content: output });
      else history.push({ role: "tool", tool_call_id: call.id, content: output });
    }
    if (results.length) history.push({ role: "user", content: results });
  }
  throw new Error("Agent reached the 20-step limit. Continue with a smaller request.");
}
