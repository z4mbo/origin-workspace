// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runProvider } from "./agent-provider";
import { formattedIssueText } from "./issue-format";
import type { AgentSettings } from "./agent-settings";

const settings: AgentSettings = { enabled: true, mode: "api", location: "server", provider: "openai", model: "example-model", reasoning: "default", sharedDeviceId: null };
const tool = { name: "origin_read", description: "Read", inputSchema: { type: "object", properties: { kind: { type: "string" } } } };
describe("Provider protocols without paid requests", () => {
  for (const provider of ["openai", "anthropic", "openrouter"] as const) it(`${provider}: carries tool results, defaults and provider reasoning across turns`, async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const thinking = { type: "reasoning", encrypted_content: "encrypted-thinking" };
    const replies = provider === "openai" ? [
      { output: [thinking, { type: "function_call", call_id: "call", name: "origin_read", arguments: '{"kind":"projects"}' }] },
      { output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }] },
    ] : provider === "anthropic" ? [
      { content: [{ type: "thinking", thinking: "thought", signature: "signature" }, { type: "tool_use", id: "call", name: "origin_read", input: { kind: "projects" } }] },
      { content: [{ type: "text", text: "Done" }] },
    ] : [
      { choices: [{ message: { role: "assistant", content: null, reasoning_details: [thinking], tool_calls: [{ id: "call", type: "function", function: { name: "origin_read", arguments: '{"kind":"projects"}' } }] } }] },
      { choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] },
    ];
    const fetcher = vi.fn(async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json(replies.shift()); }) as unknown as typeof fetch;
    const callTool = vi.fn(async () => '{"projects":[]}');
    const answer = await runProvider({ settings: { ...settings, provider }, key: "test-only-secret", messages: [{ role: "user", content: "Projects?" }], instructions: "Test", tools: [tool], signal: new AbortController().signal, onText: () => {}, check: async () => {}, fetcher, callTool });
    expect(answer).toBe("Done");
    expect(callTool).toHaveBeenCalledWith("call", "origin_read", { kind: "projects" });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).not.toHaveProperty("reasoning");
    expect(calls[0].body).not.toHaveProperty("thinking");
    expect(JSON.stringify(calls[1].body)).toContain("projects");
    expect(JSON.stringify(calls[1].body)).toContain(provider === "anthropic" ? "signature" : "encrypted-thinking");
    expect(JSON.stringify(calls)).not.toContain("test-only-secret");
  });
  it("redacts upstream errors and stops before a request when cancelled", async () => {
    const fetcher = vi.fn(async () => new Response("secret-key-and-private-data", { status: 401 })) as unknown as typeof fetch;
    const options = { settings, key: "secret-key", messages: [], instructions: "", tools: [], signal: new AbortController().signal, onText: () => {}, callTool: async () => "", check: async () => {}, fetcher };
    await expect(runProvider(options)).rejects.toThrow("openai returned 401");
    await expect(runProvider({ ...options, check: async () => { throw new Error("Stopped"); } })).rejects.toThrow("Stopped");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("unwraps formatted Markdown and refuses empty output", () => {
    expect(formattedIssueText("```markdown\n## Plan\n- Keep facts\n```")).toBe("## Plan\n- Keep facts");
    expect(() => formattedIssueText(" \n ")).toThrow(/empty/);
  });
});
