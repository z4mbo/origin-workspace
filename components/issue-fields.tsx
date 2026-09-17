"use client";

import { CalendarDays, Circle, Flag, UserRound } from "lucide-react";

export function IssueFields({ columns, members, columnId, onColumnChange, priority, onPriorityChange, assignee, onAssigneeChange, dueDate, onDueDateChange, disabled = false }: {
  columns: { _id: string; title: string }[]; members: { _id: string; name: string; email: string }[];
  columnId: string; onColumnChange: (value: string) => void;
  priority: "low" | "medium" | "high"; onPriorityChange: (value: "low" | "medium" | "high") => void;
  assignee: string; onAssigneeChange: (value: string) => void;
  dueDate: string; onDueDateChange: (value: string) => void; disabled?: boolean;
}) {
  return <div className="issue-field-grid">
    <label><span><Circle size={14} />Status</span><select aria-label="Status" required value={columnId} onChange={e => onColumnChange(e.target.value)} disabled={disabled}><option value="" disabled>Select status</option>{columns.map(column => <option key={column._id} value={column._id}>{column.title}</option>)}</select></label>
    <label><span><Flag size={14} />Priority</span><select aria-label="Priority" required value={priority} onChange={e => onPriorityChange(e.target.value as typeof priority)} disabled={disabled}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <label><span><UserRound size={14} />Assignee</span><select aria-label="Assignee" required value={assignee} onChange={e => onAssigneeChange(e.target.value)} disabled={disabled}><option value="" disabled>Select member</option>{assignee && !members.some(member => member.email === assignee) && <option value={assignee} disabled>{assignee} (inactive)</option>}{members.map(member => <option key={member._id} value={member.email}>{member.name}</option>)}</select></label>
    <label><span><CalendarDays size={14} />Due date</span><input aria-label="Due date" required type="date" value={dueDate} onChange={e => onDueDateChange(e.target.value)} disabled={disabled} /></label>
  </div>;
}
