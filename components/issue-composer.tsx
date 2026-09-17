"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Circle, Loader2, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog } from "./dialog";
import { IssueFields } from "./issue-fields";
import { useWorkspace } from "./workspace-context";

export function IssueComposer({
  sessionToken,
  projects,
  activeProjectId,
  onClose,
  onCreated,
  initialDraft,
}: {
  sessionToken: string;
  projects: { _id: Id<"projects">; name: string; memberRole: string }[];
  activeProjectId: Id<"projects"> | null;
  onClose: () => void;
  onCreated: (id: Id<"projects">, taskId: Id<"tasks">) => void;
  initialDraft?: { title: string; description: string };
}) {
  const workspace = useWorkspace();
  const editable = projects.filter((p) => p.memberRole !== "viewer");
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(
    editable.find((p) => p._id === activeProjectId)?._id ||
      editable[0]?._id ||
      null,
  );
  const [columnId, setColumnId] = useState("");
  const [title, setTitle] = useState(initialDraft?.title || "");
  const [description, setDescription] = useState(
    initialDraft?.description || "",
  );
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const board = useQuery(
    api.tasks.board,
    projectId ? { sessionToken, projectId } : "skip",
  );
  const members = useQuery(api.workspaces.members, {
    sessionToken,
    teamId: workspace._id,
  });
  const create = useMutation(api.tasks.createTask);
  const ensureColumns = useMutation(api.tasks.ensureDefaultColumns);
  const columns =
    board?.columns.filter(
      (c) => !(c.isDone ?? c.title.toLowerCase() === "done"),
    ) || [];
  useEffect(() => {
    if (board?.columns.length === 0 && projectId)
      void ensureColumns({ sessionToken, projectId }).catch((error) =>
        setError(error.message),
      );
  }, [board?.columns.length, projectId, ensureColumns, sessionToken]);
  const selectedColumn = columns.find((c) => c._id === columnId) || columns[0];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      busy ||
      !projectId ||
      !selectedColumn ||
      !title.trim() ||
      !assignee ||
      !dueDate
    )
      return;
    setBusy(true);
    setError("");
    try {
      const taskId = await create({
        projectId,
        sessionToken,
        columnId: selectedColumn._id,
        title,
        description,
        priority,
        assignedToEmail: assignee,
        dueDate,
      });
      onCreated(projectId, taskId);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create issue",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New issue"
      className="issue-composer-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="issue-composer-context">
          <Circle size={15} />
          <select
            aria-label="Project"
            value={projectId || ""}
            disabled={busy}
            onChange={(e) => {
              setProjectId(e.target.value as Id<"projects">);
              setColumnId("");
            }}
          >
            {editable.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {!editable.length ? (
          <div className="dialog-body muted">
            Create a project to add your first issue.
          </div>
        ) : (
          <div className="issue-composer-fields">
            <input
              className="issue-title-input"
              aria-label="Issue title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              required
              maxLength={250}
              disabled={busy}
            />
            <textarea
              aria-label="Issue description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={5}
              disabled={busy}
            />
            <select aria-label="Issue template" disabled={busy} value="" onChange={e => {
              const templates: Record<string, string> = { bug: "## What happened\n\n\n## Steps to reproduce\n1. \n\n## Expected behavior\n\n\n## Environment\n", feature: "## Problem\n\n\n## Proposed change\n\n\n## Acceptance criteria\n- [ ] \n", task: "## Goal\n\n\n## Checklist\n- [ ] \n" };
              if (e.target.value && (!description.trim() || window.confirm("Replace the current description with this template?"))) setDescription(templates[e.target.value]);
            }}><option value="">Apply template</option><option value="bug">Bug report</option><option value="feature">Feature request</option><option value="task">Task</option></select>
            <IssueFields
              columns={columns}
              members={members || []}
              columnId={selectedColumn?._id || ""}
              onColumnChange={setColumnId}
              priority={priority}
              onPriorityChange={setPriority}
              assignee={assignee}
              onAssigneeChange={setAssignee}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              disabled={busy}
            />
            {error && (
              <div role="alert" className="notice danger">
                {error}
              </div>
            )}
          </div>
        )}
        <footer className="dialog-footer">
          <button
            type="button"
            className="ghost-button compact"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button compact"
            disabled={
              busy || !title.trim() || !selectedColumn || !members?.length
            }
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            Create issue
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
