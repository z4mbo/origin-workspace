import { z } from "zod";

const id = z.string().min(8).max(100);
const name = z.string().trim().min(1).max(150);
const text = z.string().max(60000);
const priority = z.enum(["low", "medium", "high"]);
const role = z.enum(["admin", "member", "viewer"]);
const assetType = z.enum(["figma", "image", "icon", "font", "document", "apk", "other"]);
const url = z.url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL");
const project = { projectId: id };
const issue = { ...project, taskId: id };
export const agentRead = z.object({
  kind: z.enum(["projects", "project", "issues", "issue", "members", "inbox", "notifications", "comments", "assets", "documents", "document", "vault", "invitations", "conversations", "messages", "calls"]),
  projectId: id.optional(), taskId: id.optional(), pageId: id.optional(), done: z.boolean().optional(),
  cursor: z.string().max(4000).optional(), conversationId: z.string().max(220).optional(), search: z.string().max(160).optional(), before: z.number().int().positive().optional(),
}).strict();

export const agentChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_project"), name: name.max(100), description: text.max(10000).optional() }).strict(),
  z.object({ kind: z.literal("update_project"), ...project, name: name.max(100).optional(), description: text.max(10000).optional(), status: z.enum(["active", "inactive"]).optional() }).strict(),
  z.object({ kind: z.literal("delete_project"), ...project }).strict(),
  z.object({ kind: z.literal("create_issue"), ...project, columnId: id, title: name.max(250), description: text.optional(), priority, assignedToEmail: z.email(), dueDate: z.iso.date() }).strict(),
  z.object({ kind: z.literal("update_issue"), ...issue, title: z.string().trim().min(1).max(250).optional(), description: text.optional(), priority: priority.optional(), assignedToEmail: z.email().optional(), dueDate: z.iso.date().optional(), done: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("delete_issue"), ...issue }).strict(),
  z.object({ kind: z.literal("move_issue"), ...issue, columnId: id }).strict(),
  z.object({ kind: z.literal("add_comment"), ...issue, body: text.min(1).max(8000) }).strict(),
  z.object({ kind: z.literal("create_column"), ...project, title: name.max(60) }).strict(),
  z.object({ kind: z.literal("update_column"), ...project, columnId: id, title: name.max(60) }).strict(),
  z.object({ kind: z.literal("delete_column"), ...project, columnId: id, moveToColumnId: id.optional() }).strict(),
  z.object({ kind: z.literal("create_asset"), ...project, name, type: assetType, url, notes: text.max(10000).optional() }).strict(),
  z.object({ kind: z.literal("update_asset"), ...project, assetId: id, name: name.optional(), type: assetType.optional(), url: url.optional(), notes: text.max(10000).optional() }).strict(),
  z.object({ kind: z.literal("delete_asset"), ...project, assetId: id }).strict(),
  z.object({ kind: z.literal("create_document"), ...project, title: name, content: text }).strict(),
  z.object({ kind: z.literal("update_document"), ...project, pageId: id, title: name.optional(), content: text.optional() }).strict(),
  z.object({ kind: z.literal("delete_document"), ...project, pageId: id }).strict(),
  z.object({ kind: z.literal("invite_member"), projectId: id.optional(), email: z.email().optional(), role, sendEmail: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal("revoke_invite"), inviteId: id }).strict(),
  z.object({ kind: z.literal("update_workspace"), name: name.max(60) }).strict(),
  z.object({ kind: z.literal("update_member"), memberId: id, role }).strict(),
  z.object({ kind: z.literal("remove_member"), memberId: id }).strict(),
  z.object({ kind: z.literal("send_message"), conversationId: z.string().max(220).optional(), body: text.trim().min(1).max(8000) }).strict(),
  z.object({ kind: z.literal("edit_message"), conversationId: z.string().max(220).optional(), messageId: id, body: text.trim().min(1).max(8000) }).strict(),
  z.object({ kind: z.literal("delete_message"), conversationId: z.string().max(220).optional(), messageId: id }).strict(),
  z.object({ kind: z.literal("mark_notification"), notificationId: id, read: z.boolean() }).strict(),
  z.object({ kind: z.literal("request_vault"), ...project, credentialId: id, reason: z.string().trim().min(1).max(500) }).strict(),
]);

export type AgentRead = z.infer<typeof agentRead>;
export type AgentChange = z.infer<typeof agentChange>;
export const basicAgentReads = new Set(["projects", "project", "issues", "issue", "members", "inbox", "notifications"]);
export const basicAgentChanges = new Set(["create_project", "update_project", "create_issue", "update_issue"]);
export const AGENT_MODEL = "gpt-6-luna";
