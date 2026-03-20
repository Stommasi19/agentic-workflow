"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchMessages, fetchTasks } from "@/lib/api";
import { useSse } from "@/hooks/use-sse";
import { buildDirectedGraph, buildSequenceDiagram } from "@/lib/diagrams";
import { VerticalTimeline } from "@/components/vertical-timeline";
import { DiagramPanel } from "@/components/diagram-panel";
import { CopyButton } from "@/components/copy-button";
import type { Message, Task, BridgeEventType } from "@/lib/types";

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [msgs, tsks] = await Promise.all([
        fetchMessages(conversationId),
        fetchTasks(conversationId),
      ]);
      setMessages(msgs);
      setTasks(tsks);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { load(); }, [load]);
  useSse({
    onEvent: (_type: BridgeEventType, data: Record<string, string>) => {
      if (data.conversation === conversationId) load();
    },
  });

  const graphDef = buildDirectedGraph(messages);
  const seqDef = buildSequenceDiagram(messages);

  // Count unique agents
  const agents = new Set(messages.flatMap((m) => [m.sender, m.recipient]));

  return (
    <div className="max-w-[1440px] mx-auto px-[var(--s3)] py-[var(--s8)]">
      {/* Back link */}
      <a href="/" className="inline-flex items-center gap-[var(--s2)] text-sm text-text-secondary no-underline mb-[var(--s6)] hover:text-text-primary transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        All conversations
      </a>

      {/* Conversation header */}
      <div className="flex items-center gap-[var(--s4)] pb-[var(--s6)] mb-[var(--s6)] border-b border-border">
        <div className="w-12 h-12 bg-accent-dim border border-accent-border rounded-md flex items-center justify-center shrink-0 shadow-[0_0_24px_var(--color-accent-glow)]">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-accent">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold font-mono tracking-tight">{conversationId}</div>
          <div className="flex items-center gap-[var(--s2)] text-sm text-text-secondary mt-0.5">
            <span>{messages.length} messages</span>
            <span className="w-1 h-1 rounded-full bg-text-tertiary" />
            <span>{tasks.length} tasks</span>
            <span className="w-1 h-1 rounded-full bg-text-tertiary" />
            <span>{agents.size} agents</span>
          </div>
        </div>
        <CopyButton text={conversationId} />
      </div>

      {loading && messages.length === 0 ? (
        <p className="text-text-secondary">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_520px] gap-[var(--s6)] items-start">
          {/* Timeline */}
          <div>
            <div className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-[var(--s4)]">
              Timeline
            </div>
            <div className="timeline-scroll max-h-[calc(100vh-200px)] overflow-y-auto pr-[var(--s2)]">
              <VerticalTimeline messages={messages} tasks={tasks} />
            </div>
          </div>

          {/* Diagrams sidebar */}
          <div className="flex flex-col gap-[var(--s6)] sticky top-20">
            <DiagramPanel title="Agent Graph" definition={graphDef} />
            <DiagramPanel title="Sequence Diagram" definition={seqDef} />
          </div>
        </div>
      )}
    </div>
  );
}
