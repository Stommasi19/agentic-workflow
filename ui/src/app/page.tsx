"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchConversations } from "@/lib/api";
import { useSse } from "@/hooks/use-sse";
import type { ConversationSummary } from "@/lib/types";

const PAGE_SIZE = 20;

export default function ConversationListPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (newOffset: number) => {
    setLoading(true);
    try {
      const data = await fetchConversations(PAGE_SIZE, newOffset);
      setConversations(newOffset === 0 ? data.conversations : (prev) => [...prev, ...data.conversations]);
      setTotal(data.total);
      setOffset(newOffset);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    load(0);
  }, [load]);

  // Real-time updates: re-fetch on any event
  useSse({
    onEvent: () => {
      load(0);
    },
  });

  const filtered = filter
    ? conversations.filter((c) => c.conversation.toLowerCase().includes(filter.toLowerCase()))
    : conversations;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Conversations</h1>
        <span className="text-zinc-500 text-sm">{total} total</span>
      </div>

      <input
        type="text"
        placeholder="Filter by conversation ID..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full mb-4 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-900 text-zinc-400 text-left">
              <th className="px-4 py-2">Conversation</th>
              <th className="px-4 py-2 text-center">Messages</th>
              <th className="px-4 py-2 text-center">Tasks</th>
              <th className="px-4 py-2 text-right">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((conv) => (
              <tr
                key={conv.conversation}
                className="border-t border-zinc-800 hover:bg-zinc-900/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/conversation/${conv.conversation}`}
                    className="text-blue-400 hover:underline font-mono text-xs"
                  >
                    {conv.conversation.slice(0, 8)}...
                  </Link>
                </td>
                <td className="px-4 py-3 text-center text-zinc-300">{conv.message_count}</td>
                <td className="px-4 py-3 text-center text-zinc-300">{conv.task_count}</td>
                <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                  {new Date(conv.last_activity).toLocaleString()}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                  {filter ? "No matching conversations" : "No conversations yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {conversations.length < total && (
        <button
          onClick={() => load(offset + PAGE_SIZE)}
          disabled={loading}
          className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
