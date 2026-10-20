// The documents kept in this browser: every script autosaves here, with a
// short version history. Stored in localStorage as one small index plus a
// key per document, so typing only rewrites the document being edited.

export type DocMeta = { id: string; title: string; created: number; updated: number };
/** `at`: last change in this version; `since`: when the version began. */
export type Version = { at: number; source: string; since?: number };

const INDEX = "plainpath-docs";
const CURRENT = "plainpath-current";
const LEGACY = "plainpath-script";
const docKey = (id: string) => `plainpath-doc:${id}`;
const historyKey = (id: string) => `plainpath-history:${id}`;

// Edits within this long of a version's start update that version instead of
// adding one (except the first version, which is how the document started).
const SESSION_MS = 2 * 60 * 1000;
const MAX_VERSIONS = 40;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memory = new Map<string, string>();
const fallback: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

// Private windows can refuse localStorage; then documents live for this visit only.
function store(): Store {
  try {
    localStorage.setItem("plainpath-probe", "1");
    localStorage.removeItem("plainpath-probe");
    return localStorage;
  } catch {
    return fallback;
  }
}

function read<T>(key: string, empty: T): T {
  try {
    const raw = store().getItem(key);
    return raw == null ? empty : (JSON.parse(raw) as T);
  } catch {
    return empty;
  }
}

function write(key: string, value: unknown) {
  try {
    store().setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* quota: keep going, the document stays in memory */
  }
}

/** The name a document is listed under: its Title:, else its first screen. */
export function docTitle(source: string): string {
  const title = /^\s*title:\s*(.+)$/im.exec(source)?.[1];
  const screen = /^\s*(?:screen|page|view|popup|modal|dialog|sheet|component):\s*(.+)$/im.exec(
    source,
  )?.[1];
  return (title ?? screen ?? "Untitled").trim().slice(0, 80) || "Untitled";
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function listDocs(): DocMeta[] {
  return read<DocMeta[]>(INDEX, []).sort((a, b) => b.updated - a.updated);
}

export function readDoc(id: string): string | null {
  return store().getItem(docKey(id));
}

export function currentDocId(): string | null {
  return store().getItem(CURRENT);
}

export function setCurrentDoc(id: string) {
  write(CURRENT, id);
}

/** Creates a document and makes it current. */
export function createDoc(source: string): DocMeta {
  const now = Date.now();
  const meta: DocMeta = { id: newId(), title: docTitle(source), created: now, updated: now };
  write(docKey(meta.id), source);
  write(INDEX, [...read<DocMeta[]>(INDEX, []), meta]);
  setCurrentDoc(meta.id);
  // The text it started with stays as the first version.
  recordVersion(meta.id, source, now);
  return meta;
}

/** Autosave: stores the text, refreshes the listing and records a version. */
export function saveDoc(id: string, source: string): DocMeta[] {
  if (readDoc(id) === source) return listDocs();
  const now = Date.now();
  write(docKey(id), source);
  const index = read<DocMeta[]>(INDEX, []);
  const meta = index.find((doc) => doc.id === id);
  if (meta) Object.assign(meta, { title: docTitle(source), updated: now });
  else index.push({ id, title: docTitle(source), created: now, updated: now });
  write(INDEX, index);
  recordVersion(id, source, now);
  return listDocs();
}

function recordVersion(id: string, source: string, at: number) {
  const versions = read<Version[]>(historyKey(id), []);
  const last = versions[versions.length - 1];
  if (last?.source === source) return;
  if (last && versions.length > 1 && at - (last.since ?? last.at) < SESSION_MS) {
    versions[versions.length - 1] = { at, source, since: last.since ?? last.at };
  } else versions.push({ at, source, since: at });
  write(historyKey(id), versions.slice(-MAX_VERSIONS));
}

/** Newest first. */
export function listVersions(id: string): Version[] {
  return read<Version[]>(historyKey(id), []).slice().reverse();
}

export function deleteDoc(id: string) {
  write(
    INDEX,
    read<DocMeta[]>(INDEX, []).filter((doc) => doc.id !== id),
  );
  store().removeItem(docKey(id));
  store().removeItem(historyKey(id));
}

/**
 * The document to show on start, creating one if needed. Scripts from before
 * the library (a single autosaved script) become the first document.
 */
export function openLibrary(starter: string): { id: string; source: string } {
  const current = currentDocId();
  const source = current ? readDoc(current) : null;
  if (current && source != null) return { id: current, source };
  const latest = listDocs()[0];
  if (latest) {
    setCurrentDoc(latest.id);
    return { id: latest.id, source: readDoc(latest.id) ?? "" };
  }
  const legacy = store().getItem(LEGACY);
  const meta = createDoc(legacy ?? starter);
  if (legacy != null) store().removeItem(LEGACY);
  return { id: meta.id, source: legacy ?? starter };
}
