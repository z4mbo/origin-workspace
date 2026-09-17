"use client";

import { useState } from "react";

export type AvatarIdentity = { name?: string; username?: string; email?: string; avatarUrl?: string | null };
export const memberName = (user: AvatarIdentity) => user.username || user.email?.split("@")[0] || user.name || "Member";

export function UserAvatar({ user, size = "normal", className = "" }: { user: AvatarIdentity; size?: "normal" | "small"; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const label = user.username || user.name || user.email || "O";
  const letters = label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const classes = `avatar origin-user-avatar ${size === "small" ? "small" : ""} ${className}`;
  return user.avatarUrl && failedUrl !== user.avatarUrl
    ? <img className={`${classes} image`} src={user.avatarUrl} onError={() => setFailedUrl(user.avatarUrl || "")} alt="" />
    : <span className={classes} aria-hidden="true">{letters || "O"}</span>;
}
