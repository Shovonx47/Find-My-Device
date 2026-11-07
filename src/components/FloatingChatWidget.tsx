'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  MessageSquare,
  Send,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiPost } from '@/lib/api-client';
import { formatMessageTime } from '@/lib/utils';
import type { ConnectionWithNames, MessageRecord } from '@/types/database';

interface FloatingChatWidgetProps {
  connections: ConnectionWithNames[];
  currentUserId: string;
  messagesByConnection: Record<string, MessageRecord[]>;
  openConnectionId: string | null;
  onOpen: (connectionId: string) => void;
  onClose: () => void;
  onMessageSent?: (message: MessageRecord) => void;
  onMarkThreadRead?: (connectionId: string, readAt: string) => void;
}

export function FloatingChatWidget({
  connections,
  currentUserId,
  messagesByConnection,
  openConnectionId,
  onOpen,
  onClose,
  onMessageSent,
  onMarkThreadRead,
}: FloatingChatWidgetProps) {
  // Unsent draft text preserved per connection so closing the window does not discard input
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);

  // Active connection currently displayed in the chat window
  const activeConn = useMemo(() => {
    if (openConnectionId) {
      return connections.find((c) => c.id === openConnectionId) ?? connections[0];
    }
    return connections[0];
  }, [connections, openConnectionId]);

  const otherUserName = activeConn
    ? activeConn.requester_id === currentUserId
      ? activeConn.target_name
      : activeConn.requester_name
    : '';

  const otherUserId = activeConn
    ? activeConn.requester_id === currentUserId
      ? activeConn.target_id
      : activeConn.requester_id
    : '';

  // Messages for currently active connection
  const activeMessages = useMemo(() => {
    if (!activeConn) return [];
    const list = messagesByConnection[activeConn.id] ?? [];
    return [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [messagesByConnection, activeConn]);

  // Total unread count across all active connections
  const totalUnreadCount = useMemo(() => {
    let count = 0;
    connections.forEach((conn) => {
      const msgs = messagesByConnection[conn.id] ?? [];
      count += msgs.filter(
        (m) => m.recipient_id === currentUserId && !m.read_at
      ).length;
    });
    return count;
  }, [connections, messagesByConnection, currentUserId]);

  // Unread count for the currently active connection
  const activeUnreadCount = useMemo(() => {
    return activeMessages.filter(
      (m) => m.recipient_id === currentUserId && !m.read_at
    ).length;
  }, [activeMessages, currentUserId]);

  // Auto-mark as read when chat window is open
  useEffect(() => {
    if (!openConnectionId || !activeConn || activeUnreadCount === 0) return;

    let cancelled = false;
    const nowIso = new Date().toISOString();
    onMarkThreadRead?.(activeConn.id, nowIso);

    void apiPost<{ ok: boolean; readAt: string }>('/api/messages/read', {
      connection_id: activeConn.id,
    }).then((res) => {
      if (!cancelled && res.ok && res.data?.readAt) {
        onMarkThreadRead?.(activeConn.id, res.data.readAt);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [openConnectionId, activeConn, activeUnreadCount, onMarkThreadRead]);

  // Scroll to bottom when opening or message arrives
  useEffect(() => {
    if (
      openConnectionId &&
      typeof threadEndRef.current?.scrollIntoView === 'function'
    ) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [openConnectionId, activeMessages.length]);

  // If no connections exist, no floating chat needed
  if (connections.length === 0) {
    return null;
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConn) return;

    const currentDraft = drafts[activeConn.id]?.trim() || '';
    if (!currentDraft) return;

    setSending(true);
    setSendError(null);

    const res = await apiPost<{ ok: boolean; message: MessageRecord }>(
      '/api/messages',
      {
        connection_id: activeConn.id,
        recipient_id: otherUserId,
        body: currentDraft,
      }
    );

    setSending(false);
    if (res.ok && res.data?.message) {
      setDrafts((prev) => ({ ...prev, [activeConn.id]: '' }));
      onMessageSent?.(res.data.message);
    } else {
      setSendError(res.error ?? 'Could not send message.');
    }
  }

  // 1. COLLAPSED VIEW: Floating Round Button
  if (!openConnectionId) {
    return (
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50">
        <button
          type="button"
          data-testid="floating-chat-trigger"
          onClick={() => {
            // Priority: open connection with unread message, else first connection
            const unreadConn = connections.find((c) => {
              const msgs = messagesByConnection[c.id] ?? [];
              return msgs.some(
                (m) => m.recipient_id === currentUserId && !m.read_at
              );
            });
            onOpen(unreadConn ? unreadConn.id : connections[0]?.id || '');
          }}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-xl hover:bg-teal-700 hover:scale-105 active:scale-95 transition-all duration-200 border-2 border-white focus:outline-none focus:ring-4 focus:ring-teal-200/80"
          aria-label="Open messages"
        >
          <MessageSquare className="h-6 w-6" />
          {totalUnreadCount > 0 && (
            <span
              data-testid="floating-unread-badge"
              className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white shadow-md animate-pulse"
            >
              {totalUnreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  // 2. EXPANDED VIEW: Docked Messenger-Style Chat Window
  return (
    <div
      data-testid={activeConn ? `message-thread-${activeConn.id}` : 'floating-chat-window'}
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col w-[calc(100vw-2rem)] sm:w-[370px] max-w-[400px] h-[520px] max-h-[82vh] rounded-2xl border border-slate-200/90 bg-white shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      {/* Header */}
      <div className="flex flex-col border-b border-teal-100 bg-teal-600 px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white font-bold text-sm shrink-0">
              {otherUserName.slice(0, 1).toUpperCase()}
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-teal-600" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">
                {otherUserName}
              </h3>
              <p className="text-[11px] text-teal-100 truncate">
                Active location sharing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="close-floating-chat"
              onClick={onClose}
              aria-label="Minimize chat"
              className="rounded-lg p-1.5 text-teal-100 hover:bg-white/20 hover:text-white transition"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close conversation"
              className="rounded-lg p-1.5 text-teal-100 hover:bg-white/20 hover:text-white transition sm:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Multi-connection switcher tabs if user shares with multiple people */}
        {connections.length > 1 && (
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5 pt-1 scrollbar-none">
            {connections.map((c) => {
              const name =
                c.requester_id === currentUserId ? c.target_name : c.requester_name;
              const isSelected = c.id === activeConn?.id;
              const unread = (messagesByConnection[c.id] ?? []).filter(
                (m) => m.recipient_id === currentUserId && !m.read_at
              ).length;

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition ${
                    isSelected
                      ? 'bg-white text-teal-900 shadow-sm'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                >
                  <Users className="h-3 w-3" />
                  <span className="truncate max-w-[80px]">{name}</span>
                  {unread > 0 && (
                    <span className="ml-1 rounded-full bg-rose-500 px-1 text-[10px] text-white">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Message History (Scrollable) */}
      <div
        data-testid="message-thread-list"
        className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-slate-50/50"
      >
        {activeMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 mb-2">
              <MessageSquare className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-slate-700">No messages yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Say hello to {otherUserName} below!
            </p>
          </div>
        ) : (
          activeMessages.map((msg) => {
            const isMine = msg.sender_id === currentUserId;
            const timeStr = formatMessageTime(msg.created_at);

            return (
              <div
                key={msg.id}
                data-testid={`message-bubble-${msg.id}`}
                className={`flex flex-col ${
                  isMine ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm break-words ${
                    isMine
                      ? 'rounded-br-sm bg-teal-600 text-white'
                      : 'rounded-bl-sm border border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <p className="leading-relaxed">{msg.body}</p>
                </div>
                <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-slate-400">
                  <span>{isMine ? 'You' : otherUserName}</span>
                  {timeStr && <span>&middot; {timeStr}</span>}
                  {isMine && (
                    <span>&middot; {msg.read_at ? 'Read' : 'Sent'}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Input / Send Form */}
      <form
        onSubmit={handleSendMessage}
        className="border-t border-slate-100 bg-white p-3 space-y-2"
      >
        {sendError && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{sendError}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            type="text"
            maxLength={500}
            aria-label={`Message ${otherUserName}`}
            placeholder={`Message ${otherUserName}…`}
            value={drafts[activeConn.id] || ''}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [activeConn.id]: e.target.value,
              }))
            }
            className="flex-1 text-sm h-10 rounded-xl"
          />
          <Button
            type="submit"
            size="sm"
            disabled={sending || !(drafts[activeConn.id]?.trim())}
            className="h-10 px-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white shrink-0 min-w-[70px]"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1" />
            )}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

