export type TokenKind =
  | "plain"
  | "screen"
  | "go"
  | "if"
  | "loop"
  | "until"
  | "then"
  | "name"
  | "cond";

export type Token = { text: string; kind: TokenKind };

export type LineKind = "blank" | "title" | "note" | "screen" | "go" | "if" | "loop" | "unknown";

export type ClassifiedLine = {
  kind: LineKind;
  tokens: Token[];
  error?: string;
  title?: string;
  screen?: string;
  dest?: string;
  condition?: string;
  action?: string;
  until?: string;
};

export type JourneyEdge =
  | { kind: "go"; from: string; to: string; line: number }
  | { kind: "if"; from: string; to: string; condition: string; line: number }
  | { kind: "loop"; from: string; to: string; action: string; until: string; line: number };

export type JourneyScreen = { name: string; implicit: boolean };

export type JourneyIssue = { line: number; message: string };

export type JourneyModel = {
  title: string | null;
  screens: JourneyScreen[];
  edges: JourneyEdge[];
  issues: JourneyIssue[];
  badLines: number[];
  lines: ClassifiedLine[];
  mermaid: string;
};

const COFFEE = `Title: Morning coffee
Screen: Home
Go to Coffee List
If chooses data coffee go to Fetch Beans

Screen: Coffee List
Go to Order
If picks pour over go to Brew Guide

Screen: Fetch Beans
Loop roaster runs until timer ends then go to Success

Screen: Brew Guide
Go to Order

Screen: Order
If payment fails go to Home
Go to Success

Screen: Success
Go to Home
`;

const SIGNUP = `Title: Create account
Screen: Landing
Go to Sign Up

Screen: Sign Up
If email is taken go to Sign Up
If form is valid go to Check Inbox

Screen: Check Inbox
Loop waiting for the link until they tap it then go to Welcome

Screen: Welcome
Go to Home

Screen: Home
`;

const CHECKOUT = `Title: Checkout
Screen: Cart
Go to Shipping

Screen: Shipping
If address is missing go to Shipping
Go to Payment

Screen: Payment
If card is declined go to Payment
Loop bank checks the card until approval arrives then go to Receipt

Screen: Receipt
`;

export const EXAMPLES: { id: string; label: string; source: string }[] = [
  { id: "coffee", label: "Coffee", source: COFFEE },
  { id: "signup", label: "Sign up", source: SIGNUP },
  { id: "checkout", label: "Checkout", source: CHECKOUT },
];

export const STARTER = COFFEE;

export const BLANK = `Screen: Home
`;

export type SnippetId = "screen" | "go" | "if" | "loop";

export const SNIPPETS: Record<SnippetId, { text: string; cursor: number; label: string; hint: string }> = {
  screen: { text: "Screen: ", cursor: 8, label: "Screen:", hint: "Name a page" },
  go: { text: "Go to ", cursor: 6, label: "Go to", hint: "Link onward" },
  if: { text: "If  go to ", cursor: 3, label: "If", hint: "A choice" },
  loop: { text: "Loop  until  then go to ", cursor: 5, label: "Loop", hint: "Repeat until" },
};

function withPrefix(prefix: string, parts: Token[]): Token[] {
  const tokens: Token[] = [];
  if (prefix) tokens.push({ text: prefix, kind: "plain" });
  for (const part of parts) {
    if (part.text) tokens.push(part);
  }
  return tokens;
}

function findKeyword(hay: string, kw: string, fromEnd: boolean): number {
  const lower = hay.toLowerCase();
  const needle = kw.toLowerCase();
  let idx = fromEnd ? lower.lastIndexOf(needle) : lower.indexOf(needle);
  const valid = (i: number) => {
    if (i < 0) return false;
    const beforeOk = i === 0 || /\s/.test(hay[i - 1] ?? "");
    const after = i + needle.length;
    const afterOk = after === hay.length || /\s/.test(hay[after] ?? "");
    return beforeOk && afterOk;
  };
  while (idx !== -1 && !valid(idx)) {
    idx = fromEnd ? lower.lastIndexOf(needle, idx - 1) : lower.indexOf(needle, idx + 1);
  }
  return idx;
}

function matchLoop(body: string): { untilAt: number; thenAt: number; goAt: number; goEnd: number } | null {
  const phrase = /\bthen\s+go to\b/gi;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = phrase.exec(body))) last = match;
  if (!last || last.index < 4) return null;
  const thenAt = last.index;
  const rel = last[0].toLowerCase().search(/go to/);
  if (rel < 0) return null;
  const goAt = thenAt + rel;
  const goEnd = goAt + 5;
  const head = body.slice(0, thenAt);
  const untilRe = /\buntil\b/gi;
  let untilAt = -1;
  let untilMatch: RegExpExecArray | null;
  while ((untilMatch = untilRe.exec(head))) untilAt = untilMatch.index;
  if (untilAt < 4) return null;
  return { untilAt, thenAt, goAt, goEnd };
}

function colorLoose(body: string): Token[] {
  const words: { kw: string; kind: TokenKind }[] = [
    { kw: "go to", kind: "go" },
    { kw: "screen:", kind: "screen" },
    { kw: "until", kind: "until" },
    { kw: "then", kind: "then" },
    { kw: "loop", kind: "loop" },
    { kw: "if", kind: "if" },
  ];
  const tokens: Token[] = [];
  let i = 0;
  while (i < body.length) {
    let hit: { kw: string; kind: TokenKind } | null = null;
    for (const word of words) {
      if (body.slice(i, i + word.kw.length).toLowerCase() !== word.kw) continue;
      const beforeOk = i === 0 || /\s/.test(body[i - 1] ?? "");
      const after = i + word.kw.length;
      const afterOk = after === body.length || /\s/.test(body[after] ?? "") || word.kw.endsWith(":");
      if (beforeOk && afterOk) {
        hit = word;
        break;
      }
    }
    if (hit) {
      tokens.push({ text: body.slice(i, i + hit.kw.length), kind: hit.kind });
      i += hit.kw.length;
      continue;
    }
    let j = i + 1;
    while (j < body.length) {
      const could = words.some((word) => body.slice(j, j + word.kw.length).toLowerCase() === word.kw);
      if (could) break;
      j += 1;
    }
    tokens.push({ text: body.slice(i, j), kind: "plain" });
    i = j;
  }
  return tokens;
}

export function classifyLine(line: string): ClassifiedLine {
  const lead = line.match(/^[ \t]*/)?.[0] ?? "";
  let body = line.slice(lead.length);
  const bullet = body.match(/^(?:[-*•]\s+|\d+[.)]\s+)/);
  let bulletText = "";
  if (bullet) {
    bulletText = bullet[0];
    body = body.slice(bulletText.length);
  }
  const prefix = lead + bulletText;

  if (body.trim() === "") {
    return { kind: "blank", tokens: line ? [{ text: line, kind: "plain" }] : [] };
  }

  if (/^screen:/i.test(body)) {
    const name = body.slice(7).trim();
    const tokens = withPrefix(prefix, [
      { text: body.slice(0, 7), kind: "screen" },
      { text: body.slice(7), kind: "name" },
    ]);
    if (!name) return { kind: "screen", tokens, error: "Missing screen name after 'Screen:'" };
    return { kind: "screen", tokens, screen: name };
  }

  if (/^title:/i.test(body)) {
    const title = body.slice(6).trim();
    const tokens = withPrefix(prefix, [
      { text: body.slice(0, 6), kind: "screen" },
      { text: body.slice(6), kind: "name" },
    ]);
    if (!title) return { kind: "title", tokens, error: "Missing title after 'Title:'" };
    return { kind: "title", tokens, title };
  }

  if (/^note:/i.test(body)) {
    return {
      kind: "note",
      tokens: withPrefix(prefix, [
        { text: body.slice(0, 5), kind: "cond" },
        { text: body.slice(5), kind: "plain" },
      ]),
    };
  }

  if (/^go to(?=\s|$)/i.test(body)) {
    const dest = body.slice(5).trim();
    const tokens = withPrefix(prefix, [
      { text: body.slice(0, 5), kind: "go" },
      { text: body.slice(5), kind: "name" },
    ]);
    if (!dest) return { kind: "go", tokens, error: "Missing destination screen after 'go to'" };
    return { kind: "go", tokens, dest };
  }

  if (/^if(?=\s|$)/i.test(body)) {
    const goAt = findKeyword(body, "go to", true);
    if (goAt < 0) {
      return {
        kind: "if",
        tokens: withPrefix(prefix, colorLoose(body)),
        error: "If needs a condition, then 'go to' and a screen name",
      };
    }
    const condition = body.slice(2, goAt).trim();
    const dest = body.slice(goAt + 5).trim();
    const tokens = withPrefix(prefix, [
      { text: body.slice(0, 2), kind: "if" },
      { text: body.slice(2, goAt), kind: "cond" },
      { text: body.slice(goAt, goAt + 5), kind: "go" },
      { text: body.slice(goAt + 5), kind: "name" },
    ]);
    if (!condition) return { kind: "if", tokens, error: "Missing condition after 'If'" };
    if (!dest) return { kind: "if", tokens, error: "Missing destination screen after 'go to'" };
    return { kind: "if", tokens, condition, dest };
  }

  if (/^loop(?=\s|$)/i.test(body)) {
    const found = matchLoop(body);
    if (!found) {
      return {
        kind: "loop",
        tokens: withPrefix(prefix, colorLoose(body)),
        error: "Loop needs an action, 'until', then 'then go to' and a screen",
      };
    }
    const action = body.slice(4, found.untilAt).trim();
    const event = body.slice(found.untilAt + 5, found.thenAt).trim();
    const dest = body.slice(found.goEnd).trim();
    const tokens = withPrefix(prefix, [
      { text: body.slice(0, 4), kind: "loop" },
      { text: body.slice(4, found.untilAt), kind: "cond" },
      { text: body.slice(found.untilAt, found.untilAt + 5), kind: "until" },
      { text: body.slice(found.untilAt + 5, found.thenAt), kind: "cond" },
      { text: body.slice(found.thenAt, found.thenAt + 4), kind: "then" },
      { text: body.slice(found.thenAt + 4, found.goAt), kind: "plain" },
      { text: body.slice(found.goAt, found.goEnd), kind: "go" },
      { text: body.slice(found.goEnd), kind: "name" },
    ]);
    if (!action) return { kind: "loop", tokens, error: "Missing what to repeat after 'Loop'" };
    if (!event) return { kind: "loop", tokens, error: "Missing the event after 'until'" };
    if (!dest) return { kind: "loop", tokens, error: "Missing destination screen after 'go to'" };
    return { kind: "loop", tokens, action, until: event, dest };
  }

  let error = "Not a step I understand. Start with Screen, Go to, If, or Loop";
  if (/^screen\b/i.test(body)) error = "Write 'Screen:' then the screen name";
  else if (/^goto\b/i.test(body)) error = "Write 'Go to' as two words, then the screen name";
  else if (/^go to\S/i.test(body)) error = "Add a space after 'Go to', then the screen name";
  else if (/^title\b/i.test(body)) error = "Write 'Title:' then the journey name";
  else if (/^note\b/i.test(body)) error = "Write 'Note:' then the comment";

  return { kind: "unknown", tokens: withPrefix(prefix, [{ text: body, kind: "plain" }]), error };
}

export function mermaidLabel(input: string): string {
  const clean = input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "and")
    .replace(/[<>[\]{}|#"]/g, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "screen";
  if (clean.length > 72) return `${clean.slice(0, 69)}…`;
  return clean;
}

function safeTitle(title: string): string | null {
  const clean = title
    .replace(/[^A-Za-z0-9 .,'&()-]/g, "")
    .replace(/-{2,}/g, "-")
    .trim();
  if (!clean) return null;
  return clean.slice(0, 80);
}

function toMermaid(title: string | null, screens: JourneyScreen[], edges: JourneyEdge[]): string {
  if (screens.length === 0) return "";
  const ids = new Map<string, string>();
  screens.forEach((screen, index) => ids.set(screen.name, `n${index}`));
  const start = screens.find((screen) => !screen.implicit)?.name ?? screens[0]?.name;
  const out: string[] = [];
  const diagramTitle = title ? safeTitle(title) : null;
  if (diagramTitle) {
    out.push("---");
    out.push(`title: ${diagramTitle}`);
    out.push("---");
  }
  out.push("flowchart TD");
  for (const screen of screens) {
    out.push(`  ${ids.get(screen.name)}["${mermaidLabel(screen.name)}"]`);
  }

  let linkIndex = 0;
  const linkStyles: string[] = [];
  const loopIds: string[] = [];
  const paint = (color: string) => {
    linkStyles.push(`  linkStyle ${linkIndex} stroke:${color},stroke-width:1.7px`);
    linkIndex += 1;
  };

  for (const edge of edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) continue;
    if (edge.kind === "go") {
      out.push(`  ${from} --> ${to}`);
      paint("#e4a04a");
    } else if (edge.kind === "if") {
      out.push(`  ${from} -->|"${mermaidLabel(edge.condition)}"| ${to}`);
      paint("#e7c27a");
    } else {
      const loopId = `l${loopIds.length}`;
      loopIds.push(loopId);
      out.push(`  ${loopId}["${mermaidLabel(`Loop ${edge.action}`)}"]`);
      out.push(`  ${from} --> ${loopId}`);
      paint("#9db7d4");
      out.push(`  ${loopId} -->|"${mermaidLabel(`until ${edge.until}`)}"| ${to}`);
      paint("#8fbf9f");
    }
  }

  out.push("  classDef screen fill:#211e17,stroke:#e4a04a,color:#f4efe6,stroke-width:1.5px");
  out.push("  classDef start fill:#e4a04a,stroke:#c4842e,color:#1a1208,stroke-width:1.5px");
  out.push("  classDef loop fill:#17211c,stroke:#8fbf9f,color:#f4efe6,stroke-width:1.5px");
  out.push("  classDef ghost fill:#14130f,stroke:#a39888,color:#d9d0c2,stroke-dasharray:5 4,stroke-width:1.5px");

  if (start && ids.get(start)) out.push(`  class ${ids.get(start)} start`);
  const explicit = screens
    .filter((screen) => !screen.implicit && screen.name !== start)
    .map((screen) => ids.get(screen.name))
    .filter(Boolean);
  const ghosts = screens
    .filter((screen) => screen.implicit && screen.name !== start)
    .map((screen) => ids.get(screen.name))
    .filter(Boolean);
  if (explicit.length) out.push(`  class ${explicit.join(",")} screen`);
  if (ghosts.length) out.push(`  class ${ghosts.join(",")} ghost`);
  if (loopIds.length) out.push(`  class ${loopIds.join(",")} loop`);
  out.push(...linkStyles);
  return out.join("\n");
}

export function parseJourney(source: string): JourneyModel {
  const rawLines = source.split(/\r\n|\n|\r/);
  const lines = rawLines.map((line) => classifyLine(line));
  const issues: JourneyIssue[] = [];
  const bad = new Set<number>();
  const screens: JourneyScreen[] = [];
  const edges: JourneyEdge[] = [];
  let title: string | null = null;
  let current: string | null = null;

  const touch = (name: string, explicit: boolean) => {
    const found = screens.find((screen) => screen.name === name);
    if (!found) {
      screens.push({ name, implicit: !explicit });
      return;
    }
    if (explicit) found.implicit = false;
  };

  lines.forEach((line, index) => {
    const number = index + 1;
    if (line.error) {
      issues.push({ line: number, message: `Line ${number}: ${line.error}` });
      bad.add(number);
    }
    if (line.kind === "title" && line.title && !line.error) title = line.title;
    if (line.kind === "screen" && line.screen && !line.error) {
      current = line.screen;
      touch(line.screen, true);
      return;
    }
    if (line.error) return;
    if (line.kind !== "go" && line.kind !== "if" && line.kind !== "loop") return;
    if (!current) {
      issues.push({ line: number, message: `Line ${number}: Add a 'Screen:' line before this step` });
      bad.add(number);
      return;
    }
    if (line.kind === "go" && line.dest) {
      touch(line.dest, false);
      edges.push({ kind: "go", from: current, to: line.dest, line: number });
    } else if (line.kind === "if" && line.dest && line.condition) {
      touch(line.dest, false);
      edges.push({ kind: "if", from: current, to: line.dest, condition: line.condition, line: number });
    } else if (line.kind === "loop" && line.dest && line.action && line.until) {
      touch(line.dest, false);
      edges.push({
        kind: "loop",
        from: current,
        to: line.dest,
        action: line.action,
        until: line.until,
        line: number,
      });
    }
  });

  return {
    title,
    screens,
    edges,
    issues,
    badLines: [...bad],
    lines,
    mermaid: toMermaid(title, screens, edges),
  };
}

export function insertSnippet(
  source: string,
  selStart: number,
  selEnd: number,
  snippet: string,
  cursorInSnippet: number,
): { next: string; cursor: number } {
  const start = Math.max(0, Math.min(selStart, source.length));
  const end = Math.max(start, Math.min(selEnd, source.length));
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const newlineAt = source.indexOf("\n", end);
  const lineEnd = newlineAt === -1 ? source.length : newlineAt;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);
  const prefix = before.trim() ? "\n" : "";
  const suffix = after.trim() ? "\n" : "";
  const piece = prefix + snippet + suffix;
  const next = source.slice(0, start) + piece + source.slice(end);
  const cursor = start + prefix.length + cursorInSnippet;
  return { next, cursor };
}
