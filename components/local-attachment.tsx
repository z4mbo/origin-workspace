"use client";
import { useEffect, useState } from "react";
import { Download, File, Loader2, RotateCw } from "lucide-react";

export function LocalAttachment({ file, sessionToken, scope }: { file: { id: string; name: string; contentType: string; size: number }; sessionToken: string; scope: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.contentType);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    setUrl(""); setError(false);
    void fetch(`/api/local-chat/files?${scope}&id=${encodeURIComponent(file.id)}`, { headers: { Authorization: `Bearer ${sessionToken}` }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Download failed"); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, scope, sessionToken, retry]);
  return <div className="local-attachment">
    <a className={`message-file ${image ? "image-attachment" : ""}`} href={url || undefined} download={file.name} aria-disabled={!url}>
      {image && url ? <img src={url} alt={file.name} loading="lazy" /> : <File size={24} />}
      <span><strong>{file.name}</strong><small>{error ? "Download unavailable" : `${Math.max(1, Math.round(file.size / 1024))} KB`}</small></span>
      {url ? <Download size={15} /> : !error && <Loader2 className="spin" size={15} />}
    </a>
    {error && <button className="icon-button" aria-label={`Retry ${file.name}`} title="Retry download" onClick={() => setRetry(value => value + 1)}><RotateCw size={14} /></button>}
  </div>;
}
