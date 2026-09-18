import { LinkifyIt } from "linkify-it";
import type { ChatMention, ChatReference } from "./localRealtime";

export type ChatTextPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "mention"; text: string; mention: ChatMention }
  | { kind: "reference"; text: string; reference: ChatReference };

const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false })
  .add("ftp:", null)
  .add("mailto:", null);
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function chatTextParts(body: string, mentions: ChatMention[] = [], references: ChatReference[] = []): ChatTextPart[] {
  const matches: { start: number; end: number; part: ChatTextPart }[] = [];
  for (const link of linkify.match(body) ?? []) {
    const href = link.schema === "" ? `https://${link.raw}` : link.url.startsWith("//") ? `https:${link.url}` : link.url;
    if (/^https?:\/\//i.test(href)) matches.push({ start: link.index, end: link.lastIndex, part: { kind: "link", text: link.raw, href } });
  }
  const tags: ChatTextPart[] = [
    ...mentions.map(mention => ({ kind: "mention" as const, text: `@${mention.name}`, mention })),
    ...references.map(reference => ({ kind: "reference" as const, text: `#${reference.label}`, reference })),
  ];
  for (const tag of tags) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_/@#.-])${escapePattern(tag.text)}(?![\\p{L}\\p{N}\\p{M}_/@#-]|\\.[\\p{L}\\p{N}])`, "gu");
    for (const match of body.matchAll(pattern)) matches.push({ start: match.index, end: match.index + match[0].length, part: tag });
  }
  // Earlier tokens own their contents: a URL can contain @names, and a tag can contain a domain.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: ChatTextPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) parts.push({ kind: "text", text: body.slice(cursor, match.start) });
    parts.push(match.part);
    cursor = match.end;
  }
  if (cursor < body.length) parts.push({ kind: "text", text: body.slice(cursor) });
  return parts;
}

export function activeChatTags(parts: ChatTextPart[]) {
  return {
    mentionIds: new Set(parts.flatMap(part => part.kind === "mention" ? [part.mention.userId] : [])),
    referenceIds: new Set(parts.flatMap(part => part.kind === "reference" ? [part.reference.id] : [])),
  };
}
