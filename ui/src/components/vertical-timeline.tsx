"use client";

import { useState } from "react";
import type { Message, Task } from "@/lib/types";

type TimelineEntry =
  | { type: "message"; data: Message; timestamp: string }
  | { type: "task"; data: Task; timestamp: string };

interface VerticalTimelineProps {
  messages: Message[];
  tasks: Task[];
}

const KIND_DOT_CLASSES: Record<string, string> = {
  context: "border-info bg-info-dim shadow-[0_0_8px_var(--color-info-dim)]",
  task: "border-accent bg-accent-dim shadow-[0_0_8px_var(--color-accent-dim)]",
  status: "border-success bg-success-dim shadow-[0_0_8px_var(--color-success-dim)]",
  reply: "border-reply bg-reply-dim shadow-[0_0_8px_var(--color-reply-dim)]",
};

const KIND_BADGE_CLASSES: Record<string, string> = {
  context: "bg-info-dim text-info border border-info-border",
  task: "bg-accent-dim text-accent border border-accent-border",
  status: "bg-success-dim text-success border border-success-border",
  reply: "bg-reply-dim text-reply border border-reply-border",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: "bg-[rgba(255,255,255,0.06)] text-text-secondary border border-border",
  in_progress: "bg-accent-dim text-accent border border-accent-border",
  completed: "bg-success-dim text-success border border-success-border",
  failed: "bg-error-dim text-error border border-error-border",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function MessageCard({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = msg.payload.length > 200;
  const display = expanded || !truncated ? msg.payload : msg.payload.slice(0, 200) + "...";

  return (
    <div className="bg-surface border border-border rounded-md p-[var(--s4)] transition-colors duration-150 hover:border-[rgba(255,255,255,0.12)]">
      <div className="flex items-center gap-[var(--s2)] mb-[var(--s2)]">
        <span className={`inline-flex items-center text-[11px] font-semibold px-[var(--s2)] py-0.5 rounded-full tracking-wide ${KIND_BADGE_CLASSES[msg.kind] ?? ""}`}>
          {msg.kind}
        </span>
        <span className="text-[13px] font-medium text-text-primary">
          {msg.sender} <span className="text-text-tertiary mx-[var(--s1)]">&rarr;</span> {msg.recipient}
        </span>
      </div>
      <div className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
        {display}
      </div>
      {truncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="bg-transparent border-none text-accent font-sans text-xs font-medium cursor-pointer mt-[var(--s2)] p-0 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="bg-[linear-gradient(135deg,rgba(124,106,245,0.04),transparent)] border border-border border-l-2 border-l-accent-border rounded-md p-[var(--s4)] transition-colors duration-150 hover:border-[rgba(255,255,255,0.12)]">
      <div className="flex items-center gap-[var(--s2)] mb-[var(--s2)]">
        <span className={`inline-flex items-center text-[11px] font-semibold px-[var(--s2)] py-0.5 rounded-full tracking-wide ${STATUS_BADGE_CLASSES[task.status] ?? ""}`}>
          {task.status}
        </span>
        <span className="text-sm font-semibold text-text-primary">{task.domain}</span>
        {task.assigned_to && (
          <span className="text-xs text-text-secondary font-medium">&rarr; {task.assigned_to}</span>
        )}
      </div>
      <p className="text-[13px] text-text-secondary leading-normal mt-[var(--s2)]">{task.summary}</p>
    </div>
  );
}

export function VerticalTimeline({ messages, tasks }: VerticalTimelineProps) {
  const items: TimelineEntry[] = [
    ...messages.map((m) => ({ type: "message" as const, data: m, timestamp: m.created_at })),
    ...tasks.map((t) => ({ type: "task" as const, data: t, timestamp: t.created_at })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (items.length === 0) {
    return <p className="text-text-secondary text-sm">No messages or tasks yet.</p>;
  }

  return (
    <div className="relative pl-[100px]">
      {/* Vertical connecting line */}
      <div className="absolute left-[67px] top-0 bottom-0 w-px bg-[linear-gradient(to_bottom,var(--color-accent-border),var(--color-border)_30%,var(--color-border)_70%,transparent)]" />

      {items.map((item) => {
        const isTask = item.type === "task";
        const kind = isTask ? "task" : (item.data as Message).kind;
        const dotClasses = isTask
          ? "w-3 h-3 -left-[39px] top-[17px] border-accent bg-accent-dim shadow-[0_0_8px_var(--color-accent-dim)]"
          : `w-[10px] h-[10px] -left-[38px] top-[18px] ${KIND_DOT_CLASSES[kind] ?? "border-text-tertiary bg-surface"}`;

        return (
          <div key={item.data.id} className="relative mb-[var(--s5)]">
            {/* Time marker */}
            <div className="absolute -left-[100px] top-[var(--s4)] w-[54px] text-right text-[11px] font-medium text-text-tertiary leading-tight">
              {formatTime(item.timestamp)}
            </div>
            {/* Dot */}
            <div className={`absolute rounded-full border-2 z-[2] ${dotClasses}`} />
            {/* Card */}
            {isTask ? (
              <TaskCard task={item.data as Task} />
            ) : (
              <MessageCard msg={item.data as Message} />
            )}
          </div>
        );
      })}
    </div>
  );
}
