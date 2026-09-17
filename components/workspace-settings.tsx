"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bell, Check, Copy, Link, Loader2, LogOut, Mail, Plug, Settings2, Shield, Trash2, User, UserPlus, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { useMemberProfile, useWorkspace } from "./workspace-context";
import { localApi } from "@/lib/client-api";
import { IntegrationSettings } from "./integration-settings";
import { UserAvatar } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { NotificationPreferences } from "./notification-preferences";

export function WorkspaceSettings({ sessionToken, profile, security, sound, onToggleSound, onClose, onLogout }: { sessionToken: string; profile: ReactNode; security: ReactNode; sound: boolean; onToggleSound: () => void; onClose: () => void; onLogout: () => void }) {
  const workspace = useWorkspace();
  const [tab, setTab] = useState("profile");
  const [notice, setNotice] = useState("");
  const revoke = useMutation(api.auth.revokeOtherSessions);
  return <Dialog title="Settings" className="settings-dialog" onClose={onClose}><div className="settings-layout"><nav className="settings-nav"><span>ACCOUNT</span><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><User size={15} />My profile</button><button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")}><Shield size={15} />Security</button><button className={tab === "notifications" ? "active" : ""} onClick={() => setTab("notifications")}><Bell size={15} />Notifications</button><span>{workspace.name}</span><button className={tab === "workspace" ? "active" : ""} onClick={() => setTab("workspace")}><Settings2 size={15} />Workspace</button><button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}><Users size={15} />Members & invites</button><button className={tab === "integrations" ? "active" : ""} onClick={() => setTab("integrations")}><Plug size={15} />Integrations</button><button className="settings-logout" onClick={onLogout}><LogOut size={15} />Sign out</button></nav><div className="settings-body">
    {tab === "profile" && <><h3>My profile</h3>{profile}</>}
    {tab === "security" && <><h3>Security</h3>{security}<div className="settings-section"><h4>Active sessions</h4><button className="ghost-button" onClick={async () => { try { await revoke({ sessionToken }); setNotice("Signed out on all other devices"); } catch { setNotice("Could not sign out other devices"); } }}>Sign out other devices</button>{notice && <p className="notice">{notice}</p>}</div></>}
    {tab === "notifications" && <><h3>Notifications</h3><label className="notification-setting"><span>Notification sound</span><input type="checkbox" role="switch" checked={sound} onChange={onToggleSound} /></label><NotificationPreferences sessionToken={sessionToken} /></>}
    {tab === "workspace" && <WorkspaceGeneral sessionToken={sessionToken} />}
    {tab === "members" && <WorkspaceMembers sessionToken={sessionToken} beforeOpenProfile={onClose} />}
    {tab === "integrations" && <IntegrationSettings sessionToken={sessionToken} />}
  </div></div></Dialog>;
}

function WorkspaceGeneral({ sessionToken }: { sessionToken: string }) {
  const workspace = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState("");
  const update = useMutation(api.workspaces.update);
  const create = useMutation(api.workspaces.create);
  const admin = ["owner", "admin"].includes(workspace.role);
  return <><h3>Workspace</h3><form className="stack-form" onSubmit={async e => { e.preventDefault(); try { await update({ sessionToken, teamId: workspace._id, name }); setNotice("Workspace updated"); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save"); } }}><label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={60} disabled={!admin} /></label><label>Workspace URL<input value={`${typeof window !== "undefined" ? window.location.origin : ""}/${workspace.slug}`} readOnly /></label>{admin && <button className="primary-button compact">Save changes</button>}</form>{notice && <p className="notice">{notice}</p>}<div className="settings-section"><h4>Create another workspace</h4><form className="stack-form" onSubmit={async e => { e.preventDefault(); try { const result = await create({ sessionToken, name: newName }); window.location.href = `/${result.slug}`; } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create workspace"); } }}><label>Name<input value={newName} onChange={e => setNewName(e.target.value)} required placeholder="New workspace" maxLength={60} /></label><button className="ghost-button compact">Create workspace</button></form></div></>;
}

export function WorkspaceMembers({ sessionToken, beforeOpenProfile }: { sessionToken: string; beforeOpenProfile?: () => void }) {
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const admin = ["owner", "admin"].includes(workspace.role);
  const members = useQuery(api.workspaces.members, { sessionToken, teamId: workspace._id });
  const invitations = useQuery(api.workspaces.invitations, admin ? { sessionToken, teamId: workspace._id } : "skip") as Doc<"workspaceInvites">[] | undefined;
  const createInvite = useMutation(api.workspaces.createInvite);
  const sendEmail = (values: { sessionToken: string; teamId: Id<"teams">; email: string; role: "admin" | "member" | "viewer" }) => localApi<{ inviteLink: string; sent: boolean }>(`/api/workspace/invites?teamId=${values.teamId}`, sessionToken, { method: "POST", json: { email: values.email, role: values.role } });
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const removeMember = useMutation(api.teams.removeMember);
  const updateRole = useMutation(api.teams.updateRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "viewer">("member");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setNotice(""); try { await fn(); } catch (error) { setNotice(error instanceof Error ? error.message : "Action failed"); } finally { setBusy(false); } };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setNotice("Clipboard unavailable. Select and copy the invitation link."); } };
  return <><h3>Members & invitations</h3>{admin && <><form className="invite-workspace-form" onSubmit={e => { e.preventDefault(); void attempt(async () => { const result = await sendEmail({ sessionToken, teamId: workspace._id, email, role }); setLink(result.inviteLink); setNotice(result.sent ? `Invitation emailed to ${email}` : "Invitation created. Email delivery is unavailable; share the link below."); if (result.sent) setEmail(""); }); }}><label>Email<input type="email" placeholder="teammate@company.com" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Role<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></label><button className="primary-button compact" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Mail size={15} />}Invite by email</button></form><button className="ghost-button compact" disabled={busy} onClick={() => attempt(async () => { const result = await createInvite({ sessionToken, teamId: workspace._id, role }); setLink(`${window.location.origin}/join/${result.token}`); })}><Link size={14} />Create invite link</button>{link && <div className="invite-link"><input aria-label="Invitation link" value={link} readOnly /><button className="icon-button" title="Copy invite link" aria-label="Copy invite link" onClick={() => copy(link)}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>}</>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="workspace-member-list">{members === undefined && <ContentSkeleton kind="chat" rows={4} label="Loading members" />}{members?.map(member => <div className="workspace-member" key={member._id}><button className="member-profile-trigger" onClick={() => { beforeOpenProfile?.(); openMember(member.email); }} aria-label={`View ${member.name} profile`}><UserAvatar user={member} /><span><strong>{member.name}</strong><small>{member.email}</small></span></button>{admin && member.role !== "owner" ? <><select aria-label={`Role for ${member.name}`} value={member.role} onChange={e => attempt(() => updateRole({ sessionToken, teamId: workspace._id, memberId: member._id, role: e.target.value as typeof role }))}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select><button className="icon-button" aria-label={`Remove ${member.name}`} title="Remove member" onClick={() => { if (window.confirm(`Remove ${member.name} from ${workspace.name}?`)) void attempt(() => removeMember({ sessionToken, teamId: workspace._id, memberId: member._id })); }}><Trash2 size={14} /></button></> : <span className="role-label">{member.role}</span>}</div>)}</div>
    {!!invitations?.length && <div className="settings-section"><h4>Active invitations</h4>{invitations.map(invite => <div className="pending-invitation" key={invite._id}><UserPlus size={14} /><div><strong>{invite.email || "Shareable link"}</strong><small>{invite.role} · Expires {new Date(invite.expiresAt).toLocaleDateString()}</small></div><button className="icon-button" title="Copy invitation" aria-label="Copy invitation" onClick={() => copy(`${window.location.origin}/join/${invite.token}`)}><Copy size={14} /></button><button className="icon-button" title="Revoke invitation" aria-label="Revoke invitation" onClick={() => attempt(() => revokeInvite({ sessionToken, inviteId: invite._id }))}><Trash2 size={14} /></button></div>)}</div>}
  </>;
}
