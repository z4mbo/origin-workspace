"use client";
import { useState } from "react";
import { KeyRound, Laptop, Loader2, Server } from "lucide-react";
import type { AgentSettings as Settings } from "@/lib/agent-settings";
import { localApi } from "@/lib/client-api";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";

export function AgentSettings({ sessionToken, current, devices, userId, onClose, onSaved, onConnect }: {
  sessionToken: string; current: Settings & { hasApiKey: boolean }; devices: { id: string; name: string; userId?: string }[]; userId?: string;
  onClose: () => void; onSaved: () => Promise<void>; onConnect: () => void;
}) {
  const workspace = useWorkspace();
  const [settings, setSettings] = useState<Settings>(current);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (value: Partial<Settings>) => setSettings(old => ({ ...old, ...value }));
  return <Dialog title="Agent settings" className="agent-settings-dialog" onClose={onClose}><form className="stack-form agent-settings-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try { await localApi("/api/agent", sessionToken, { method: "POST", json: { op: "settings", teamId: workspace._id, settings, ...(key ? { apiKey: key } : removeKey ? { apiKey: "" } : {}) } }); setKey(""); await onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save settings"); }
    finally { setBusy(false); }
  }}>
    <label className="agent-settings-toggle"><span>Enable Agent</span><input type="checkbox" role="switch" checked={settings.enabled} onChange={event => set({ enabled: event.target.checked })} /></label>
    <div className="agent-runtime-options" role="group" aria-label="Agent runtime">
      <button type="button" aria-pressed={settings.mode === "companion" && settings.location === "local"} onClick={() => set({ mode: "companion", location: "local", provider: "openai", model: "gpt-6-luna", reasoning: "default" })}><Laptop size={18} />Local</button>
      <button type="button" aria-pressed={settings.mode === "companion" && settings.location === "server"} onClick={() => set({ mode: "companion", location: "server", provider: "openai", model: "gpt-6-luna", reasoning: "default" })}><Server size={18} />Own server</button>
      <button type="button" aria-pressed={settings.mode === "api"} onClick={() => set({ mode: "api" })}><KeyRound size={18} />API key</button>
    </div>
    {settings.mode === "api" ? <>
      <label>Provider<select value={settings.provider} onChange={event => { const provider = event.target.value as Settings["provider"]; set({ provider, model: provider === "openai" ? "gpt-6-luna" : provider === "openrouter" ? "openai/gpt-6-luna" : "claude-sonnet-4-6", reasoning: "default" }); setKey(""); }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option></select></label>
      <label>API key<input type="password" autoComplete="new-password" value={key} onChange={event => { setKey(event.target.value); setRemoveKey(false); }} placeholder={current.hasApiKey && settings.provider === current.provider ? "Stored securely. Leave blank to keep." : "Your provider API key"} /></label>
      {current.hasApiKey && <label className="agent-write-setting"><input type="checkbox" checked={removeKey} onChange={event => setRemoveKey(event.target.checked)} />Remove stored key</label>}
      <p className="muted">Provider usage is billed to this key and shared by workspace members. Keys are encrypted on the Origin server and never returned to members.</p>
    </> : <>
      <label>Workspace companion<select value={settings.sharedDeviceId || ""} onChange={event => set({ sharedDeviceId: event.target.value || null })}><option value="">Each member connects their own</option>{devices.filter(device => !device.id.startsWith("api:") && (device.userId === userId || device.id === current.sharedDeviceId)).map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
      <button type="button" className="ghost-button compact" onClick={onConnect}><Laptop size={15} />Connect a computer or server</button>
      <p className="muted">A shared companion uses its owner's Codex allowance. Each member keeps their own Origin permissions and private conversations. Keep the connected machine running.</p>
    </>}
    <div className="agent-settings-fields"><label>Model<input list="agent-models" value={settings.model} onChange={event => set({ model: event.target.value })} required maxLength={120} autoComplete="off" /><datalist id="agent-models">{(settings.mode === "companion" || settings.provider === "openai" ? ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"] : settings.provider === "openrouter" ? ["openai/gpt-6-luna", "anthropic/claude-sonnet-4.6"] : ["claude-sonnet-4-6", "claude-opus-4-6"]).map(model => <option key={model} value={model} />)}</datalist></label>
      <label>Reasoning<select value={settings.reasoning} onChange={event => set({ reasoning: event.target.value as Settings["reasoning"] })}>{["default", "none", "low", "medium", "high", "xhigh", "max"].map(value => <option key={value} value={value}>{value === "default" ? "Model default" : value}</option>)}</select></label></div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <button type="submit" className="primary-button" disabled={busy}>{busy && <Loader2 size={15} className="spin" />}Save settings</button>
  </form></Dialog>;
}
