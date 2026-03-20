"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchMessages, fetchTasks } from "@/lib/api";
import { useSse } from "@/hooks/use-sse";
import { buildDirectedGraph, buildSequenceDiagram } from "@/lib/diagrams";
import { DiagramRenderer } from "@/components/diagram-renderer";
import { Timeline } from "@/components/timeline";
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

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Real-time: re-fetch when events match this conversation
  useSse({
    onEvent: (_type: BridgeEventType, data: Record<string, string>) => {
      if (data.conversation === conversationId) {
        load();
      }
    },
  });

  const graphDef = buildDirectedGraph(messages);
  const seqDef = buildSequenceDiagram(messages);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <a href="/" className="text-zinc-500 hover:text-zinc-300 text-sm">
          &larr; Back
        </a>
        <h1 className="text-xl font-bold font-mono">{conversationId}</h1>
        <CopyButton text={conversationId} />
      </div>

      {loading && messages.length === 0 ? (
        <p className="text-zinc-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Timeline — left 3 cols */}
          <div className="lg:col-span-3">
            <h2 className="text-lg font-semibold mb-3">Timeline</h2>
            <div className="max-h-[70vh] overflow-y-auto pr-2">
              <Timeline messages={messages} tasks={tasks} />
            </div>
          </div>

          {/* Diagrams — right 2 cols */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold mb-3">Agent Graph</h2>
              <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 overflow-x-auto">
                <DiagramRenderer definition={graphDef} />
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-3">Sequence Diagram</h2>
              <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 overflow-x-auto">
                <DiagramRenderer definition={seqDef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
