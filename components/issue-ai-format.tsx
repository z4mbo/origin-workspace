"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { localApi } from "@/lib/client-api";
import { formattedIssueText } from "@/lib/issue-format";
import { useWorkspace } from "./workspace-context";

export function IssueAiFormat({ sessionToken, projectId, text, disabled, onApply }: { sessionToken: string; projectId: string; text: string; disabled?: boolean; onApply: (text: string) => void }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const original = useRef("");
  const currentText = useRef(text); currentText.current = text;
  const version = useRef(0);
  const job = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stop = () => {
    version.current++; clearTimeout(timer.current);
    if (job.current) void localApi("/api/agent", sessionToken, { method: "POST", json: { op: "stop", teamId: workspace._id, jobId: job.current } }).catch(() => {});
    job.current = undefined; setBusy(false);
  };
  useEffect(() => () => { version.current++; clearTimeout(timer.current); if (job.current) void localApi("/api/agent", sessionToken, { method: "POST", json: { op: "stop", teamId: workspace._id, jobId: job.current } }).catch(() => {}); }, [sessionToken, workspace._id]);
  const generate = async () => {
    if (busy || disabled || !text.trim()) return;
    setBusy(true); setError(""); setPreview(""); original.current = text;
    const request = ++version.current;
    try {
      const result = await localApi<{ threadId: string; jobId: string }>("/api/agent", sessionToken, { method: "POST", json: { op: "format", teamId: workspace._id, projectId, text, consent: true } });
      if (version.current !== request) { void localApi("/api/agent", sessionToken, { method: "POST", json: { op: "stop", teamId: workspace._id, jobId: result.jobId } }).catch(() => {}); return; }
      job.current = result.jobId;
      const poll = async () => {
        try {
          const data = await localApi<{ jobs: { id: string; status: string; response: string; error?: string }[] }>(`/api/agent?teamId=${workspace._id}&threadId=${result.threadId}`, sessionToken);
          if (version.current !== request) return;
          const state = data.jobs.find(item => item.id === result.jobId);
          if (state?.status === "completed") { setPreview(formattedIssueText(state.response)); job.current = undefined; setBusy(false); return; }
          if (state && ["failed", "cancelled"].includes(state.status)) throw new Error(state.error || "Formatting stopped");
          timer.current = setTimeout(() => void poll(), 1500);
        } catch (e) { if (version.current === request) { setError(e instanceof Error ? e.message : "Could not reformat issue"); setBusy(false); job.current = undefined; } }
      };
      void poll();
    } catch (e) { if (version.current === request) { setError(e instanceof Error ? e.message : "Could not reformat issue"); setBusy(false); } }
  };
  const stale = !!preview && text !== original.current;
  return <div className="issue-ai-format">
    <button type="button" className="icon-button issue-ai-trigger" title="Reformat with AI" aria-label="Reformat issue description with AI" aria-expanded={open} disabled={disabled || !text.trim()} onClick={() => { if (open) stop(); setOpen(!open); }}><Sparkles size={15} /></button>
    {open && <section className="issue-ai-preview" aria-label="AI description preview">
      <header><span><Sparkles size={14} />Reformat description</span><button type="button" className="icon-button" aria-label="Close AI preview" onClick={() => { stop(); setOpen(false); }}><X size={14} /></button></header>
      {preview ? <textarea aria-label="Reformatted description" value={preview} rows={6} onChange={event => setPreview(event.target.value)} /> : <p className="muted">The description will be sent to your workspace's AI provider. Review the result before replacing your text.</p>}
      {stale && <p className="notice" role="status">Your description changed. Regenerate to keep your latest edits.</p>}
      {error && <p className="notice danger" role="alert">{error}</p>}
      <footer><button type="button" className="ghost-button compact" disabled={busy || disabled} onClick={() => void generate()}>{busy ? <Loader2 size={14} className="spin" /> : preview ? <RotateCcw size={14} /> : <Sparkles size={14} />}{busy ? "Reformatting..." : preview ? "Regenerate" : "Reformat"}</button>
        {preview && <button type="button" className="primary-button compact" disabled={busy || disabled || stale || !preview.trim()} onClick={() => { if (currentText.current !== original.current) { setError("Description changed. Regenerate first."); return; } onApply(preview); setOpen(false); setPreview(""); }}><Check size={14} />Apply</button>}</footer>
    </section>}
  </div>;
}
