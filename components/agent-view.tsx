"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "convex/react";
import Markdown from "react-markdown";
import { ArrowUp, Box, Check, ChevronDown, CircleDot, Copy, Download, History, Laptop, Loader2, MousePointer2, Paperclip, Plus, Search, Settings, Square, Unplug, X, KeyRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { localApi } from "@/lib/client-api";
import { agentSetupCommands, type AgentShell } from "@/lib/agent-setup";
import type { Id } from "@/convex/_generated/dataModel";
import { ContentSkeleton } from "./content-skeleton";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";
import { ProjectIcon } from "./project-icon";
import { AgentSettings } from "./agent-settings";
import type { AgentSettings as SettingsValue } from "@/lib/agent-settings";
import { VaultPanel } from "./project-library";

type Device = { id: string; name: string; seen: number; expires: number; userId?: string };
type Job = { id: string; prompt: string; response: string; status: string; error?: string; created: number };
type Approval = { id: string; jobId: string; args: string; status: string; result?: string | null };
type Snapshot = { devices: Device[]; threads: { id: string; title: string; updated: number }[]; jobs: Job[]; approvals: Approval[]; settings: SettingsValue & { hasApiKey: boolean }; canConfigure: boolean; userId: string };
const suggestions = [
  { icon: Box, title: "Start a project", prompt: "Help me turn an idea into a project and a set of actionable issues. Ask me what you need to get started." },
  { icon: Search, title: "Review my work", prompt: "Review my open issues. Summarize priorities and overdue work, and suggest what I should tackle next." },
  { icon: CircleDot, title: "Triage the backlog", prompt: "Review the selected project's backlog, or ask me which project. Suggest clearer titles, priorities and next steps before making changes." },
];

export function AgentView({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const [data, setData] = useState<Snapshot>();
  const [threadId, setThreadId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [history, setHistory] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; text: string }>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const currentThread = useRef(threadId); currentThread.current = threadId;
  const refresh = useCallback(async () => {
    const requested = threadId;
    try {
      const next = await localApi<Snapshot>(`/api/agent?teamId=${workspace._id}${threadId ? `&threadId=${threadId}` : ""}`, sessionToken);
      if (requested === currentThread.current) setData(next);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load Agent"); }
  }, [sessionToken, workspace._id, threadId]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 2000); return () => clearInterval(timer); }, [refresh]);
  const latest = data?.jobs.at(-1);
  useEffect(() => { setConsent(false); }, [data?.settings.mode, data?.settings.provider, data?.settings.sharedDeviceId]);
  const running = latest && ["queued", "running", "waiting"].includes(latest.status);
  const device = data?.devices.find(item => item.id === (data.settings.sharedDeviceId || deviceId)) || data?.devices.find(item => !item.id.startsWith("api:"));
  const online = data?.settings.enabled && (data.settings.mode === "api" ? data.settings.hasApiKey : !!device && device.seen > Date.now() - 30000);
  const action = async (body: Record<string, unknown>) => {
    setNotice("");
    try { const result = await localApi<{ threadId?: string }>("/api/agent", sessionToken, { method: "POST", json: { ...body, teamId: workspace._id } }); await refresh(); return result; }
    catch (error) { setNotice(error instanceof Error ? error.message : "Agent request failed"); return null; }
  };
  const send = async (consented = consent) => {
    if (!prompt.trim() || busy || running) return;
    if (!data?.settings.enabled) { setNotice("Agent is disabled. Ask a workspace admin to enable it."); return; }
    if (!consented) { setConsentOpen(true); return; }
    if (!online) { setConnecting(true); return; }
    setBusy(true);
    const text = attachment ? `${prompt}\n\n<attached-file name=${JSON.stringify(attachment.name)}>\n${attachment.text}\n</attached-file>` : prompt;
    if (text.length > 40000) { setNotice("Shorten your message or remove the attachment (40,000 characters total)."); setBusy(false); return; }
    const result = await action({ op: "send", deviceId: device?.id, threadId, prompt: text, projectId: projectId || undefined, consent: true });
    if (result?.threadId) { following.current = true; setThreadId(result.threadId); setPrompt(""); setAttachment(undefined); }
    setBusy(false);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void send(); };
  useEffect(() => {
    const element = transcript.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [latest?.response, data?.jobs.length, data?.approvals.length]);
  const newChat = () => { setThreadId(undefined); setData(current => current ? { ...current, jobs: [], approvals: [] } : current); setHistory(false); setNotice(""); composer.current?.focus(); };
  return <section className={`agent-view ${data?.jobs.length ? "has-conversation" : ""}`}>
    <header className="agent-header">
      <button className="agent-thread-trigger" onClick={() => setHistory(!history)} aria-expanded={history}><span>{data?.threads.find(thread => thread.id === threadId)?.title || "New chat"}</span><ChevronDown size={13} /></button>
      <div className="agent-header-actions"><button className={`agent-connection ${online ? "online" : ""}`} onClick={() => data?.settings.mode === "api" ? data.canConfigure && setSettingsOpen(true) : setConnecting(true)} title={device?.name || "Agent connection"}><span />{!data?.settings.enabled ? "Disabled" : online ? data.settings.mode === "api" ? "Workspace API" : data.settings.sharedDeviceId ? "Workspace agent" : "Connected" : "Connect companion"}</button>{data?.canConfigure && <button className="icon-button" title="Agent settings" aria-label="Agent settings" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>}<button className="icon-button" title="New chat" aria-label="New agent chat" onClick={newChat}><Plus size={17} /></button></div>
    </header>
    {history && <div className="agent-history origin-dropdown"><div className="agent-history-head"><History size={14} /><span>Recent chats</span><button className="icon-button" aria-label="Close history" onClick={() => setHistory(false)}><X size={14} /></button></div>{data?.threads.length ? data.threads.map(thread => <button key={thread.id} onClick={() => { setThreadId(thread.id); setData(current => current ? { ...current, jobs: [], approvals: [] } : current); setHistory(false); }}><MousePointer2 size={14} /><span>{thread.title}</span></button>) : <p>No conversations yet</p>}</div>}
    <div className="agent-transcript" ref={transcript} onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
      {!data && <ContentSkeleton kind="chat" rows={3} label="Loading Agent" />}
      {data?.jobs.map(job => <div className="agent-turn" key={job.id}>
        <div className="agent-user-message"><span>You</span><p>{job.prompt}</p></div>
        <div className="agent-response"><div className="agent-response-label"><MousePointer2 size={15} /><span>Origin</span>{["running", "queued", "waiting"].includes(job.status) && <Loader2 size={13} className="spin" />}</div>
          {job.response && <div className="agent-message-text"><Markdown skipHtml allowedElements={["p", "strong", "em", "a", "ul", "ol", "li", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "hr", "br"]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{job.response}</Markdown></div>}
          {!job.response && ["queued", "running"].includes(job.status) && <span className="agent-working">{job.status === "queued" ? "Waiting for your computer..." : "Working..."}</span>}
          {data.approvals.filter(approval => approval.jobId === job.id).map(approval => <AgentProposal key={approval.id} sessionToken={sessionToken} approval={approval} available={!["cancelled", "failed"].includes(job.status)} projectName={projects?.find(project => project._id === JSON.parse(approval.args).projectId)?.name} onDecide={approved => action({ op: "decide", approvalId: approval.id, approved })} />)}
          {job.error && <p className="notice danger" role="alert">{job.error}</p>}
          {job.status === "cancelled" && <p className="agent-working">Stopped</p>}
          {job.status === "completed" && job.response && <button className="icon-button agent-copy" title="Copy response" aria-label="Copy agent response" onClick={() => void navigator.clipboard.writeText(job.response).catch(() => setNotice("Could not copy response"))}><Copy size={13} /></button>}
        </div>
      </div>)}
    </div>
    <div className="agent-compose-area">
      {!data?.jobs.length && <div className="agent-wordmark" aria-hidden="true">Origin</div>}
      {notice && <p className="notice danger" role="alert">{notice}</p>}
      <form className="agent-composer" onSubmit={submit}>
        {attachment && <div className="agent-attachment"><Paperclip size={13} /><span>{attachment.name}</span><button type="button" className="icon-button" aria-label="Remove attachment" onClick={() => setAttachment(undefined)}><X size={13} /></button></div>}
        <textarea ref={composer} autoFocus data-initial-focus aria-label="Message Origin Agent" placeholder="Ask Origin..." value={prompt} maxLength={30000} rows={3} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="agent-composer-toolbar">
          <span className="agent-model-label" title={`Reasoning: ${data?.settings.reasoning || "default"}`}>{(data?.settings.model || "gpt-6-luna") === "gpt-6-luna" ? "GPT Luna · Fast" : data?.settings.model}</span>
          <select className="agent-project-select" aria-label="Agent project" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">All projects</option>{projects?.map(project => <option key={project._id} value={project._id}>{project.name}</option>)}</select>
          <div className="agent-send-actions"><button className="icon-button" type="button" title="Attach text or Markdown" aria-label="Attach context file" onClick={() => fileInput.current?.click()}><Paperclip size={16} /></button>
            {running ? <button className="agent-send" type="button" aria-label="Stop agent" title="Stop" onClick={() => action({ op: "stop", jobId: latest.id })}><Square size={13} fill="currentColor" /></button> : <button className="agent-send" type="submit" title="Send message" aria-label="Send agent message" disabled={!prompt.trim() || busy}>{busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={16} />}</button>}
          </div>
        </div>
        <input hidden ref={fileInput} type="file" accept=".txt,.md,.json,.csv" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 20000) { setNotice("Choose a text file smaller than 20 KB"); return; } setAttachment({ name: file.name, text: await file.text() }); }} />
      </form>
      {!data?.jobs.length && <div className="agent-suggestions">{suggestions.map(item => <button key={item.title} onClick={() => { setPrompt(item.prompt); composer.current?.focus(); }}><item.icon size={17} /><span>{item.title}</span></button>)}</div>}
      {projectId && <div className="agent-context">{projects?.filter(project => project._id === projectId).map(project => <span key={project._id}><ProjectIcon project={project} />{project.name}</span>)}</div>}
    </div>
    {connecting && <AgentConnection sessionToken={sessionToken} devices={(data?.devices || []).filter(device => device.userId === data?.userId && !device.id.startsWith("api:"))} selected={deviceId} onSelect={setDeviceId} onClose={() => setConnecting(false)} onRefresh={refresh} />}
    {settingsOpen && data && <AgentSettings sessionToken={sessionToken} current={data.settings} devices={data.devices} userId={data.userId} onClose={() => setSettingsOpen(false)} onSaved={refresh} onConnect={() => { setSettingsOpen(false); setConnecting(true); }} />}
    {consentOpen && <Dialog title="Use Origin Agent" onClose={() => setConsentOpen(false)}><div className="dialog-body"><p>Your prompts and requested workspace content, including messages and documents you can access, will be sent to {data?.settings.mode === "api" ? data.settings.provider : "OpenAI"}. Vault secrets stay encrypted. Every change needs your approval.</p><p className="muted">Conversations remain private to you. {data?.settings.sharedDeviceId || data?.settings.mode === "api" ? "Usage is charged to your workspace's configured account." : "Usage counts toward your connected account."}</p><button className="primary-button" onClick={() => { setConsent(true); setConsentOpen(false); void send(true); }}>Continue</button></div></Dialog>}
  </section>;
}

function AgentProposal({ sessionToken, approval, available, projectName, onDecide }: { sessionToken: string; approval: Approval; available: boolean; projectName?: string; onDecide: (approved: boolean) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const change = JSON.parse(approval.args) as Record<string, unknown>;
  const board = useQuery(api.tasks.board, projectName && change.projectId && (change.columnId || change.taskId) ? { sessionToken, projectId: change.projectId as Id<"projects"> } : "skip");
  const labels: Record<string, string> = { projectId: "Project", columnId: "Column", taskId: "Issue", assignedToEmail: "Assignee", dueDate: "Due date", done: "Completed", title: "Title", priority: "Priority", name: "Name", description: "Description" };
  const displayValue = (key: string, value: unknown) => {
    if (key === "projectId" && projectName) return projectName;
    if (key === "columnId") return board?.columns.find(column => column._id === value)?.title || String(value);
    if (key === "taskId") return board?.tasks.find(task => task._id === value)?.title || String(value);
    return typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
  };
  const result = approval.result ? JSON.parse(approval.result) as Record<string, unknown> : null;
  return <div className="agent-proposal"><strong>{String(change.kind).replaceAll("_", " ")}</strong><dl>{Object.entries(change).filter(([key]) => key !== "kind").map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{displayValue(key, value)}</dd></div>)}</dl>{approval.status === "pending" && available ? <div className="agent-proposal-actions"><button className="ghost-button compact" disabled={busy} onClick={async () => { setBusy(true); await onDecide(false); setBusy(false); }}>Decline</button><button className="primary-button compact" disabled={busy} onClick={async () => { setBusy(true); await onDecide(true); setBusy(false); }}><Check size={14} />{change.kind === "request_vault" ? "Approve request" : "Approve change"}</button></div> : <span className="agent-working">{approval.status === "applied" ? "Applied" : !available ? "Cancelled" : approval.status === "approved" ? "Approved, applying..." : "Declined"}</span>}
    {approval.status === "applied" && change.kind === "request_vault" && <button className="ghost-button compact" onClick={() => setVaultOpen(true)}><KeyRound size={14} />Open vault privately</button>}
    {approval.status === "applied" && change.kind === "invite_member" && typeof result?.token === "string" && <a href={`/join/${result.token}`} target="_blank" rel="noreferrer">Invitation link</a>}
    {approval.status === "applied" && change.kind === "invite_member" && change.sendEmail === true && <small>{result?.sent === true ? "Email sent" : "Email delivery not confirmed. Share the invitation link."}</small>}
    {vaultOpen && <Dialog title={typeof result?.title === "string" ? result.title : "Vault"} onClose={() => setVaultOpen(false)}><div className="dialog-body"><VaultPanel projectId={change.projectId as Id<"projects">} sessionToken={sessionToken} /></div></Dialog>}
  </div>;
}

function AgentConnection({ sessionToken, devices, selected, onSelect, onClose, onRefresh }: { sessionToken: string; devices: Device[]; selected: string; onSelect: (id: string) => void; onClose: () => void; onRefresh: () => Promise<void> }) {
  const workspace = useWorkspace();
  const [pair, setPair] = useState<{ code: string; expires: number }>();
  const [write, setWrite] = useState(workspace.role !== "viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shell, setShell] = useState<AgentShell>(() => /Win/i.test(navigator.platform) ? "powershell" : "unix");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);
  const commands = agentSetupCommands(window.location.origin, shell, pair?.code);
  const expired = !!pair && now >= pair.expires;
  const makePair = async () => {
    setBusy(true); setError("");
    try { setPair(await localApi("/api/agent", sessionToken, { method: "POST", json: { op: "pair", teamId: workspace._id, write, extended: true } })); setNow(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not pair"); }
    finally { setBusy(false); }
  };
  return <Dialog title="Connect a companion" className="agent-connection-dialog" onClose={onClose}><div className="dialog-body">
    <div className="agent-provider"><Laptop size={22} /><div><strong>Codex</strong><span>Your ChatGPT account, on your computer or private server.</span></div></div>
    <p className="muted">Install Node.js 22+ and the official Codex CLI on your computer or private server. Your login stays on that machine. Requested projects, issues, messages, assets and documents are sent to OpenAI. Vault secrets are never shared. Keep the companion running, including when using Origin from your phone.</p>
    <div className="agent-shell-tabs" role="group" aria-label="Terminal platform">{([['unix', 'macOS / Linux'], ['powershell', 'Windows PowerShell']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={shell === value} onClick={() => setShell(value)}>{label}</button>)}</div>
    <ol className="agent-setup-steps"><li><span>Download to your computer:</span><AgentCommand label="download" command={commands.download} onError={setError} /><a href="/agent/origin-agent.mjs" download="origin-agent.mjs"><Download size={14} />View companion source</a></li><li><span>Sign in to ChatGPT:</span><AgentCommand label="sign-in" command={commands.login} onError={setError} /></li><li><span>Pair this workspace:</span>{!pair && <><label className="agent-write-setting"><input type="checkbox" checked={write} disabled={workspace.role === "viewer"} onChange={event => setWrite(event.target.checked)} />Allow project and issue changes, with approval</label><button className="primary-button compact" disabled={busy} onClick={makePair}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}Get pairing command</button></>}
      {pair && <>{!expired && <AgentCommand label="pairing" command={commands.pair} onError={setError} />}<small role="status">{expired ? "This code has expired. Generate a new one." : `One use. Expires at ${new Date(pair.expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}</small><button className="ghost-button compact" disabled={busy} onClick={makePair}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}New pairing code</button></>}
    </li></ol>
    <details className="agent-reconnect"><summary>Already paired?</summary><AgentCommand label="reconnect" command={commands.resume} onError={setError} /></details>
    {!!devices.length && <div className="agent-devices">{devices.map(device => <div key={device.id}><button className="agent-device-select" onClick={() => onSelect(device.id)}><Laptop size={16} /><span>{device.name}<small>{device.seen > Date.now() - 30000 ? "Online" : "Offline"}</small></span>{selected === device.id && <Check size={14} />}</button><button className="icon-button" title="Disconnect computer" aria-label={`Disconnect ${device.name}`} disabled={busy} onClick={async () => { setBusy(true); try { await localApi("/api/agent", sessionToken, { method: "POST", json: { op: "disconnect", teamId: workspace._id, deviceId: device.id } }); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect"); } finally { setBusy(false); } }}><Unplug size={15} /></button></div>)}</div>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    <p className="agent-provider-note">For Anthropic or OpenRouter, choose API key in workspace Agent settings. Subscription connections use the official Codex CLI.</p>
  </div></Dialog>;
}

function AgentCommand({ label, command, onError }: { label: string; command: string; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [command]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <div className="agent-pair-command"><code>{command}</code><button type="button" className="icon-button" title={`Copy ${label} command`} aria-label={`Copy ${label} command`} onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); } catch { onError("Select the command to copy it"); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>;
}
