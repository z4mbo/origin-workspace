"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Settings2, Trash2 } from "lucide-react";

export function TaskActionsMenu({ title, canEdit, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onDelete, onError }: {
  title: string; canEdit: boolean; canMoveLeft: boolean; canMoveRight: boolean;
  onMoveLeft: () => Promise<unknown>; onMoveRight: () => Promise<unknown>;
  onDelete: () => Promise<unknown>; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const height = menu.current?.offsetHeight || 110;
    setPosition({ left: Math.max(8, Math.min(bounds.right - 170, window.innerWidth - 178)), top: bounds.bottom + height + 8 < window.innerHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4) });
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); };
  }, [open]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); setOpen(false); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not update issue"); }
    finally { setBusy(false); }
  };
  if (!canEdit) return null;
  return <div ref={root} className={`task-actions task-menu ${open ? "is-open" : ""}`} onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } }}>
    <button type="button" className="icon-button" aria-label={`Issue options for ${title}`} title="Issue options" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}><Settings2 size={14} /></button>
    {open && createPortal(<div ref={menu} role="menu" aria-label={`Options for ${title}`} className="origin-dropdown task-options" style={position}>
      <button role="menuitem" disabled={busy || !canMoveLeft} onClick={() => void run(onMoveLeft)}><ArrowLeft size={14} />Move left</button>
      <button role="menuitem" disabled={busy || !canMoveRight} onClick={() => void run(onMoveRight)}><ArrowRight size={14} />Move right</button>
      <button role="menuitem" className="danger-text" disabled={busy} onClick={() => { if (window.confirm(`Delete "${title}"?`)) void run(onDelete); }}><Trash2 size={14} />Delete issue</button>
    </div>, document.body)}
  </div>;
}
