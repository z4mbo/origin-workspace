"use client";

import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Columns3,
  Copy,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  GitCommit,
  GripVertical,
  Image,
  Inbox,
  KeyRound,
  LinkIcon,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  MoreHorizontal,
  Pencil,
  PenTool,
  PhoneOff,
  Paperclip,
  Plus,
  Rocket,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/vaultCrypto";
import { MemberProfileContext, useMemberProfile, useWorkspace, type Workspace } from "./workspace-context";
import { MemberProfile } from "./member-profile";
import { useModalKeyboard } from "./use-modal-keyboard";
import { GitHubConnection } from "./github-connection";
import { RepositoryProvisioning } from "./repository-provisioning";
import { useNotifications } from "./use-notifications";
import { IssueRelations } from "./issue-relations";
import { ProjectIcon, ProjectIconPicker } from "./project-icon";
import { normalizeProjectEmoji } from "@/lib/project-emoji";
import { ProjectSortMenu } from "./project-sort-menu";
import { projectSortOptions, sortProjects, type ProjectSort } from "@/lib/project-sort";
import { useProjectPresence } from "./use-project-presence";
import { Dialog } from "./dialog";
import { IssueComposer } from "./issue-composer";
import { InboxView } from "./inbox-view";
import { CallDevices } from "./call-devices";
import { IssueFields } from "./issue-fields";
import { WorkspaceSettings, WorkspaceMembers } from "./workspace-settings";
import { AssetsPanel, VaultPanel } from "./project-library";
import { ChatView } from "./chat-shell";
import { UserAvatar } from "./user-avatar";
import { ContentSkeleton } from "./content-skeleton";
import { useContentTransition } from "./use-content-transition";
import { DrawView } from "./draw-view";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";
import Link from "next/link";
import dynamic from "next/dynamic";
import { localApi as requestLocalApi } from "@/lib/client-api";

const DocsView = dynamic(() => import("./docs-view").then(module => module.DocsView), { loading: () => <ContentSkeleton rows={6} /> });
const RoadmapView = dynamic(() => import("./planning-view").then(module => module.RoadmapView), { loading: () => <ContentSkeleton rows={6} /> });
const ReleasesView = dynamic(() => import("./planning-view").then(module => module.ReleasesView), { loading: () => <ContentSkeleton rows={6} /> });
const FeedbackView = dynamic(() => import("./feedback-view").then(module => module.FeedbackView), { loading: () => <ContentSkeleton rows={6} /> });

type AuthUser = {
  _id: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  role: "owner" | "user";
  status: "active" | "disabled";
};
type AuthSession = { sessionToken: string; user: AuthUser };
type TabKey = "board" | "repo" | "assets" | "vault" | "team" | "settings";
type MainView = "project" | "inbox" | "chat" | "voice" | "draw" | "docs" | "roadmap" | "feedback" | "releases";
type Role = "admin" | "member" | "viewer";
type Priority = "low" | "medium" | "high";
type CredentialKind = "password" | "api_key" | "secret" | "note";
type StoredCredentialKind = CredentialKind | "apk" | "file";
type AssetType = "figma" | "image" | "icon" | "font" | "document" | "apk" | "other";
type TaskAssetType = "link" | "image" | "figma" | "file" | "other";
type ProjectIconType = "default" | "emoji" | "icon" | "image";
type ProjectWithUi = Doc<"projects"> & { memberRole: string; iconUrl?: string | null; openIssueCount?: number };
type RemoteCallStream = { stream: MediaStream; screen?: MediaStream; addedAt: number };
type AvatarUser = { username?: string; name: string; email: string; avatarUrl?: string | null };
type LocalChatMessage = {
  id: string;
  authorUserId: Id<"users">;
  authorName: string;
  authorEmail: string;
  avatarUrl?: string | null;
  body: string;
  createdAt: number;
};
type LocalVoiceParticipant = {
  userId: Id<"users">;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  joinedAt: number;
  lastSeenAt: number;
};
type LocalVoiceSignal = {
  id: string;
  fromUserId: Id<"users">;
  toUserId: Id<"users">;
  kind: "offer" | "answer" | "candidate";
  payload: string;
  createdAt: number;
};
type GitHubSnapshot = {
  repo: string;
  tokenConfigured: boolean;
  commits: Array<{ sha: string; message: string; author: string; url: string; committedAt: number }>;
  commitsError: string;
  issues: Array<{ number: number; title: string; state: "open" | "closed"; url: string; author?: string; updatedAt: number }>;
  pullRequests: Array<{ number: number; title: string; state: "open" | "closed" | "merged"; url: string; author?: string; branch?: string; updatedAt: number }>;
  hosted: "origin-local";
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof Columns3 }> = [
  { key: "board", label: "Issues", icon: Columns3 },
  { key: "repo", label: "Repo", icon: GitBranch },
  { key: "assets", label: "Assets", icon: Paperclip },
  { key: "vault", label: "Vault", icon: LockKeyhole },
  { key: "team", label: "Team", icon: Users },
  { key: "settings", label: "Settings", icon: Settings2 },
];
const roles: Role[] = ["admin", "member", "viewer"];
const priorities: Priority[] = ["low", "medium", "high"];
const credentialKinds: Array<{ value: CredentialKind; label: string }> = [
  { value: "password", label: "Website login" },
  { value: "api_key", label: "API key" },
  { value: "secret", label: "Secret" },
  { value: "note", label: "Secure note" },
];
const assetTypes: AssetType[] = ["figma", "image", "icon", "font", "document", "apk", "other"];
const taskAssetTypes: TaskAssetType[] = ["link", "image", "figma", "file", "other"];
const referenceSidebarProjectOrder = [
  "Heroes",
  "Mevio",
  "Vesper",
  "operazioniimmobiliari.com",
  "Vox",
  "Vox OS",
  "Onyx",
  "Visitaly",
  "Origin",
  "Budfix",
  "Walkhero",
  "Orbit",
  "Vape",
  "Spider-X",
  "Steplock",
  "Coobra",
  "Desion",
  "Scontrini",
  "Z-Engine",
  "Veritas",
  "imbored.fun",
  "Pawcode",
  "Outfit",
  "Pulse",
  "Life Stats",
  "Elite Smurfs",
  "Image Detection",
];
const referenceProjectRank = new Map(referenceSidebarProjectOrder.map((name, index) => [name.toLowerCase(), index]));

function normalizeLaneTitle(title: string) {
  return title.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function laneTone(title: string) {
  const normalized = normalizeLaneTitle(title);
  if (normalized === "idea") return "idea";
  if (normalized === "todo") return "todo";
  if (normalized === "done") return "done";
  return "custom";
}

function taskKey(id: string) {
  return `ORI-${id.slice(-4).toUpperCase()}`;
}

function initials(nameOrEmail: string) {
  return nameOrEmail
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "O";
}
function projectInitial(name: string) {
  return (name.trim()[0] || "P").toUpperCase();
}
function displayUsername(user: Pick<AvatarUser, "username" | "name" | "email">) {
  return user.username ? `@${user.username}` : `@${user.email.split("@")[0] || user.name}`;
}
function sidebarUsername(user: Pick<AvatarUser, "username" | "name" | "email">) {
  return user.username || user.email.split("@")[0] || user.name;
}
function orderSidebarProjects(projects: ProjectWithUi[]) {
  return [...projects].sort((a, b) => {
    if (a.order !== undefined || b.order !== undefined) return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    const left = referenceProjectRank.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const right = referenceProjectRank.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });
}
function fmtDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}
function shortSha(sha: string) {
  return sha.startsWith("manual-") ? "manual" : sha.slice(0, 7);
}
function parseGitHubRepo(repoUrl?: string) {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}
function githubRepoLabel(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : "No repository";
}
function githubRepoHref(repoUrl?: string) {
  const parsed = parseGitHubRepo(repoUrl);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
}
function githubNewIssueHref(repoUrl: string | undefined, title = "", body = "") {
  const repoHref = githubRepoHref(repoUrl);
  if (!repoHref) return null;
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  const query = params.toString();
  return `${repoHref}/issues/new${query ? `?${query}` : ""}`;
}

function LoadingState({ label = "Loading" }: { label?: string }) {
  return <ContentSkeleton label={label} kind={label.includes("board") || label.includes("project") ? "board" : "list"} rows={4} />;
}
function EmptyBlock({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return (
    <div className="empty-block">
      <Icon size={22} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

async function localApi<T>(path: string, sessionToken: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${sessionToken}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify({ ...(init.json as object), sessionToken }) : init.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed");
  return payload as T;
}

function useLocalVoiceParticipants(sessionToken: string | null, enabled = true) {
  const workspace = useWorkspace();
  const [participants, setParticipants] = useState<LocalVoiceParticipant[] | undefined>(undefined);
  useEffect(() => {
    if (!sessionToken || !enabled) {
      setParticipants(undefined);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ participants: LocalVoiceParticipant[] }>(`/api/local-voice/participants?teamId=${workspace._id}`, sessionToken);
        if (alive) setParticipants(result.participants);
      } catch {
        if (alive) setParticipants([]);
      }
    };
    void load();
    const interval = window.setInterval(load, 3_000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [enabled, sessionToken, workspace._id]);
  return participants;
}

function useGitHubSnapshot(projectId: Id<"projects">, repoUrl: string | undefined, sessionToken: string, revision = 0) {
  const [snapshot, setSnapshot] = useState<GitHubSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!repoUrl) {
      setSnapshot(null);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    localApi<GitHubSnapshot>(`/api/github/repo?projectId=${projectId}`, sessionToken)
      .then((result) => {
        if (alive) setSnapshot(result);
      })
      .catch((issue) => {
        if (alive) {
          setSnapshot(null);
          setError(issue instanceof Error ? issue.message : "GitHub sync failed");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, repoUrl, sessionToken, revision]);
  return { snapshot, error, loading };
}

export function OriginWorkspace({ sessionToken, user, workspaces, onLogout }: { sessionToken: string; user: AuthUser; workspaces: Workspace[]; onLogout: () => void }) {
  const workspace = useWorkspace();
  const [activeProjectId, setActiveProjectId] = useState<Id<"projects"> | null>(null);
  const [mainView, setMainView] = useState<MainView>("project");
  const [visitedTools, setVisitedTools] = useState({ draw: false, voice: false });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragProject, setDragProject] = useState<Id<"projects"> | null>(null);
  const [projectOrder, setProjectOrder] = useState<Id<"projects">[] | null>(null);
  const [projectSort, setProjectSort] = useState<ProjectSort>("manual");
  const sortKey = `origin.project-sort.${user._id}.${workspace._id}`;
  useEffect(() => {
    try { const saved = localStorage.getItem(sortKey); setProjectSort(projectSortOptions.some(option => option.value === saved) ? saved as ProjectSort : "manual"); } catch { setProjectSort("manual"); }
  }, [sortKey]);
  const changeProjectSort = (value: ProjectSort) => {
    setProjectSort(value);
    try { localStorage.setItem(sortKey, value); } catch { /* Sorting still works with browser storage disabled. */ }
  };
  const [shellNotice, setShellNotice] = useState("");
  const [chatFocus, setChatFocus] = useState<string | undefined>();
  const [documentId, setDocumentId] = useState<Id<"wikiPages"> | undefined>();
  const notifications = useNotifications(sessionToken, workspace._id, user._id);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [linkedTask, setLinkedTask] = useState<{ projectId: Id<"projects">; taskId: Id<"tasks"> } | null>(null);
  const reorder = useMutation(api.projects.reorder);
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const viewLoading = useContentTransition(`${workspace._id}:${mainView}:${mainView === "project" ? activeProjectId : ""}`);
  const inbox = useQuery(api.tasks.inbox, { sessionToken, teamId: workspace._id });
  const voiceParticipants = useLocalVoiceParticipants(sessionToken, !!sessionToken && !!user);
  const sidebarProjects: ProjectWithUi[] | undefined = projects ? projectOrder ? [...projects].sort((a, b) => projectOrder.indexOf(a._id) - projectOrder.indexOf(b._id)) : sortProjects(orderSidebarProjects(projects), projectSort) : undefined;
  const collaborators = useProjectPresence(sessionToken, workspace._id, mainView === "project" && projects?.some(project => project._id === activeProjectId) ? activeProjectId : null);
  const projectViewers = [...collaborators.map(member => ({ ...member, self: false })),
    ...(mainView === "project" && activeProjectId ? [{ userId: user._id, projectId: activeProjectId, name: user.name, email: user.email, username: user.username, avatarUrl: user.avatarUrl || null, updatedAt: 0, self: true }] : []),
  ];
  const viewersByProject = new Map<string, typeof projectViewers>();
  for (const viewer of projectViewers) {
    const viewers = viewersByProject.get(viewer.projectId) || [];
    viewers.push(viewer);
    viewersByProject.set(viewer.projectId, viewers);
  }

  useEffect(() => { if (mainView === "draw" || mainView === "voice") setVisitedTools(current => ({ ...current, [mainView]: true })); }, [mainView]);

  useEffect(() => {
    localStorage.setItem("origin.workspace", workspace.slug);
    const params = new URLSearchParams(window.location.search);
    const githubStatus = params.get("github");
    if (githubStatus) setShellNotice(githubStatus === "connected" ? "GitHub connected to this workspace." : githubStatus === "app-ready" ? "GitHub App ready. Open Settings > Integrations to connect your workspace." : "GitHub connection was not completed. Try again from Settings > Integrations.");
    const view = params.get("view");
    if (view && ["chat", "voice", "draw", "inbox", "docs", "roadmap", "feedback", "releases"].includes(view)) setMainView(view as MainView);
    const doc = params.get("doc");
    if (doc) setDocumentId(doc as Id<"wikiPages">);
    const project = params.get("project");
    if (project) setActiveProjectId(project as Id<"projects">);
    const issue = params.get("issue");
    if (project && issue) setLinkedTask({ projectId: project as Id<"projects">, taskId: issue as Id<"tasks"> });
    const handleKeys = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); setSearchOpen(true); } if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [workspace.slug]);

  useEffect(() => {
    if (projects === undefined) return;
    if (!projects.length) {
      setActiveProjectId(null);
      return;
    }
    const orderedProjects = orderSidebarProjects(projects);
    if (!activeProjectId || !orderedProjects.some((project) => project._id === activeProjectId)) {
      setActiveProjectId(orderedProjects[0]._id);
    }
  }, [projects, activeProjectId]);

  const openProject = (projectId: Id<"projects">) => {
    setActiveProjectId(projectId);
    setMainView("project");
    setMobileOpen(false);
    window.history.replaceState(null, "", `/${workspace.slug}?project=${projectId}`);
  };
  const openView = (view: MainView) => {
    setMainView(view); setMobileOpen(false);
    window.history.replaceState(null, "", `/${workspace.slug}?view=${view}`);
  };
  const moveProject = async (target: Id<"projects">) => {
    if (!dragProject || dragProject === target || !sidebarProjects) return;
    const ids = sidebarProjects.map(p => p._id).filter(id => id !== dragProject);
    ids.splice(ids.indexOf(target), 0, dragProject);
    changeProjectSort("manual"); setProjectOrder(ids); setDragProject(null);
    try { await reorder({ sessionToken, teamId: workspace._id, projectIds: ids }); }
    catch (error) { setShellNotice(error instanceof Error ? error.message : "Could not reorder projects"); }
    finally { setProjectOrder(null); }
  };

  return (
    <MemberProfileContext.Provider value={setMemberEmail}><div className={clsx("app-shell", "workspace-app", mobileOpen && "mobile-nav-open", sidebarCollapsed && !sidebarHover && "sidebar-hidden", sidebarCollapsed && sidebarHover && "sidebar-floating")}>
      <header className="mobile-topbar"><button className="icon-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><button className="icon-button" aria-label="Create issue" onClick={() => setIssueOpen(true)}><Plus size={20} /></button></header>
      {mobileOpen && <button className="mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      {sidebarCollapsed ? <div className="sidebar-hover-zone" onMouseEnter={() => setSidebarHover(true)} /> : null}
      <aside className="sidebar" onMouseLeave={() => { if (sidebarCollapsed) setSidebarHover(false); }}>
        <div className="sidebar-topbar">
          <ProfileMenu user={user} sessionToken={sessionToken} onLogout={onLogout} sound={notifications.sound} onToggleSound={notifications.toggleSound} collapsed={false} />
          <button className="icon-button" type="button" onClick={() => { setSidebarCollapsed((value) => !value); setSidebarHover(false); }} aria-label="Collapse sidebar">
            <Menu size={17} />
          </button>
          <button className="icon-button sidebar-new-issue" title="Create issue" aria-label="Create issue" onClick={() => setIssueOpen(true)}><Plus size={16} /></button>
          <button className="icon-button" type="button" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search size={17} />
          </button>
        </div>
        <div className="workspace-switcher"><select aria-label="Switch workspace" value={workspace.slug} onChange={e => { if (e.target.value === "__create") setCreateWorkspaceOpen(true); else window.location.assign(`/${e.target.value}`); }}>{workspaces.map(w => <option key={w._id} value={w.slug}>{w.name}</option>)}<option value="__create">Create workspace...</option></select><ChevronDown size={12} /></div>
        <div className="sidebar-content">
          <nav className="sidebar-nav">
          <button
            className={clsx("nav-item", mainView === "inbox" && "active")}
            type="button"
            onClick={() => openView("inbox")}
          >
            <Inbox size={16} />
            <span>Inbox</span>
            {(notifications.summary?.unread || 0) > 0 && <span className="inbox-unread-dot" aria-label={`${notifications.summary!.unread}${notifications.summary!.more ? "+" : ""} unread notifications`} />}
            <small>{inbox?.length ?? 0}</small>
          </button>
          <button className={clsx("nav-item", mainView === "chat" && "active")} type="button" onClick={() => openView("chat")}>
            <MessageCircle size={16} />
            <span>Chat</span>
          </button>
          <button className={clsx("nav-item", mainView === "voice" && "active")} type="button" onClick={() => openView("voice")}>
            <Video size={16} />
            <span>Call</span>
            <small>{voiceParticipants?.length ?? 0}</small>
          </button>
          <button className={clsx("nav-item", mainView === "draw" && "active")} type="button" onClick={() => openView("draw")}><PenTool size={16} /><span>Draw</span></button>
          <button className={clsx("nav-item", mainView === "docs" && "active")} type="button" onClick={() => openView("docs")}><FileText size={16} /><span>Docs</span></button>
          <button className={clsx("nav-item", mainView === "roadmap" && "active")} type="button" onClick={() => openView("roadmap")}><Flag size={16} /><span>Roadmap</span></button>
          <button className={clsx("nav-item", mainView === "feedback" && "active")} type="button" onClick={() => openView("feedback")}><MessageCircle size={16} /><span>Feedback</span></button>
          <button className={clsx("nav-item", mainView === "releases" && "active")} type="button" onClick={() => openView("releases")}><Rocket size={16} /><span>Releases</span></button>
          </nav>
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <button className="section-toggle" type="button" aria-expanded={projectsOpen} onClick={() => setProjectsOpen((value) => !value)}>
                {projectsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Projects</span>
              </button>
              <ProjectSortMenu value={projectSort} onChange={changeProjectSort} />
              <CreateProjectInline sessionToken={sessionToken} onCreated={openProject} iconOnly />
            </div>
            {projects === undefined ? <LoadingState label="Projects" /> : null}
            {projectsOpen ? (
              <div className="sidebar-project-list">
                {sidebarProjects?.map((project) => {
                  const viewers = (viewersByProject.get(project._id) || []).sort((a, b) => Number(b.self) - Number(a.self));
                  return (
                  <button
                    key={project._id}
                    className={clsx("project-button", dragProject === project._id && "dragging", mainView === "project" && activeProjectId === project._id && "active")}
                    type="button"
                    draggable={workspace.role !== "viewer"}
                    onDragStart={event => { setDragProject(project._id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", project._id); }}
                    onDragOver={event => { if (dragProject) event.preventDefault(); }}
                    onDrop={event => { event.preventDefault(); void moveProject(project._id); }}
                    onDragEnd={() => setDragProject(null)}
                    onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key) && workspace.role !== "viewer") { event.preventDefault(); const ids = sidebarProjects.map(p => p._id); const at = ids.indexOf(project._id); const target = at + (event.key === "ArrowUp" ? -1 : 1); if (target >= 0 && target < ids.length) { [ids[at], ids[target]] = [ids[target], ids[at]]; changeProjectSort("manual"); void reorder({ sessionToken, teamId: workspace._id, projectIds: ids }).catch(error => setShellNotice(error.message)); } } }}
                    onClick={() => openProject(project._id)}
                  >
                    <ProjectIcon project={project} />
                    <span>{project.name}</span>
                    <span className="project-trailing"><span className="project-viewers" title={viewers.length ? `${viewers.map(member => member.self ? "You" : member.name).join(", ")} viewing this project` : undefined}>
                      {viewers.slice(0, 2).map(member => <span key={member.userId} className="project-viewer" aria-label={member.self ? "You are viewing this project" : `${member.name} is viewing this project`}><UserAvatar user={member} size="small" /></span>)}
                      {viewers.length > 2 && <span className="project-viewer viewer-overflow">+{viewers.length - 2}</span>}
                    </span><small className="project-issue-count" aria-label={`${project.openIssueCount ?? 0} open issues`}>{project.openIssueCount ?? 0}</small></span>
                  </button>
                ); })}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
      <main className={clsx("workspace", mainView === "draw" && "draw-workspace", viewLoading && "view-loading")} aria-busy={viewLoading}>
        {viewLoading && <div className="view-loading-overlay"><ContentSkeleton kind={mainView === "chat" ? "chat" : mainView === "draw" ? "canvas" : mainView === "project" || mainView === "voice" ? "board" : "list"} label="Loading view" rows={6} /></div>}
        {shellNotice && <div className="notice danger">{shellNotice}<button className="icon-button" aria-label="Dismiss" onClick={() => setShellNotice("")}><X size={14} /></button></div>}
        {mainView === "chat" ? (
          <ChatView sessionToken={sessionToken} user={user} focusMessageId={chatFocus} onOpenReference={(projectId, taskId) => { if (taskId) setLinkedTask({ projectId, taskId }); else openProject(projectId); }} />
        ) : mainView === "draw" || mainView === "voice" ? null
        : mainView === "inbox" ? (
          <InboxView sessionToken={sessionToken} unread={notifications.summary?.unread || 0} onOpenProject={openProject} onOpenChat={messageId => { setChatFocus(messageId); openView("chat"); }} onOpenTask={(projectId, taskId) => setLinkedTask({ projectId, taskId })} />
        ) : mainView === "docs" ? <DocsView sessionToken={sessionToken} initialPageId={documentId} />
        : mainView === "roadmap" ? <RoadmapView sessionToken={sessionToken} onOpenTask={(projectId, taskId) => setLinkedTask({ projectId, taskId })} />
        : mainView === "feedback" ? <FeedbackView sessionToken={sessionToken} onOpenTask={(projectId, taskId) => setLinkedTask({ projectId, taskId })} />
        : mainView === "releases" ? <ReleasesView sessionToken={sessionToken} onOpenTask={(projectId, taskId) => setLinkedTask({ projectId, taskId })} />
        : activeProjectId ? (
          <ProjectWorkspace key={activeProjectId} projectId={activeProjectId} sessionToken={sessionToken} user={user} />
        ) : (
          <EmptyProjects sessionToken={sessionToken} onCreated={openProject} />
        )}
        {visitedTools.draw && <div className="persistent-tool draw-tool" hidden={mainView !== "draw"}><DrawView sessionToken={sessionToken} user={user} /></div>}
        {visitedTools.voice && <div className="persistent-tool voice-tool" hidden={mainView !== "voice"}><VoiceChatView sessionToken={sessionToken} user={user} /></div>}
      </main>
      {issueOpen && <IssueComposer sessionToken={sessionToken} activeProjectId={activeProjectId} projects={sidebarProjects || []} onClose={() => setIssueOpen(false)} onCreated={openProject} />}
      {createWorkspaceOpen && <CreateWorkspaceDialog sessionToken={sessionToken} onClose={() => setCreateWorkspaceOpen(false)} />}
      {memberEmail && <MemberProfile key={memberEmail} email={memberEmail} sessionToken={sessionToken} onClose={() => setMemberEmail(null)} onOpenIssue={(projectId, taskId) => { openProject(projectId); setLinkedTask({ projectId, taskId }); }} />}
      {linkedTask && projects?.find(p => p._id === linkedTask.projectId) && <TaskModal project={projects.find(p => p._id === linkedTask.projectId)!} projectId={linkedTask.projectId} taskId={linkedTask.taskId} sessionToken={sessionToken} canEdit={workspace.role !== "viewer"} onClose={() => setLinkedTask(null)} />}
      {searchOpen ? (
        <SearchDialog
          activeProjectId={activeProjectId}
          projects={sidebarProjects ?? []}
          sessionToken={sessionToken}
          onClose={() => setSearchOpen(false)}
          onOpenProject={openProject}
          onOpenDocument={pageId => { setDocumentId(pageId); openView("docs"); }}
          onOpenChat={messageId => { setChatFocus(messageId); openView("chat"); }}
          onOpenTask={(projectId, taskId) => { openProject(projectId); setLinkedTask({ projectId, taskId }); }}
        />
      ) : null}
    </div></MemberProfileContext.Provider>
  );
}


function ProfileMenu({
  user,
  sessionToken,
  onLogout,
  collapsed = false,
  sound,
  onToggleSound,
}: {
  user: AuthUser;
  sessionToken: string;
  onLogout: () => void;
  collapsed?: boolean;
  sound: boolean;
  onToggleSound: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="profile-menu-wrap">
      {open ? <WorkspaceSettings sessionToken={sessionToken} sound={sound} onToggleSound={onToggleSound} profile={<ProfileSettings user={user} sessionToken={sessionToken} />} security={<PasswordChanger sessionToken={sessionToken} />} onClose={() => setOpen(false)} onLogout={onLogout} /> : null}
      <button className="profile-chip bottom" type="button" aria-label="Open account and workspace settings" onClick={() => setOpen((value) => !value)}>
        <UserAvatar user={user} />
        {!collapsed ? <div><strong>{sidebarUsername(user)}</strong></div> : null}
      </button>
    </div>
  );
}

function ProfileSettings({ user, sessionToken }: { user: AuthUser; sessionToken: string }) {
  const updateProfile = useMutation(api.auth.updateProfile);
  const generateAvatarUploadUrl = useMutation(api.auth.generateAvatarUploadUrl);
  const [username, setUsername] = useState(user.username || user.email.split("@")[0] || "");
  const [name, setName] = useState(user.name || "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setUsername(user.username || user.email.split("@")[0] || "");
    setName(user.name || "");
  }, [user.email, user.name, user.username]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      let avatarStorageId: Id<"_storage"> | undefined;
      if (avatarFile) {
        const uploadUrl = await generateAvatarUploadUrl({ sessionToken });
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": avatarFile.type || "application/octet-stream" }, body: avatarFile });
        if (!res.ok) throw new Error("Avatar upload failed");
        const payload = (await res.json()) as { storageId: Id<"_storage"> };
        avatarStorageId = payload.storageId;
      }
      await updateProfile({
        sessionToken,
        username,
        name,
        ...(avatarStorageId ? { avatarStorageId } : {}),
      });
      setAvatarFile(null);
      setNotice("Profile updated");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Profile update failed");
    }
  };
  return (
    <form className="mini-form profile-settings" onSubmit={submit}>
      <div className="profile-avatar-preview"><UserAvatar user={user} /><span>{user.email}</span></div>
      <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" /></label>
      <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Display name" /></label>
      <label>Profile picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} /></label>
      {notice ? <div className="notice">{notice}</div> : null}
      <button className="primary-button compact" type="submit">Save account</button>
    </form>
  );
}

function PasswordChanger({ sessionToken }: { sessionToken: string }) {
  const changePassword = useMutation(api.auth.changePassword);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await changePassword({ sessionToken, currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setNotice("Password changed");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Password change failed"); }
  };
  if (!open) return <button className="ghost-button full" type="button" onClick={() => setOpen(true)}><KeyRound size={16} /> Change password</button>;
  return <form className="mini-form" onSubmit={submit}><input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password" placeholder="Current password" /><input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="New password" />{notice ? <div className="notice">{notice}</div> : null}<div className="row gap"><button className="primary-button compact" type="submit">Save</button><button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cancel</button></div></form>;
}

function CreateProjectInline({ sessionToken, onCreated, iconOnly = false }: { sessionToken: string; onCreated: (id: Id<"projects">) => void; iconOnly?: boolean }) {
  const workspace = useWorkspace();
  const createProject = useMutation(api.projects.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const id = await createProject({ name, sessionToken, teamId: workspace._id });
      setName("");
      setOpen(false);
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project creation failed");
    } finally {
      setBusy(false);
    }
  };
  return <><button className={clsx("ghost-button", iconOnly ? "icon-create" : "full")} type="button" aria-label="Create project" title="Create project" disabled={workspace.role === "viewer"} onClick={() => setOpen(true)}><Plus size={14} strokeWidth={1.5} />{iconOnly ? null : "New project"}</button>{open && <Dialog title="New project" onClose={() => setOpen(false)}><form className="dialog-body stack-form" onSubmit={submit}><label>Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" autoFocus required maxLength={100} /></label>{error ? <div className="notice danger">{error}</div> : null}<div className="row gap"><button className="primary-button compact" type="submit" disabled={busy}>{busy ? "Creating..." : "Create project"}</button><button className="ghost-button compact" type="button" onClick={() => setOpen(false)}>Cancel</button></div></form></Dialog>}</>;
}


function EmptyProjects({ sessionToken, onCreated }: { sessionToken: string; onCreated: (id: Id<"projects">) => void }) {
  return <section className="empty-projects"><Sparkles size={28} /><h1>Create first project.</h1><p>Invite members per project. Add repo later in Settings.</p><div className="empty-create"><CreateProjectInline sessionToken={sessionToken} onCreated={onCreated} /></div></section>;
}

function SearchDialog({
  activeProjectId,
  projects,
  sessionToken,
  onClose,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
  onOpenChat,
}: {
  activeProjectId: Id<"projects"> | null;
  projects: ProjectWithUi[];
  sessionToken: string;
  onClose: () => void;
  onOpenProject: (id: Id<"projects">) => void;
  onOpenTask: (projectId: Id<"projects">, taskId: Id<"tasks">) => void;
  onOpenDocument: (id: Id<"wikiPages">) => void;
  onOpenChat: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const modalRef = useRef<HTMLElement>(null);
  useModalKeyboard(modalRef, onClose);
  const workspace = useWorkspace();
  const openMember = useMemberProfile();
  const issueResults = useQuery(api.workspaceSearch.issues, { sessionToken, teamId: workspace._id, text: query });
  const documents = useQuery(api.workspaceSearch.documents, { sessionToken, teamId: workspace._id, text: query });
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [chatSearchError, setChatSearchError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setMessages([]); setChatSearchError("");
    if (query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(() => {
      void requestLocalApi<{ messages: LocalChatMessage[] }>(`/api/local-chat/messages?teamId=${workspace._id}&search=${encodeURIComponent(query)}`, sessionToken, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setMessages(result.messages.slice(-8).reverse()); }).catch(() => { if (!controller.signal.aborted) setChatSearchError("Chat search is unavailable"); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sessionToken, workspace._id]);
  const members = useQuery(api.workspaces.members, { teamId: workspace._id, sessionToken });
  const value = query.trim().toLowerCase();
  const projectResults = value ? projects.filter((project) => project.name.toLowerCase().includes(value)) : projects.slice(0, 5);
  const memberResults = value ? members?.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(value)).slice(0, 8) : members?.slice(0, 5);
  return (
    <div className="modal-backdrop search-backdrop" onClick={onClose}>
      <section ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Search" className="search-modal" onClick={(event) => event.stopPropagation()}>
        <div className="search-input-row"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, issues, people, docs, chat" maxLength={160} autoFocus /><button type="button" aria-label="Close search" onClick={onClose}><X size={16} /></button></div>
        <div className="search-results">
          <div><div className="section-label">Projects</div>{projectResults.map((project) => <button type="button" key={project._id} onClick={() => { onOpenProject(project._id); onClose(); }}><ProjectIcon project={project} /><span>{project.name}</span></button>)}</div>
          <div><div className="section-label">Issues</div>{issueResults?.slice(0, 10).map((task) => <button type="button" key={task._id} onClick={() => { onOpenTask(task.projectId, task._id); onClose(); }}><span className="task-code">{taskKey(task._id)}</span><span>{task.title}</span></button>)}</div>
          <div><div className="section-label">Teammates</div>{memberResults?.map((member) => <button type="button" key={member._id} onClick={() => { onClose(); openMember(member.email); }}>{member.avatarUrl ? <img className="avatar small" src={member.avatarUrl} alt="" /> : <span className="avatar small">{initials(member.name || member.email)}</span>}<span>{member.name || member.email}</span></button>)}</div>
          <div><div className="section-label">Documents</div>{documents?.map(page => <button key={page._id} type="button" onClick={() => { onOpenDocument(page._id); onClose(); }}><FileText size={15} /><span>{page.title}</span></button>)}</div>
          {value.length > 1 && <div><div className="section-label">Workspace chat</div>{messages.map(message => <button key={message.id} type="button" onClick={() => { onOpenChat(message.id); onClose(); }}><MessageCircle size={15} /><span>{message.body.slice(0, 180)}</span></button>)}{chatSearchError && <p className="muted">{chatSearchError}</p>}</div>}
        </div>
      </section>
    </div>
  );
}


function VoiceChatView({ sessionToken, user }: { sessionToken: string; user: AuthUser }) {
  const workspace = useWorkspace();
  const localApi = <T,>(path: string, token: string, init: RequestInit & { json?: unknown } = {}) => requestLocalApi<T>(`${path}?teamId=${workspace._id}`, token, init);
  const participants = useLocalVoiceParticipants(sessionToken);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, RemoteCallStream>>({});
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const [signals, setSignals] = useState<LocalVoiceSignal[]>([]);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState("");
  const [videoDevice, setVideoDevice] = useState("");
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const processedSignalsRef = useRef(new Set<string>());
  const joinedRef = useRef(false);
  const sharingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    setFocusedTile(current => {
      if (!current) return current;
      if (current === "self:camera") return localStream ? current : null;
      if (current === "self:screen") return screenStream ? current : null;
      const [userId, kind] = current.split(":");
      const participant = participants?.find(item => item.userId === userId);
      return participant && (kind !== "screen" || participant.screenSharing) ? current : null;
    });
  }, [localStream, screenStream, participants]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const wasJoined = joinedRef.current;
      joinedRef.current = false;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();
      processedSignalsRef.current.clear();
      if (wasJoined) {
        void localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
      }
    };
  }, [sessionToken]);

  const cleanupPeer = (remoteUserId: string) => {
    peerConnectionsRef.current.get(remoteUserId)?.close();
    peerConnectionsRef.current.delete(remoteUserId);
    pendingCandidatesRef.current.delete(remoteUserId);
    setRemoteStreams((current) => {
      if (!current[remoteUserId]) return current;
      const next = { ...current };
      delete next[remoteUserId];
      return next;
    });
  };

  const sendPeerSignal = (toUserId: Id<"users">, kind: "offer" | "answer" | "candidate", payload: string) => {
    void localApi("/api/local-voice/signals", sessionToken, { method: "POST", json: { toUserId, kind, payload } }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Could not send call signal");
    });
  };

  const flushPendingCandidates = async (remoteUserId: string, connection: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(remoteUserId) ?? [];
    pendingCandidatesRef.current.delete(remoteUserId);
    for (const candidate of pending) await connection.addIceCandidate(candidate);
  };

  const ensurePeerConnection = (remoteUserId: Id<"users">) => {
    const key = remoteUserId.toString();
    const existing = peerConnectionsRef.current.get(key);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks()[0];
    const videoTrack = stream?.getVideoTracks()[0];
    if (audioTrack && stream) connection.addTrack(audioTrack, stream);
    else connection.addTransceiver("audio", { direction: "sendrecv", streams: stream ? [stream] : [] });
    if (videoTrack && stream) connection.addTrack(videoTrack, stream);
    else connection.addTransceiver("video", { direction: "sendrecv", streams: stream ? [stream] : [] });
    // Reserve a separate video transceiver so screen sharing never replaces the camera.
    connection.addTransceiver(screenRef.current?.getVideoTracks()[0] || "video", { direction: "sendrecv", streams: [screenRef.current || new MediaStream()] });
    connection.onicecandidate = (event) => {
      if (event.candidate) sendPeerSignal(remoteUserId, "candidate", JSON.stringify(event.candidate.toJSON()));
    };
    connection.ontrack = (event) => {
      const screenTrack = connection.getTransceivers().filter(item => item.receiver.track.kind === "video")[1]?.receiver.track === event.track;
      setRemoteStreams(current => {
        const stream = current[key]?.stream || new MediaStream();
        const screen = current[key]?.screen || new MediaStream();
        const target = screenTrack ? screen : stream;
        if (!target.getTracks().includes(event.track)) target.addTrack(event.track);
        return { ...current, [key]: { stream, screen, addedAt: current[key]?.addedAt ?? Date.now() } };
      });
    };
    connection.onconnectionstatechange = () => {
      if (["closed", "failed"].includes(connection.connectionState)) cleanupPeer(key);
    };
    peerConnectionsRef.current.set(key, connection);
    return connection;
  };

  const startCall = async () => {
    if (joining || localStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("Camera and microphone are not available in this browser.");
      return;
    }
    let stream: MediaStream | null = null;
    setJoining(true);
    setDevicesOpen(false);
    try {
      const configuration = await localApi<{ iceServers: RTCIceServer[] }>("/api/local-voice/config", sessionToken);
      iceServersRef.current = configuration.iceServers;
      try {
        stream = audioEnabled || videoEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioEnabled ? { ...(audioDevice ? { deviceId: { exact: audioDevice } } : {}), echoCancellation: true, noiseSuppression: true } : false, video: videoEnabled ? { ...(videoDevice ? { deviceId: { exact: videoDevice } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } : false }) : new MediaStream();
      } catch {
        stream = audioEnabled ? await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true, video: false }) : new MediaStream();
      }
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      if (!mountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      await localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "join", audioEnabled: hasAudio, videoEnabled: hasVideo },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } });
        return;
      }
      joinedRef.current = true;
      localStreamRef.current = stream;
      setLocalStream(stream);
      setDevicesOpen(false);
      setJoinedAt(Date.now());
      setAudioEnabled(hasAudio);
      setVideoEnabled(hasVideo);
      setNotice("");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mountedRef.current) setNotice(error instanceof Error ? error.message : "Could not start call");
    } finally { if (mountedRef.current) setJoining(false); }
  };
  const leaveCall = async () => {
    joinedRef.current = false;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null; localStreamRef.current = null;
    setScreenStream(null); setJoinedAt(null); setFocusedTile(null);
    setLocalStream(null);
    setRemoteStreams({});
    peerConnectionsRef.current.forEach((connection) => connection.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    processedSignalsRef.current.clear();
    await localApi("/api/local-voice/participants", sessionToken, { method: "POST", json: { action: "leave" } }).catch(() => {});
  };
  const stopSharing = async () => {
    screenRef.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    screenRef.current = null; setScreenStream(null); setFocusedTile(current => current === "self:screen" ? null : current);
    await Promise.allSettled([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(null)));
  };
  const shareScreen = async () => {
    if (sharingRef.current || !joinedRef.current) return;
    if (screenRef.current) { await stopSharing(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setNotice("Screen sharing is not supported in this browser. You can still view a teammate's screen."); return; }
    let screen: MediaStream | null = null;
    sharingRef.current = true;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (!joinedRef.current) { screen.getTracks().forEach(track => track.stop()); return; }
      const track = screen.getVideoTracks()[0];
      screenRef.current = screen;
      await Promise.all([...peerConnectionsRef.current.values()].map(connection => connection.getTransceivers().filter(t => t.receiver.track.kind === "video")[1]?.sender.replaceTrack(track)));
      track.onended = () => { void stopSharing(); };
      if (!joinedRef.current || track.readyState === "ended") { await stopSharing(); return; }
      setScreenStream(screen); setNotice("");
    } catch (error) {
      screen?.getTracks().forEach(track => track.stop());
      await stopSharing();
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) setNotice(error instanceof Error ? error.message : "Could not share screen");
    } finally { sharingRef.current = false; }
  };
  useEffect(() => { if (!joinedAt) return; const tick = () => setElapsed(Math.floor((Date.now() - joinedAt) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [joinedAt]);
  const toggleAudio = async () => {
    const next = !audioEnabled;
    if (next && localStream && !localStream.getAudioTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioDevice ? { deviceId: { exact: audioDevice }, echoCancellation: true } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getAudioTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "audio")?.sender.replaceTrack(track)));
      } catch { setNotice("Microphone access was denied. Check your browser permissions."); return; }
    }
    localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setAudioEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled: next, videoEnabled, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };
  const toggleVideo = async () => {
    const next = !videoEnabled;
    if (next && localStream && !localStream.getVideoTracks().some(t => t.readyState === "live")) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoDevice ? { deviceId: { exact: videoDevice } } : true });
        if (!joinedRef.current || localStreamRef.current !== localStream) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getVideoTracks()[0];
        localStream.addTrack(track);
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === "video")?.sender.replaceTrack(track)));
      } catch { setNotice("Camera access was denied. Check your browser permissions."); return; }
    }
    localStream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setVideoEnabled(next);
    if (localStream) {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled: next, screenSharing: !!screenRef.current },
      }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!localStream) return;
    const heartbeat = () => {
      void localApi("/api/local-voice/participants", sessionToken, {
        method: "POST",
        json: { action: "update", audioEnabled, videoEnabled, screenSharing: !!screenStream },
      }).catch(() => {});
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 8_000);
    return () => window.clearInterval(interval);
  }, [audioEnabled, localStream, sessionToken, videoEnabled, screenStream]);

  useEffect(() => {
    if (!localStream) {
      setSignals([]);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const result = await localApi<{ signals: LocalVoiceSignal[] }>("/api/local-voice/signals", sessionToken);
        if (alive) setSignals(result.signals);
      } catch (error) {
        if (alive) setNotice(error instanceof Error ? error.message : "Could not load call signals");
      }
    };
    void load();
    const interval = window.setInterval(load, 1_200);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [localStream, sessionToken]);

  useEffect(() => {
    if (!localStream || !participants) return;
    const remoteParticipants = participants.filter((participant) => participant.userId !== user._id);
    const activeRemoteIds = new Set(remoteParticipants.map((participant) => participant.userId.toString()));
    peerConnectionsRef.current.forEach((_, remoteUserId) => {
      if (!activeRemoteIds.has(remoteUserId)) cleanupPeer(remoteUserId);
    });
    for (const participant of remoteParticipants) {
      const connection = ensurePeerConnection(participant.userId);
      const shouldOffer = user._id.toString() > participant.userId.toString();
      if (!shouldOffer || connection.localDescription || connection.remoteDescription || connection.signalingState !== "stable") continue;
      void connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .then(() => {
          if (connection.localDescription) {
            sendPeerSignal(participant.userId, "offer", JSON.stringify(connection.localDescription));
          }
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : "Could not start peer call"));
    }
  }, [localStream, participants, user._id]);

  useEffect(() => {
    if (!localStream || !signals?.length) return;
    const handleSignals = async () => {
      const ackIds: string[] = [];
      for (const signal of signals) {
        const key = signal.id;
        if (processedSignalsRef.current.has(key)) continue;
        processedSignalsRef.current.add(key);
        ackIds.push(signal.id);
        const remoteUserId = signal.fromUserId.toString();
        const connection = ensurePeerConnection(signal.fromUserId);
        try {
          if (signal.kind === "offer") {
            await connection.setRemoteDescription(JSON.parse(signal.payload) as RTCSessionDescriptionInit);
            await flushPendingCandidates(remoteUserId, connection);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            if (connection.localDescription) {
              sendPeerSignal(signal.fromUserId, "answer", JSON.stringify(connection.localDescription));
            }
          } else if (signal.kind === "answer") {
            if (connection.signalingState === "have-local-offer") {
              await connection.setRemoteDescription(JSON.parse(signal.payload) as RTCSessionDescriptionInit);
              await flushPendingCandidates(remoteUserId, connection);
            }
          } else {
            const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
            if (connection.remoteDescription) {
              await connection.addIceCandidate(candidate);
            } else {
              pendingCandidatesRef.current.set(remoteUserId, [
                ...(pendingCandidatesRef.current.get(remoteUserId) ?? []),
                candidate,
              ]);
            }
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Call connection failed");
        }
      }
      if (ackIds.length) {
        await localApi("/api/local-voice/signals", sessionToken, { method: "DELETE", json: { signalIds: ackIds } }).catch(() => {});
      }
    };
    void handleSignals();
  }, [localStream, sessionToken, signals]);

  const activeParticipants = participants ?? [];
  const remoteParticipants = activeParticipants.filter((participant) => participant.userId !== user._id);
  const changeDevice = async (kind: "audio" | "video", deviceId: string) => {
    const stream = localStreamRef.current;
    if (stream && (kind === "audio" ? audioEnabled : videoEnabled)) {
      const capture = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (!joinedRef.current || localStreamRef.current !== stream) { capture.getTracks().forEach(track => track.stop()); return; }
      const track = capture.getTracks()[0];
      try {
        await Promise.all([...peerConnectionsRef.current.values()].map(pc => pc.getTransceivers().find(t => t.receiver.track.kind === kind)?.sender.replaceTrack(track)));
        stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
        stream.addTrack(track); const next = new MediaStream(stream.getTracks()); localStreamRef.current = next; setLocalStream(next);
      } catch (error) { capture.getTracks().forEach(t => t.stop()); throw error; }
    } else if (stream) {
      // A device selected while muted is acquired only after explicitly unmuting.
      stream.getTracks().filter(t => t.kind === kind).forEach(t => { stream.removeTrack(t); t.stop(); });
    }
    if (kind === "audio") setAudioDevice(deviceId); else setVideoDevice(deviceId);
  };
  return (
    <section className="voice-workspace">
      <div className="call-utility-bar"><div className="call-participant-strip" aria-label="Call participants">{participants === undefined ? <ContentSkeleton label="Loading participants" rows={1} /> : activeParticipants.map(participant => <button key={participant.userId} className="call-participant-chip" title={participant.name} onClick={() => setFocusedTile(current => current === (participant.userId === user._id ? "self:camera" : `${participant.userId}:camera`) ? null : participant.userId === user._id ? "self:camera" : `${participant.userId}:camera`)}><UserAvatar user={participant.userId === user._id ? user : participant} size="small" /><span>{participant.userId === user._id ? "You" : sidebarUsername(participant)}</span></button>)}</div><div className="call-header-actions">{localStream ? <time className="call-elapsed">{Math.floor(elapsed / 60).toString().padStart(2, "0")}:{(elapsed % 60).toString().padStart(2, "0")}</time> : <button className="primary-button compact" onClick={startCall} disabled={joining || workspace.role === "viewer"}>{joining ? <Loader2 className="spin" size={15} /> : <Video size={15} />}Join call</button>}<button className="icon-button" title="Call devices" aria-label="Call devices" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={16} /></button></div></div>
      {devicesOpen && <CallDevices audioId={audioDevice} videoId={videoDevice} inCall={!!localStream} onChange={changeDevice} onClose={() => setDevicesOpen(false)} />}
      <div className="call-dock" hidden={!localStream}>
        <div className="call-controls">
          {localStream ? (
            <>
              <button type="button" aria-label={audioEnabled ? "Mute microphone" : "Unmute microphone"} title={audioEnabled ? "Mute microphone" : "Unmute microphone"} onClick={toggleAudio}>{audioEnabled ? <Mic size={18} /> : <MicOff size={18} />}</button>
              <button type="button" aria-label={videoEnabled ? "Turn camera off" : "Turn camera on"} title={videoEnabled ? "Turn camera off" : "Turn camera on"} onClick={toggleVideo}>{videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}</button>
              <button type="button" className={screenStream ? "sharing" : ""} aria-label={screenStream ? "Stop sharing" : "Share screen"} title={screenStream ? "Stop sharing" : "Share screen"} onClick={shareScreen}>{screenStream ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
              <button type="button" className="leave-call" aria-label="Leave call" title="Leave call" onClick={leaveCall}><PhoneOff size={18} /></button>
            </>
          ) : (
            <button type="button" onClick={startCall} disabled={joining || workspace.role === "viewer"}>{joining ? <Loader2 className="spin" size={15} /> : <Video size={15} />} Join call</button>
          )}
        </div>
      </div>
      <div className="voice-workspace-grid">
        <div className={clsx("voice-room stage", localStream && "in-call", focusedTile && "has-focused-tile", (screenStream || remoteParticipants.some(participant => participant.screenSharing)) && "has-screen-share")} data-single={!screenStream && !remoteParticipants.length} style={focusedTile ? { gridTemplateRows: `repeat(${Math.max(1, remoteParticipants.length + remoteParticipants.filter(participant => participant.screenSharing && remoteStreams[participant.userId]?.screen).length + (screenStream ? 1 : 0))}, minmax(80px, 1fr))` } : undefined}>
          {localStream ? (
            <>
              {screenStream && <CallVideoTile stream={screenStream} participant={user} muted label="Your screen" audioEnabled={false} videoEnabled screenSharing focused={focusedTile === "self:screen"} onFocus={() => setFocusedTile(focusedTile === "self:screen" ? null : "self:screen")} />}
              <CallVideoTile stream={localStream} participant={user} muted label="You" audioEnabled={audioEnabled} videoEnabled={videoEnabled} focused={focusedTile === "self:camera"} onFocus={() => setFocusedTile(focusedTile === "self:camera" ? null : "self:camera")} />
              {remoteParticipants.map(participant => {
                const remote = remoteStreams[participant.userId.toString()];
                const cameraId = `${participant.userId}:camera`, screenId = `${participant.userId}:screen`;
                return <div className="call-peer-tiles" key={participant.userId}>
                  {participant.screenSharing && remote?.screen && <CallVideoTile stream={remote.screen} participant={participant} muted label={`${sidebarUsername(participant)}'s screen`} audioEnabled={false} videoEnabled screenSharing focused={focusedTile === screenId} onFocus={() => setFocusedTile(focusedTile === screenId ? null : screenId)} />}
                  {remote ? <CallVideoTile stream={remote.stream} participant={participant} audioEnabled={participant.audioEnabled} videoEnabled={participant.videoEnabled} focused={focusedTile === cameraId} onFocus={() => setFocusedTile(focusedTile === cameraId ? null : cameraId)} /> : <div className="call-tile connecting"><UserAvatar user={participant} /><span>{sidebarUsername(participant)}</span><small>Connecting</small></div>}
                </div>;
              })}
            </>
          ) : (
            <div className="call-lobby"><div className="lobby-avatar"><UserAvatar user={user} /></div><h2>{activeParticipants.length ? "Your team is here" : "Ready when you are"}</h2><div className="lobby-devices"><button title={audioEnabled ? "Microphone on" : "Microphone off"} aria-label={audioEnabled ? "Disable microphone before joining" : "Enable microphone before joining"} aria-pressed={audioEnabled} onClick={() => setAudioEnabled(!audioEnabled)}>{audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</button><button title={videoEnabled ? "Camera on" : "Camera off"} aria-label={videoEnabled ? "Disable camera before joining" : "Enable camera before joining"} aria-pressed={videoEnabled} onClick={() => setVideoEnabled(!videoEnabled)}>{videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button></div><button className="ghost-button compact" onClick={() => setDevicesOpen(true)}><Settings2 size={14} />Check devices</button></div>
          )}
        </div>
      </div>
      {notice ? <small className="call-notice">{notice}</small> : null}
    </section>
  );
}

function CallVideoTile({
  stream,
  participant,
  muted = false,
  label,
  audioEnabled,
  videoEnabled,
  screenSharing = false,
  focused = false,
  onFocus,
}: {
  stream: MediaStream;
  participant: AvatarUser;
  muted?: boolean;
  label?: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  focused?: boolean;
  onFocus: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const openMember = useMemberProfile();
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div ref={tileRef} className={clsx("call-tile", !videoEnabled && "video-off", screenSharing && "screen-share-tile", focused && "focused-call-tile")}>
      <button className="call-tile-focus" aria-label={`${focused ? "Reduce" : "Enlarge"} ${label || participant.name}`} aria-pressed={focused} onClick={onFocus} />
      <video ref={videoRef} autoPlay muted={muted} playsInline style={!videoEnabled ? { position: "absolute", width: 1, height: 1, opacity: 0 } : undefined} />{!videoEnabled && <div className="video-avatar"><UserAvatar user={participant} /></div>}
      <div className="call-tile-meta">
        <button className="call-member-profile" onClick={() => openMember(participant.email)} aria-label={`View ${participant.name} profile`}>{label ?? displayUsername(participant)}</button>
        {audioEnabled ? <Mic size={13} /> : <MicOff size={13} />}
        {videoEnabled && <button className="icon-button call-fullscreen" title="Full screen" aria-label={`Full screen ${label || participant.name}`} onClick={() => { if (!tileRef.current?.requestFullscreen) { setFullscreenError("Full screen is unavailable in this browser"); return; } void tileRef.current.requestFullscreen().catch(() => setFullscreenError("Could not enter full screen")); }}><Maximize2 size={14} /></button>}
      </div>
      {fullscreenError && <small className="call-tile-error" role="status">{fullscreenError}</small>}
    </div>
  );
}

function ProjectWorkspace({ projectId, sessionToken, user }: { projectId: Id<"projects">; sessionToken: string; user: AuthUser }) {
  const [tab, setTab] = useState<TabKey>("board");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "repo") setTab("repo"); }, [projectId]);
  const tabLoading = useContentTransition(`${projectId}:${tab}`);
  const [issueOpen, setIssueOpen] = useState(false);
  const project = useQuery(api.projects.get, { projectId, sessionToken });
  if (!project) return <LoadingState label="Opening project" />;
  return (
    <div className={clsx("project-shell", tabLoading && "tab-loading")} aria-busy={tabLoading}>
      {tabLoading && <div className="view-loading-overlay"><ContentSkeleton kind={tab === "board" ? "board" : "list"} label="Loading project view" /></div>}
      <div className="project-navigation"><nav className="tabs" aria-label="Project views">{tabs.map((item) => { const Icon = item.icon; return <button key={item.key} className={clsx(tab === item.key && "active")} onClick={() => setTab(item.key)}><Icon size={16} /> {item.label}</button>; })}</nav>{tab !== "board" && project.memberRole !== "viewer" && <button className="primary-button compact project-create-issue" onClick={() => setIssueOpen(true)}><Plus size={15} />Create issue</button>}</div>
      {tab === "board" ? <BoardTab project={project} projectId={projectId} sessionToken={sessionToken} userEmail={user.email} canEdit={project.memberRole !== "viewer"} onCreateIssue={() => setIssueOpen(true)} /> : null}
      {tab === "repo" ? <RepoTab project={project} sessionToken={sessionToken} /> : null}
      {tab === "assets" ? <AssetsPanel projectId={projectId} sessionToken={sessionToken} /> : null}
      {tab === "vault" ? <VaultPanel projectId={projectId} sessionToken={sessionToken} /> : null}
      {tab === "team" ? <section className="project-team-section"><WorkspaceMembers sessionToken={sessionToken} /></section> : null}
      {tab === "settings" ? <SettingsTab project={project} sessionToken={sessionToken} /> : null}
      {issueOpen && <IssueComposer sessionToken={sessionToken} activeProjectId={projectId} projects={[project]} onClose={() => setIssueOpen(false)} onCreated={() => setTab("board")} />}
    </div>
  );
}
function StatPill({ label, value }: { label: string; value: string | number }) { return <div className="stat-pill"><span>{label}</span><strong>{value}</strong></div>; }

function SettingsTab({ project, sessionToken }: { project: ProjectWithUi; sessionToken: string }) {
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);
  const generateIconUploadUrl = useMutation(api.projects.generateIconUploadUrl);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [repoUrl, setRepoUrl] = useState(project.repoUrl || "");
  const [iconType, setIconType] = useState<ProjectIconType>((project.iconType as ProjectIconType | undefined) || "default");
  const [iconEmoji, setIconEmoji] = useState(project.iconType === "emoji" ? project.iconValue || "" : "");
  const [iconName, setIconName] = useState((project.iconType === "icon" ? project.iconValue : "circle") || "circle");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(project.name);
    setDescription(project.description || "");
    setRepoUrl(project.repoUrl || "");
    setIconType((project.iconType as ProjectIconType | undefined) || "default");
    setIconEmoji(project.iconType === "emoji" ? project.iconValue || "" : "");
    setIconName((project.iconType === "icon" ? project.iconValue : "circle") || "circle");
  }, [project._id, project.description, project.iconType, project.iconValue, project.name, project.repoUrl]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
    if (!name.trim()) throw new Error("Project name is required");
    let iconStorageId: Id<"_storage"> | undefined;
    if (iconType === "image" && iconFile) {
      const uploadUrl = await generateIconUploadUrl({ projectId: project._id, sessionToken });
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": iconFile.type || "application/octet-stream" }, body: iconFile });
      if (!res.ok) throw new Error("Icon upload failed");
      const payload = (await res.json()) as { storageId: Id<"_storage"> };
      iconStorageId = payload.storageId;
    }
    await updateProject({
      projectId: project._id,
      sessionToken,
      name,
      description,
      repoUrl,
      iconType,
      ...(iconType === "emoji" ? { iconValue: normalizeProjectEmoji(iconEmoji) } : {}),
      ...(iconType === "icon" ? { iconValue: iconName } : {}),
      ...(iconStorageId ? { iconStorageId } : {}),
    });
    setIconFile(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save project"); }
    finally { setBusy(false); }
  };
  const del = async () => { if (!window.confirm(`Delete ${project.name} and all its issues, assets and secrets?`)) return; setBusy(true); try { await removeProject({ projectId: project._id, sessionToken }); } catch (error) { setError(error instanceof Error ? error.message : "Could not delete project"); setBusy(false); } };
  if (!["owner", "admin"].includes(project.memberRole)) return <div className="notice">Project settings are managed by workspace admins.</div>;
  return <form className="panel stack-form" onSubmit={submit}>
    <div className="project-icon-settings">
      <ProjectIcon project={{ ...project, iconType, iconValue: iconType === "emoji" ? iconEmoji : iconName }} size={22} />
      <label>Icon type<select value={iconType} onChange={e => setIconType(e.target.value as ProjectIconType)}><option value="default">Default icon</option><option value="emoji">Emoji</option><option value="icon">Icon library</option><option value="image">Upload image</option></select></label>
      {iconType === "emoji" && <label>Emoji<input value={iconEmoji} onChange={e => setIconEmoji(e.target.value)} placeholder="🚀" maxLength={64} required /></label>}
      {iconType === "image" && <label>Picture<input type="file" accept="image/*" onChange={e => setIconFile(e.target.files?.[0] ?? null)} /></label>}
    </div>
    {iconType === "icon" && <ProjectIconPicker value={iconName} onChange={setIconName} />}
    <label>Name<input value={name} onChange={e => setName(e.target.value)} required /></label>
    <label>GitHub repo URL<input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo or org/repo" /></label>
    <label>Brief<textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} /></label>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <button className="primary-button" disabled={busy}>{busy ? "Saving..." : saved ? "Saved" : "Save project"}</button>
    <button className="ghost-button danger" type="button" disabled={busy} onClick={del}><Trash2 size={15} /> Delete project</button>
  </form>;
}

function BoardTab({ project, projectId, sessionToken, canEdit, userEmail, onCreateIssue }: { project: ProjectWithUi; projectId: Id<"projects">; sessionToken: string; canEdit: boolean; userEmail: string; onCreateIssue: () => void }) {
  const openMember = useMemberProfile();
  const board = useQuery(api.tasks.board, { projectId, sessionToken });
  const updateTask = useMutation(api.tasks.updateTask);
  const moveTask = useMutation(api.tasks.moveTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const [dragTaskId, setDragTaskId] = useState<Id<"tasks"> | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [boardNotice, setBoardNotice] = useState("");
  const [archive, setArchive] = useState(false);
  const [mine, setMine] = useState(false);
  const [completedColumnId, setCompletedColumnId] = useState<Id<"columns"> | null>(null);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const [columnEditor, setColumnEditor] = useState<Doc<"columns"> | "new" | null>(null);

  useEffect(() => {
    setBoardNotice("");
  }, [projectId]);

  if (!board) return <LoadingState label="Loading board" />;
  const assignees = new Map(board.assignees?.map(member => [member.email, member]));
  const visualColumns = board.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done")).map(column => ({ ...column, displayTitle: column.title }));
  const matches = (task: Doc<"tasks">) => (!mine || task.assignedToEmail === userEmail) && `${task.title} ${task.assignedToName || ""} ${task.priority} ${taskKey(task._id)}`.toLowerCase().includes(filter.toLowerCase());
  const visibleColumnIds = new Set(visualColumns.map((column) => column._id));
  const fallbackColumn = visualColumns.find(column => column.title.toLowerCase() === "todo") || visualColumns[0];
  const columnForTask = (task: Doc<"tasks">) => visibleColumnIds.has(task.columnId) ? task.columnId : fallbackColumn?._id;
  const archivedTasks = board.tasks.filter(task => task.done && matches(task) && (!completedColumnId || columnForTask(task) === completedColumnId)).sort((a, b) => b.updatedAt - a.updatedAt);
  const showCompleted = (columnId: Id<"columns"> | null) => { setCompletedColumnId(columnId); setArchive(true); };
  const move = (columnId: Id<"columns">, beforeTaskId?: Id<"tasks">) => {
    if (canEdit && dragTaskId) moveTask({ projectId, sessionToken, taskId: dragTaskId, columnId, beforeTaskId });
    setDragTaskId(null);
  };
  return (
    <section className="board-section">
      <div className="board-header">
        <div className="segmented-control"><button className={!archive ? "active" : ""} onClick={() => setArchive(false)}><Columns3 size={14} />Active<span>{board.tasks.filter(t => !t.done && matches(t)).length}</span></button><button className={archive ? "active" : ""} onClick={() => showCompleted(null)}><CheckCircle2 size={14} />Completed<span>{board.tasks.filter(t => t.done && matches(t)).length}</span></button></div>
        <div className="board-header-actions">
          <select aria-label="Issue assignee filter" value={mine ? "mine" : "all"} onChange={e => setMine(e.target.value === "mine")}><option value="mine">Assigned to me</option><option value="all">All issues</option></select>
          {canEdit && <button className="board-column-button" aria-label="Add column" title="Add column" onClick={() => setColumnEditor("new")}><Columns3 size={15} /><span>Column</span><Plus size={13} /></button>}
          <div className="board-filter-control">
            <button ref={filterButton} className={`icon-button ${filter ? "selected" : ""}`} aria-label="Search issues" title="Search issues" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><Search size={16} /></button>
            {filterOpen && <div className="board-filter-popover"><input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search issues" aria-label="Search project issues" onKeyDown={event => { if (event.key === "Escape") { setFilterOpen(false); filterButton.current?.focus(); } }} /><button className="icon-button" aria-label="Close issue filter" onClick={() => { setFilterOpen(false); filterButton.current?.focus(); }}><X size={14} /></button></div>}
          </div>
          {canEdit && <button className="primary-button compact project-create-issue" onClick={onCreateIssue}><Plus size={15} />Create issue</button>}
        </div>
      </div>
      {!canEdit ? <div className="notice">You have view-only access to this project, so issue creation is disabled.</div> : null}
      {boardNotice ? <div className="notice danger">{boardNotice}</div> : null}
      {archive ? <div className="archive-list">{completedColumnId && <div className="completed-scope"><span>{visualColumns.find(c => c._id === completedColumnId)?.title}</span><button className="ghost-button compact" onClick={() => showCompleted(null)}>All completed<X size={13} /></button></div>}{!archivedTasks.length && <EmptyBlock icon={CheckCircle2} title="No completed issues" body={filter ? "No issues match your search." : "Completed work will appear here."} />}{archivedTasks.map(task => <div key={task._id} className="archive-row"><CheckCircle2 size={16} /><button className="archive-issue" onClick={() => setSelectedTaskId(task._id)}><span>{taskKey(task._id)}</span><strong>{task.title}</strong></button><time>{fmtDate(task.updatedAt)}</time>{canEdit && <button className="ghost-button compact" onClick={async () => { const target = columnForTask(task); if (!target) { setBoardNotice("Add a workflow column before restoring an issue"); return; } try { if (!visibleColumnIds.has(task.columnId)) await moveTask({ projectId, sessionToken, taskId: task._id, columnId: target }); await updateTask({ projectId, sessionToken, taskId: task._id, done: false }); } catch (error) { setBoardNotice(error instanceof Error ? error.message : "Could not restore issue"); } }}><ArrowLeft size={13} />Restore</button>}</div>)}</div> : <div className="kanban-scroll">
        {visualColumns.map((column, index) => {
          const tasks = board.tasks.filter(task => !task.done && matches(task) && columnForTask(task) === column._id);
          const completedCount = board.tasks.filter(task => task.done && matches(task) && columnForTask(task) === column._id).length;
          const prev = visualColumns[index - 1];
          const next = visualColumns[index + 1];
          return (
            <div
              className={clsx("kanban-column", laneTone(column.displayTitle), dragTaskId && "drag-target")}
              key={column._id}
              onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
              onDrop={() => move(column._id)}
            >
              <div className="kanban-title">
                <div>
                  <span className="column-dot" />
                  <strong>{column.displayTitle}</strong>
                </div>
                <div className="kanban-tools">
                  <span>{tasks.length}</span>
                  {canEdit && <button className="icon-button" title={`Edit ${column.title} column`} aria-label={`Edit ${column.title} column`} onClick={() => setColumnEditor(column)}><MoreHorizontal size={15} /></button>}
                </div>
              </div>
              <div className="task-list">
                {tasks.length === 0 ? <div className="empty-lane">{completedCount ? <button className="archive-lane-link" aria-label={`View ${completedCount} completed issues in ${column.title}`} onClick={() => showCompleted(column._id)}><CheckCircle2 size={16} />{completedCount} completed</button> : filter ? "No matching issues" : "No issues"}</div> : null}
                {tasks.map((task) => (
                  <article
                    className={clsx("task-card", task.done && "done", dragTaskId === task._id && "dragging")}
                    key={task._id}
                    draggable={canEdit}
                    onDragStart={() => setDragTaskId(task._id)}
                    onDragEnd={() => setDragTaskId(null)}
                    onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
                    onDrop={(event) => {
                      event.stopPropagation();
                      move(column._id, task._id);
                    }}
                    onClick={() => setSelectedTaskId(task._id)}
                    tabIndex={0}
                    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedTaskId(task._id); } }}
                  >
                    <div className="task-card-head">
                      <span className="task-code">{taskKey(task._id)}</span>
                      <button className="drag-handle" type="button" disabled={!canEdit} aria-label="Drag task">
                        <GripVertical size={14} />
                      </button>
                    </div>
                    <div className="task-top">
                      <button
                        className="check-button"
                        aria-label={`Complete ${task.title}`}
                        type="button"
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateTask({ projectId, sessionToken, taskId: task._id, done: !task.done }).catch(error => setBoardNotice(error.message));
                        }}
                      >
                        {task.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                      </button>
                      <strong>{task.title}</strong>
                    </div>
                    <div className="task-meta">
                      <span className={clsx("priority", task.priority)}><Flag size={11} /> {task.priority}</span>
                      {task.assignedToEmail && (() => { const member = assignees.get(task.assignedToEmail) || { name: task.assignedToName || task.assignedToEmail, email: task.assignedToEmail }; const nickname = sidebarUsername(member); return <button className="task-assignee-profile" title={nickname} aria-label={`View ${nickname} profile`} onClick={event => { event.stopPropagation(); openMember(member.email); }}><UserAvatar user={member} size="small" /></button>; })()}
                    </div>
                    <div className="task-actions" onClick={(event) => event.stopPropagation()}>
                      <button type="button" disabled={!canEdit || !prev} onClick={() => prev && moveTask({ projectId, sessionToken, taskId: task._id, columnId: prev._id })} aria-label="Move task left"><ArrowLeft size={14} /></button>
                      <button type="button" disabled={!canEdit || !next} onClick={() => next && moveTask({ projectId, sessionToken, taskId: task._id, columnId: next._id })} aria-label="Move task right"><ArrowRight size={14} /></button>
                      <button type="button" disabled={!canEdit} onClick={() => { if (window.confirm(`Delete \"${task.title}\"?`)) void deleteTask({ projectId, sessionToken, taskId: task._id }); }} aria-label="Delete task"><Trash2 size={14} /></button>
                    </div>
                  </article>
                ))}
              </div>
              {tasks.length > 0 && completedCount > 0 && <button className="archive-lane-link completed-lane-footer" aria-label={`View ${completedCount} completed issues in ${column.title}`} onClick={() => showCompleted(column._id)}><CheckCircle2 size={14} />{completedCount} completed</button>}
            </div>
          );
        })}
      </div>}
      {columnEditor && <ColumnEditor column={columnEditor === "new" ? null : columnEditor} columns={visualColumns} projectId={projectId} sessionToken={sessionToken} onClose={() => setColumnEditor(null)} />}
      {selectedTaskId ? <TaskModal project={project} projectId={projectId} sessionToken={sessionToken} taskId={selectedTaskId} canEdit={canEdit} onClose={() => setSelectedTaskId(null)} /> : null}
    </section>
  );
}

function ColumnEditor({ column, columns, projectId, sessionToken, onClose }: { column: Doc<"columns"> | null; columns: Doc<"columns">[]; projectId: Id<"projects">; sessionToken: string; onClose: () => void }) {
  const [title, setTitle] = useState(column?.title || "");
  const [destination, setDestination] = useState(columns.find(c => c._id !== column?._id)?._id || "");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = useMutation(api.tasks.createColumn);
  const update = useMutation(api.tasks.updateColumn);
  const remove = useMutation(api.tasks.deleteColumn);
  return <Dialog title={column ? "Edit column" : "New column"} onClose={onClose}><form className="dialog-body stack-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { if (column) await update({ projectId, sessionToken, columnId: column._id, title, isDone: false }); else await create({ projectId, sessionToken, title, isDone: false }); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "Could not save column"); } finally { setBusy(false); } }}><label>Name<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required maxLength={60} /></label>{error && <p className="notice danger">{error}</p>}<div className="dialog-actions"><button className="primary-button compact" disabled={busy}>Save column</button>{column && columns.length > 1 && <button className="ghost-button danger compact" type="button" onClick={() => setDeleting(!deleting)}><Trash2 size={14} />Delete column</button>}</div>{deleting && column && <div className="column-delete-form"><label>Move its issues to<select value={destination} onChange={e => setDestination(e.target.value as Id<"columns">)}>{columns.filter(c => c._id !== column._id).map(c => <option key={c._id} value={c._id}>{c.title}</option>)}</select></label><button type="button" className="ghost-button danger" disabled={busy} onClick={async () => { setBusy(true); try { await remove({ projectId, sessionToken, columnId: column._id, moveToColumnId: destination as Id<"columns"> }); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "Could not delete column"); } finally { setBusy(false); } }}>Delete and move issues</button></div>}</form></Dialog>;
}

function TaskModal({
  project,
  projectId,
  sessionToken,
  taskId,
  canEdit,
  onClose,
}: {
  project: ProjectWithUi;
  projectId: Id<"projects">;
  sessionToken: string;
  taskId: Id<"tasks">;
  canEdit: boolean;
  onClose: () => void;
}) {
  const details = useQuery(api.tasks.details, { projectId, sessionToken, taskId });
  const updateTask = useMutation(api.tasks.updateTask);
  const moveTask = useMutation(api.tasks.moveTask);
  const addComment = useMutation(api.tasks.addComment);
  const addAsset = useMutation(api.tasks.addAsset);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedToEmail, setAssignedToEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [columnId, setColumnId] = useState<Id<"columns"> | "">("");
  const [comment, setComment] = useState("");
  const [assetType, setAssetType] = useState<TaskAssetType>("link");
  const [assetName, setAssetName] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [githubState, setGithubState] = useState<"idle" | "creating" | "created" | "fallback" | "error">("idle");
  const [githubNotice, setGithubNotice] = useState("");
  const hydratedRef = useRef(false);
  const lastSaved = useRef({ title: "", description: "", priority: "medium" as Priority, assignedToEmail: "", dueDate: "" });
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!details?.task) return;
    hydratedRef.current = false;
    setTitle(details.task.title);
    setDescription(details.task.description || "");
    setPriority(details.task.priority);
    setAssignedToEmail(details.task.assignedToEmail || "");
    setDueDate(details.task.dueDate || "");
    lastSaved.current = { title: details.task.title, description: details.task.description || "", priority: details.task.priority, assignedToEmail: details.task.assignedToEmail || "", dueDate: details.task.dueDate || "" };
    setColumnId(details.task.columnId);
    setSaveState("idle");
    setGithubState("idle");
    setGithubNotice("");
    const handle = window.setTimeout(() => { hydratedRef.current = true; }, 0);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id]);

  const saveDraft = useCallback(() => {
    if (!canEdit || !hydratedRef.current) return Promise.resolve();
    const draft = { title: title.trim(), description, priority, assignedToEmail, dueDate };
    const save = saving.current.catch(() => {}).then(async () => {
      const patch: Partial<typeof draft> = {};
      for (const key of Object.keys(draft) as (keyof typeof draft)[]) {
        if (draft[key] !== lastSaved.current[key]) Object.assign(patch, { [key]: draft[key] });
      }
      if (!Object.keys(patch).length) return;
      if (!draft.title || patch.assignedToEmail === "" || patch.dueDate === "") {
        setSaveState("error"); throw new Error("Title, assignee and due date cannot be empty");
      }
      setSaveState("saving");
      try {
        await updateTask({ projectId, sessionToken, taskId, ...patch });
        lastSaved.current = draft; setSaveState("saved");
      } catch (error) { setSaveState("error"); throw error; }
    });
    saving.current = save;
    return save;
  }, [assignedToEmail, canEdit, description, dueDate, priority, projectId, sessionToken, taskId, title, updateTask]);
  useEffect(() => {
    if (!details?.task || !hydratedRef.current) return;
    const handle = window.setTimeout(() => { void saveDraft().catch(() => {}); }, 500);
    return () => window.clearTimeout(handle);
  }, [details?.task?._id, saveDraft]);
  const closeIssue = () => { void saveDraft().then(onClose).catch(error => setActivityError(error instanceof Error ? error.message : "Could not save issue")); };

  const changeColumn = async (value: string) => {
    if (!canEdit || !value) return;
    const nextColumnId = value as Id<"columns">;
    setColumnId(nextColumnId);
    setSaveState("saving");
    try {
      await moveTask({ projectId, sessionToken, taskId, columnId: nextColumnId });
      setSaveState("saved");
    } catch {
      setColumnId(details?.task.columnId || "");
      setSaveState("error");
    }
  };
  const submitComment = async (e: FormEvent) => {
    e.preventDefault(); if (!comment.trim() || activityBusy) return;
    setActivityBusy(true); setActivityError("");
    try { await addComment({ projectId, sessionToken, taskId, body: comment }); setComment(""); }
    catch (error) { setActivityError(error instanceof Error ? error.message : "Could not post comment"); }
    finally { setActivityBusy(false); }
  };
  const submitAsset = async (e: FormEvent) => {
    e.preventDefault(); if (!assetName.trim() || !assetUrl.trim() || activityBusy) return;
    setActivityBusy(true); setActivityError("");
    try { await addAsset({ projectId, sessionToken, taskId, type: assetType, name: assetName, url: assetUrl }); setAssetName(""); setAssetUrl(""); setAttachmentOpen(false); }
    catch (error) { setActivityError(error instanceof Error ? error.message : "Could not attach link"); }
    finally { setActivityBusy(false); }
  };
  const activity = details ? [...details.comments.map((item) => ({ kind: "comment" as const, at: item.createdAt, item })), ...details.assets.map((item) => ({ kind: "asset" as const, at: item.createdAt, item }))].sort((a, b) => a.at - b.at) : [];
  const linkedGitHubAsset = details?.assets.find((asset) => asset.url.includes("github.com") && /\/issues\/\d+/.test(asset.url));
  const linkedGitHubUrl = details?.task.githubIssueUrl || linkedGitHubAsset?.url;
  const githubIssueHref = details?.task
    ? githubNewIssueHref(
        project.repoUrl,
        details.task.title,
        [details.task.description, `Origin issue: ${taskKey(details.task._id)}`].filter(Boolean).join("\n\n"),
      )
    : null;
  const createGitHubIssue = async () => {
    if (!details?.task || !canEdit || !project.repoUrl) return;
    setGithubState("creating");
    setGithubNotice("");
    try {
      await saveDraft();
      const result = await localApi<{ ok: boolean; issueUrl: string; issueNumber: number; message: string }>("/api/github/issues", sessionToken, {
        method: "POST", json: { projectId, taskId },
      });
      setGithubState("created");
      setGithubNotice(result.message);
    } catch (error) {
      setGithubState("error");
      setGithubNotice(error instanceof Error ? error.message : "GitHub issue creation failed");
    }
  };
  return <Dialog title={details ? `${taskKey(details.task._id)} / ${project.name}` : "Issue details"} className="issue-detail-dialog" onClose={closeIssue}>
    {details ? <div className="issue-detail-layout">
      <section className="issue-description-section">
        <div className="issue-detail-status" aria-live="polite">
          {details.task.done && <span className="issue-completed-badge"><CheckCircle2 size={14} />Completed</span>}
          <span className={saveState === "error" ? "danger" : ""}>{saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved. Check required fields." : "All changes saved"}</span>
        </div>
        <textarea className="issue-title-input" aria-label="Issue title" value={title} onChange={event => setTitle(event.target.value)} disabled={!canEdit} rows={2} maxLength={250} required />
        <textarea className="issue-detail-description" aria-label="Issue description" value={description} onChange={event => setDescription(event.target.value)} rows={5} placeholder="Add a description..." disabled={!canEdit} />
        <IssueRelations sessionToken={sessionToken} taskId={taskId} canEdit={canEdit} onOpen={(targetProject, targetTask) => { void saveDraft().then(() => { const url = new URL(window.location.href); url.search = new URLSearchParams({ project: targetProject, issue: targetTask }).toString(); window.location.href = url.toString(); }).catch(() => setSaveState("error")); }} />
      </section>
      <aside className="issue-detail-sidebar" aria-label="Issue properties">
        <h3>Properties</h3>
        <IssueFields columns={details.columns.filter(column => !(column.isDone ?? column.title.toLowerCase() === "done"))} members={details.members} columnId={columnId} onColumnChange={value => void changeColumn(value)} priority={priority} onPriorityChange={setPriority} assignee={assignedToEmail} onAssigneeChange={setAssignedToEmail} dueDate={dueDate} onDueDateChange={setDueDate} disabled={!canEdit} />
        <section className="issue-github-section">
          <h3><GitBranch size={14} />GitHub</h3>
          <span className="issue-repository-name">{githubRepoLabel(project.repoUrl)}</span>
          {linkedGitHubUrl ? <a className="ghost-button compact" href={linkedGitHubUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open GitHub issue</a>
            : githubIssueHref ? <button className="ghost-button compact" type="button" onClick={createGitHubIssue} disabled={!canEdit || githubState === "creating"}>{githubState === "creating" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}{githubState === "creating" ? "Creating..." : "Create GitHub issue"}</button>
            : null}
          {githubNotice && <small className={clsx("github-notice", githubState === "error" && "danger")}>{githubNotice}</small>}
        </section>
        <dl className="issue-date-summary"><div><dt>Created</dt><dd>{fmtDate(details.task.createdAt)}</dd></div><div><dt>Updated</dt><dd>{fmtDate(details.task.updatedAt)}</dd></div></dl>
      </aside>
      <section className="issue-detail-activity">
        <header><h3><MessageCircle size={15} />Activity <span>{activity.length}</span></h3></header>
        <div className="issue-timeline">
          {!activity.length && <p className="activity-empty">No activity yet.</p>}
          {activity.map(entry => <article className="issue-timeline-entry" key={entry.item._id}>
            <span className="activity-avatar" aria-hidden="true">{entry.kind === "comment" ? initials(entry.item.authorName) : <Paperclip size={14} />}</span>
            <div className="activity-entry-content"><header><strong>{entry.kind === "comment" ? entry.item.authorName : "Attachment"}</strong><time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(entry.at)}</time></header>
              {entry.kind === "comment" ? <p>{entry.item.body}</p> : <a className="activity-attachment" href={entry.item.url} target="_blank" rel="noreferrer"><span>{entry.item.name}</span><ExternalLink size={13} /></a>}
            </div>
          </article>)}
        </div>
        {canEdit && <form className="issue-comment-composer" onSubmit={submitComment}>
          <textarea aria-label="Comment" value={comment} onChange={event => setComment(event.target.value)} rows={3} placeholder="Leave a comment..." disabled={activityBusy} maxLength={10000} />
          <footer><button type="button" className="icon-button" title="Attach a link" aria-label="Attach a link" aria-expanded={attachmentOpen} onClick={() => setAttachmentOpen(!attachmentOpen)}><Paperclip size={16} /></button><button className="send-message" type="submit" title="Send comment" aria-label="Send comment" disabled={activityBusy || !comment.trim()}>{activityBusy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={19} strokeWidth={2.2} />}</button></footer>
        </form>}
        {attachmentOpen && canEdit && <form className="issue-attachment-form" onSubmit={submitAsset}>
          <label>Type<select value={assetType} onChange={event => setAssetType(event.target.value as TaskAssetType)} disabled={activityBusy}>{taskAssetTypes.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Name<input value={assetName} onChange={event => setAssetName(event.target.value)} placeholder="Attachment name" required disabled={activityBusy} /></label>
          <label className="attachment-url">URL<input type="url" value={assetUrl} onChange={event => setAssetUrl(event.target.value)} placeholder="https://" required disabled={activityBusy} /></label>
          <button className="ghost-button compact" type="submit" disabled={activityBusy}><Paperclip size={14} />Attach</button>
        </form>}
        {activityError && <div className="notice danger" role="alert">{activityError}</div>}
      </section>
    </div> : <div className="dialog-body"><LoadingState label="Opening issue" /></div>}
  </Dialog>;
}

function RepoTab({ project, sessionToken }: { project: Doc<"projects"> & { memberRole: string }; sessionToken: string }) {
  const approveRepository = useMutation(api.integrations.approveRepository);
  const [repoNotice, setRepoNotice] = useState("");
  const savedCommits = useQuery(api.commits.list, { projectId: project._id, sessionToken });
  const [revision, setRevision] = useState(0);
  const github = useGitHubSnapshot(project._id, project.repoUrl, sessionToken, revision);
  const commits = github.snapshot?.commits ?? savedCommits;
  return (
    <section className="repo-dashboard">
      <div className="grid two repo-grid">
        <div className="panel">
          {project.repoUrl ? <a className="repo-link" href={githubRepoHref(project.repoUrl) || project.repoUrl} target="_blank" rel="noreferrer"><LinkIcon size={16} /> {githubRepoLabel(project.repoUrl)} <ExternalLink size={14} /></a> : <RepositoryProvisioning project={project} sessionToken={sessionToken} />}
          <div className="repo-health">
            <div><span>Commits</span><strong>{commits?.length ?? "…"}</strong></div>
            <div><span>Open issues</span><strong>{github.snapshot?.issues.filter((issue) => issue.state === "open").length ?? "…"}</strong></div>
            <div><span>PRs</span><strong>{github.snapshot?.pullRequests.length ?? "…"}</strong></div>
          </div>
          {github.loading ? <LoadingState label="GitHub issues" /> : null}
          {github.error ? <div className="notice danger">{github.error}</div> : null}
          {github.snapshot?.commitsError && <div className="notice">{github.snapshot.commitsError}</div>}
          {project.repoUrl && !project.githubWorkspaceAccess && ["owner", "admin"].includes(project.memberRole) && <button className="ghost-button compact" onClick={async () => { try { await approveRepository({ sessionToken, projectId: project._id }); setRevision(value => value + 1); } catch { setRepoNotice("Could not authorize repository access"); } }}><GitBranch size={14} />Use workspace GitHub connection</button>}
          <GitHubConnection projectId={project._id} repoUrl={project.repoUrl} sessionToken={sessionToken} canManage={["owner", "admin"].includes(project.memberRole)} onChange={() => setRevision(value => value + 1)} />
        </div>
        <div className="panel commit-panel">
          <div className="panel-title"><GitCommit size={17} /> Commits</div>
          {commits === undefined ? <LoadingState label="Commits" /> : null}
          {commits?.length === 0 ? <EmptyBlock icon={GitCommit} title="No commits yet" body="Connect GitHub repo in Settings." /> : null}
          <div className="commit-list">{commits?.map((commit) => <article key={commit.sha} className="commit-row"><div className="sha">{shortSha(commit.sha)}</div><div><strong>{commit.message}</strong><p>{commit.author} · {fmtDate(commit.committedAt)}</p></div><div className="row-actions">{commit.url ? <a href={commit.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a> : null}</div></article>)}</div>
        </div>
      </div>
      <div className="grid two repo-grid">
        <div className="panel github-list-panel">
          <div className="panel-title"><Circle size={17} /> GitHub issues</div>
          {!project.repoUrl ? <EmptyBlock icon={GitBranch} title="No repo connected" body="Add the GitHub URL in Settings to preview issues here." /> : null}
          {github.snapshot?.issues.length === 0 ? <EmptyBlock icon={Circle} title="No GitHub issues" body="Origin issues can be converted from their detail view." /> : null}
          <div className="github-list">
            {github.snapshot?.issues.map((issue) => (
              <a className="github-row" key={issue.number} href={issue.url} target="_blank" rel="noreferrer">
                <span className={clsx("github-state", issue.state)}>{issue.state}</span>
                <div><strong>#{issue.number} {issue.title}</strong><p>{issue.author || "GitHub"} · {fmtDate(issue.updatedAt)}</p></div>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </div>
        <div className="panel github-list-panel">
          <div className="panel-title"><GitBranch size={17} /> Pull requests</div>
          {github.snapshot?.pullRequests.length === 0 ? <EmptyBlock icon={GitBranch} title="No PRs yet" body="Open pull requests will appear here once the repo is connected." /> : null}
          <div className="github-list">
            {github.snapshot?.pullRequests.map((pullRequest) => (
              <a className="github-row" key={pullRequest.number} href={pullRequest.url} target="_blank" rel="noreferrer">
                <span className={clsx("github-state", pullRequest.state)}>{pullRequest.state}</span>
                <div><strong>#{pullRequest.number} {pullRequest.title}</strong><p>{pullRequest.branch || pullRequest.author || "GitHub"} · {fmtDate(pullRequest.updatedAt)}</p></div>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
