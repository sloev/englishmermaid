import { useEffect, useRef, useState } from "react";
import { FileText, Send, Users, X } from "lucide-react";
import { joinChat, myName, saveName, type Chat, type ChatItem, type Peer } from "./lib/chat";

const ROOM_KEY = "plainpath-room";

function storedRoom() {
  try {
    return localStorage.getItem(ROOM_KEY) || "lobby";
  } catch {
    return "lobby";
  }
}

export type ChatState = ReturnType<typeof useChat>;

/** The chat connection lives as long as the app, so closing the panel keeps you online. */
export function useChat() {
  const [online, setOnline] = useState<"off" | "joining" | "on" | "failed">("off");
  const [room, setRoom] = useState(storedRoom);
  const [name, setName] = useState(myName);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [unread, setUnread] = useState(0);
  const chat = useRef<Chat | null>(null);
  const visible = useRef(false);

  const join = async (target = room) => {
    chat.current?.leave();
    chat.current = null;
    setPeers([]);
    setOnline("joining");
    try {
      chat.current = await joinChat(target, name, {
        peers: setPeers,
        item: (item) => {
          setItems((list) => [...list.slice(-199), item]);
          if (!visible.current && item.kind !== "note") setUnread((n) => n + 1);
        },
      });
      setOnline("on");
    } catch (error) {
      console.warn("Chat could not connect", error);
      setOnline("failed");
    }
  };

  useEffect(() => () => chat.current?.leave(), []);

  return {
    online,
    room,
    name,
    peers,
    items,
    unread,
    /** Call when the panel opens or closes; opening connects on first use. */
    show(open: boolean) {
      visible.current = open;
      if (open) {
        setUnread(0);
        if (online === "off" || online === "failed") void join();
      }
    },
    switchRoom(next: string) {
      const clean = next.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40) || "lobby";
      if (clean === room) return;
      setRoom(clean);
      try {
        localStorage.setItem(ROOM_KEY, clean);
      } catch {
        /* private mode */
      }
      setItems((list) => [
        ...list,
        {
          kind: "note",
          id: Math.random().toString(36).slice(2),
          text: `Joined room ${clean}`,
          at: Date.now(),
        },
      ]);
      void join(clean);
    },
    rename(next: string) {
      const clean = next.trim().slice(0, 40);
      if (!clean || clean === name) return;
      setName(clean);
      saveName(clean);
      chat.current?.rename(clean);
    },
    sendText: (text: string) => chat.current?.sendText(text),
    sendDoc: (title: string, source: string, to: string | null) =>
      chat.current?.sendDoc(title, source, to),
  };
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatPanel({
  chat,
  title,
  source,
  onOpen,
  onClose,
}: {
  chat: ChatState;
  title: string;
  source: string;
  onOpen: (source: string, title: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const peerName = (id: string | null) =>
    id ? (chat.peers.find((peer) => peer.id === id)?.name ?? "someone") : "everyone";

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.items.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    chat.sendText(text);
    setDraft("");
  };

  const field =
    "h-9 min-w-0 rounded-lg border border-border bg-surface-2/80 px-2 font-mono text-sm text-fg outline-none focus:border-accent";

  return (
    <section
      aria-label="Chat"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface/95 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-muted">
          You are
          <input
            key={chat.name}
            defaultValue={chat.name}
            onBlur={(event) => chat.rename(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            className={`${field} w-44`}
            aria-label="Your name"
          />
        </label>
        <label className="flex items-center gap-2 text-muted">
          Room
          <input
            key={chat.room}
            defaultValue={chat.room}
            onBlur={(event) => chat.switchRoom(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            className={`${field} w-32`}
            aria-label="Room"
          />
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="tap ml-auto grid size-9 place-items-center text-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface-2/60 p-2">
        <p className="flex items-center gap-2 px-1 pb-2 text-xs text-muted">
          <Users aria-hidden="true" className="size-3.5" />
          {chat.online === "joining"
            ? "Connecting…"
            : chat.online === "failed"
              ? "Could not connect. Check your connection and reopen the chat."
              : `${chat.peers.length} online in room ${chat.room}`}
        </p>
        {chat.peers.length === 0 && chat.online === "on" ? (
          <p className="px-1 pb-1 text-muted">
            Nobody here yet. Ask a friend to open Plainpath, press the chat bubble and join room{" "}
            <span className="font-mono text-fg">{chat.room}</span>. Then tell them your name:{" "}
            <span className="font-mono text-fg">{chat.name}</span>.
          </p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {chat.peers.map((peer) => (
            <li key={peer.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
              <span className="size-2 shrink-0 rounded-full bg-go" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono">{peer.name}</span>
              <button
                type="button"
                onClick={() => chat.sendDoc(title, source, peer.id)}
                className="tap inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs"
              >
                <Send aria-hidden="true" className="size-3.5" />
                Send this file
              </button>
            </li>
          ))}
        </ul>
        {chat.peers.length > 1 ? (
          <button
            type="button"
            onClick={() => chat.sendDoc(title, source, null)}
            className="tap mt-1 inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs"
          >
            <Send aria-hidden="true" className="size-3.5" />
            Send this file to everyone
          </button>
        ) : null}
      </div>

      <div ref={list} className="flex max-h-72 flex-col gap-2 overflow-y-auto" aria-live="polite">
        {chat.items.map((item) =>
          item.kind === "note" ? (
            <p key={item.id} className="text-center text-xs text-muted">
              {item.text}
            </p>
          ) : (
            <div
              key={item.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                item.mine ? "self-end bg-accent/90 text-accent-ink" : "self-start bg-surface-2"
              }`}
            >
              <p className={`text-xs ${item.mine ? "text-accent-ink/70" : "text-muted"}`}>
                {item.mine ? "You" : item.name} · {time(item.at)}
              </p>
              {item.kind === "text" ? (
                <p className="break-words whitespace-pre-wrap">{item.text}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <FileText aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {item.mine
                      ? `Sent “${item.title}” to ${peerName(item.to)}`
                      : `Sent you “${item.title}”`}
                  </span>
                  {item.mine ? null : (
                    <button
                      type="button"
                      onClick={() => onOpen(item.source, item.title)}
                      className="tap h-8 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-accent-ink"
                    >
                      Open
                    </button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={chat.online === "on" ? "Say something…" : "Connecting…"}
          disabled={chat.online !== "on"}
          aria-label="Message"
          className="h-10 min-w-0 flex-1 rounded-full border border-border bg-surface-2/80 px-4 text-fg outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!draft.trim() || chat.online !== "on"}
          aria-label="Send message"
          className="tap grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-40"
        >
          <Send aria-hidden="true" className="size-4" />
        </button>
      </form>
    </section>
  );
}
