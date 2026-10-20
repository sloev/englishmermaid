// Peer-to-peer chat and file sending over WebRTC (Trystero). Public Nostr
// relays only introduce peers to each other; messages and files then go
// directly between browsers. Loaded on first use.

export type Peer = { id: string; name: string };

export type ChatItem =
  | {
      kind: "text";
      id: string;
      from: string;
      name: string;
      text: string;
      at: number;
      mine: boolean;
    }
  | {
      kind: "doc";
      id: string;
      from: string;
      name: string;
      title: string;
      source: string;
      at: number;
      mine: boolean;
      to: string | null;
    }
  | { kind: "note"; id: string; text: string; at: number };

export type Chat = {
  sendText(text: string): void;
  sendDoc(title: string, source: string, to: string | null): void;
  rename(name: string): void;
  leave(): void;
};

type Hello = { name: string };
type Text = { text: string };
type Doc = { title: string; source: string };

const APP_ID = "plainpath.sloev.github.io";
const NAME_KEY = "plainpath-name";

const ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "dusky",
  "eager",
  "fuzzy",
  "golden",
  "hazel",
  "inky",
  "jolly",
  "lucky",
  "misty",
  "nutty",
  "olive",
  "plucky",
  "quiet",
  "rosy",
  "sunny",
  "toasty",
  "velvet",
];
const NOUNS = [
  "bean",
  "brew",
  "crema",
  "drip",
  "espresso",
  "filter",
  "grinder",
  "kettle",
  "latte",
  "mocha",
  "pour",
  "roast",
  "scale",
  "steam",
  "tamper",
  "cortado",
];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** A friendly name like "golden-latte-42", kept in this browser. */
export function myName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode */
  }
}

const uid = () => Math.random().toString(36).slice(2);

export async function joinChat(
  room: string,
  name: string,
  on: { peers(peers: Peer[]): void; item(item: ChatItem): void },
): Promise<Chat> {
  const { joinRoom } = await import("trystero");
  // Scripts are small; anything bigger than this is not a script.
  const r = joinRoom({ appId: APP_ID, maxReceiveBytes: 1_000_000 }, room);
  const peers = new Map<string, string>();
  let me = name;
  const publish = () => on.peers([...peers].map(([id, peerName]) => ({ id, name: peerName })));

  // Action names are limited to 12 bytes.
  const hello = r.makeAction<Hello>("hello");
  const text = r.makeAction<Text>("text");
  const doc = r.makeAction<Doc>("doc");

  r.onPeerJoin = (id) => {
    peers.set(id, peers.get(id) ?? "someone");
    publish();
    void hello.send({ name: me }, { target: id });
  };
  r.onPeerLeave = (id) => {
    const left = peers.get(id);
    peers.delete(id);
    publish();
    if (left) on.item({ kind: "note", id: uid(), text: `${left} left`, at: Date.now() });
  };
  hello.onMessage = (data, { peerId }) => {
    const known = peers.get(peerId);
    peers.set(peerId, String(data.name).slice(0, 40) || "someone");
    publish();
    if (!known || known === "someone") {
      on.item({ kind: "note", id: uid(), text: `${peers.get(peerId)} is here`, at: Date.now() });
    }
  };
  text.onMessage = (data, { peerId }) =>
    on.item({
      kind: "text",
      id: uid(),
      from: peerId,
      name: peers.get(peerId) ?? "someone",
      text: String(data.text).slice(0, 2000),
      at: Date.now(),
      mine: false,
    });
  doc.onMessage = (data, { peerId }) =>
    on.item({
      kind: "doc",
      id: uid(),
      from: peerId,
      name: peers.get(peerId) ?? "someone",
      title: String(data.title).slice(0, 80),
      source: String(data.source),
      at: Date.now(),
      mine: false,
      to: null,
    });

  return {
    sendText(message) {
      void text.send({ text: message });
      on.item({
        kind: "text",
        id: uid(),
        from: "me",
        name: me,
        text: message,
        at: Date.now(),
        mine: true,
      });
    },
    sendDoc(title, source, to) {
      void doc.send({ title, source }, to ? { target: to } : undefined);
      on.item({
        kind: "doc",
        id: uid(),
        from: "me",
        name: me,
        title,
        source,
        at: Date.now(),
        mine: true,
        to,
      });
    },
    rename(next) {
      me = next;
      void hello.send({ name: me });
    },
    leave() {
      void r.leave();
    },
  };
}
