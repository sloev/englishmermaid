// Plainpath: describe screens, layout and interactions in plain English,
// get a Mermaid flowchart back. Pure module: no DOM, no imports.

export type TokenKind =
  "plain" | "screen" | "go" | "if" | "loop" | "show" | "on" | "each" | "name" | "cond" | "note";

export type Token = { text: string; kind: TokenKind };

type Tail = { kind: "go"; to: string } | { kind: "show"; names: string[] };

type Stmt =
  | { t: "blank" }
  | { t: "note" }
  | { t: "title"; text: string }
  | { t: "block"; name: string; component: boolean }
  | { t: "if"; cond: string; tail?: Tail }
  | { t: "elseif"; cond: string; tail?: Tail }
  | { t: "else"; tail?: Tail }
  | { t: "each"; item: string; tail?: Tail }
  | { t: "on"; event: string; tail?: Tail }
  | { t: "go"; to: string }
  | { t: "show"; names: string[] }
  | { t: "loop"; action: string; until: string; to: string }
  | { t: "unknown" };

export type Line = { tokens: Token[]; indent: number; stmt: Stmt; error?: string };

export type Branch = { cond: string | null; line: number; children: Node[] };

export type Node =
  | { kind: "show"; name: string; line: number; children: Node[] }
  | { kind: "each"; item: string; line: number; children: Node[] }
  | { kind: "on"; event: string; line: number; children: Node[] }
  | { kind: "if"; line: number; branches: Branch[] }
  | { kind: "go"; to: string; line: number }
  | { kind: "loop"; action: string; until: string; to: string; line: number };

export type Block = {
  name: string;
  kind: "screen" | "component" | "ghost";
  line: number;
  children: Node[];
};

export type Issue = { line: number; message: string };

export type ViewKind = "flow" | "story";

export type Journey = {
  title: string | null;
  blocks: Block[];
  issues: Issue[];
  lines: Line[];
};

// ---------------------------------------------------------------- examples

const SHOP = `Title: Shop
Screen: Products
  Show Header
    Show Logo, Search, Cart Icon
  For each product in products
    Show Product Card
  If cart is empty
    Show Empty Hint
  Else if cart has 10+ items
    Show Bulk Discount Banner
  Else
    Show Checkout Button
  On tap Cart Icon go to Cart
  On submit search go to Results

Component: Product Card
  Show Image, Title, Price
  On tap Add go to Cart

Screen: Cart
  For each item in cart show Cart Row
  On tap Checkout
    If signed in go to Payment
    Else go to Sign In

Screen: Payment
  Loop bank checks the card until it answers then go to Receipt
  If card is declined go to Payment
`;

const SIGNUP = `Title: Create account
Screen: Landing
  Show Hero, Sign Up Button
  On tap Sign Up Button go to Sign Up

Screen: Sign Up
  Show Email Field, Password Field
  On submit
    If email is taken
      Show Error Banner
    Else if form is valid go to Check Inbox
    Else
      Show Field Hints

Screen: Check Inbox
  Loop waiting for the link until they tap it then go to Welcome

Screen: Welcome
  Go to Home
`;

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

export const EXAMPLES: { id: string; label: string; source: string }[] = [
  { id: "shop", label: "Shop", source: SHOP },
  { id: "signup", label: "Sign up", source: SIGNUP },
  { id: "coffee", label: "Coffee", source: COFFEE },
];

export const STARTER = SHOP;

export const BLANK = `Screen: Home
  `;

export type SnippetId = "screen" | "show" | "each" | "if" | "else" | "on" | "go";

export const SNIPPETS: Record<
  SnippetId,
  { text: string; cursor: number; label: string; hint: string; kind: TokenKind }
> = {
  screen: { text: "Screen: ", cursor: 8, label: "Screen:", hint: "a page", kind: "screen" },
  show: { text: "Show ", cursor: 5, label: "Show", hint: "a part", kind: "show" },
  each: { text: "For each  show ", cursor: 9, label: "For each", hint: "a list", kind: "each" },
  if: { text: "If ", cursor: 3, label: "If", hint: "a choice", kind: "if" },
  else: { text: "Else", cursor: 4, label: "Else", hint: "otherwise", kind: "if" },
  on: { text: "On  go to ", cursor: 3, label: "On", hint: "a tap or event", kind: "on" },
  go: { text: "Go to ", cursor: 6, label: "Go to", hint: "a link", kind: "go" },
};

// ------------------------------------------------------------- line level

// Index of the last whole-word, case-insensitive `kw` in `hay` (after `from`).
function lastWord(hay: string, kw: string, from = 0): number {
  const re = new RegExp(`(?:^|\\s)(${kw.replace(/ /g, "\\s+")})(?=\\s|$)`, "gi");
  let at = -1;
  for (let m = re.exec(hay); m; m = re.exec(hay)) {
    const start = m.index + m[0].length - m[1].length;
    if (start >= from) at = start;
  }
  return at;
}

function splitNames(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

// Strip glue words people naturally type before a tail: "If x, then go to y".
function trimGlue(text: string): string {
  return text.replace(/(?:\s*,)?(?:\s+then)?\s*,?\s*$/i, "").trim();
}

type Seg = [string, TokenKind];

// `If x go to Y` / `For each x show Y`: split off an optional action at the end.
function withTail(body: string, start: number): { head: string; tail?: Tail; segs: Seg[] } {
  const goAt = lastWord(body, "go to", start);
  const showAt = goAt < 0 ? lastWord(body, "show", start) : -1;
  const at = goAt >= 0 ? goAt : showAt;
  if (at < 0) return { head: body.slice(start).trim(), segs: [[body.slice(start), "cond"]] };
  const kwLen = goAt >= 0 ? body.slice(at).match(/^go\s+to/i)![0].length : 4;
  const rest = body.slice(at + kwLen).trim();
  const segs: Seg[] = [
    [body.slice(start, at), "cond"],
    [body.slice(at, at + kwLen), goAt >= 0 ? "go" : "show"],
    [body.slice(at + kwLen), "name"],
  ];
  const head = trimGlue(body.slice(start, at));
  if (!rest) return { head, segs };
  return {
    head,
    segs,
    tail: goAt >= 0 ? { kind: "go", to: rest } : { kind: "show", names: splitNames(rest) },
  };
}

function badTail(body: string, start: number): string | undefined {
  const goAt = lastWord(body, "go to", start);
  if (
    goAt >= 0 &&
    !body
      .slice(goAt)
      .replace(/^go\s+to/i, "")
      .trim()
  )
    return "Say which screen to go to";
  const showAt = lastWord(body, "show", start);
  if (goAt < 0 && showAt >= 0 && !body.slice(showAt + 4).trim()) return "Say what to show";
  return undefined;
}

export function classifyLine(raw: string): Line {
  const lead = raw.match(/^[ \t]*/)![0];
  const indent = lead.replace(/\t/g, "  ").length;
  let body = raw.slice(lead.length);
  const bullet = body.match(/^(?:[-*•]\s+|\d+[.)]\s+)/)?.[0] ?? "";
  body = body.slice(bullet.length);
  const prefix = lead + bullet;
  const make = (stmt: Stmt, segs: Seg[], error?: string): Line => ({
    indent,
    stmt,
    error,
    tokens: [[prefix, "plain"] as Seg, ...segs]
      .filter(([text]) => text)
      .map(([text, kind]) => ({ text, kind })),
  });
  const word = (re: RegExp) => body.match(re)?.[0];
  let m: string | undefined;

  if (!body.trim()) return make({ t: "blank" }, [[body, "plain"]]);
  if ((m = word(/^(?:note:|\/\/)/i))) return make({ t: "note" }, [[body, "note"]]);

  if ((m = word(/^title:/i))) {
    const text = body.slice(m.length).trim();
    return make(
      { t: "title", text },
      [
        [m, "screen"],
        [body.slice(m.length), "name"],
      ],
      text ? undefined : "Give the title a name",
    );
  }

  if ((m = word(/^(?:screen|page|component):/i))) {
    const name = body.slice(m.length).trim();
    const component = /^component/i.test(m);
    return make(
      { t: "block", name, component },
      [
        [m, "screen"],
        [body.slice(m.length), "name"],
      ],
      name ? undefined : `Name the ${component ? "component" : "screen"} after '${m}'`,
    );
  }

  if ((m = word(/^(?:else\s+if|otherwise\s+if)(?=\s|$)/i))) {
    const { head, tail, segs } = withTail(body, m.length);
    return make(
      { t: "elseif", cond: head, tail },
      [[m, "if"], ...segs],
      head ? badTail(body, m.length) : "Say what the condition is",
    );
  }

  if ((m = word(/^(?:else|otherwise)(?=[\s,:]|$)/i))) {
    const rest = body.slice(m.length);
    if (!rest.trim())
      return make({ t: "else" }, [
        [m, "if"],
        [rest, "plain"],
      ]);
    const { tail, segs } = withTail(body, m.length);
    return make(
      { t: "else", tail },
      [[m, "if"], ...segs],
      tail
        ? undefined
        : "After Else, write 'go to' or 'show' – or put the steps on the lines below",
    );
  }

  if ((m = word(/^if(?=\s|$)/i))) {
    const { head, tail, segs } = withTail(body, m.length);
    return make(
      { t: "if", cond: head, tail },
      [[m, "if"], ...segs],
      head ? badTail(body, m.length) : "Say what the condition is after 'If'",
    );
  }

  if ((m = word(/^for\s+each(?=\s|$)/i))) {
    const { head, tail, segs } = withTail(body, m.length);
    return make(
      { t: "each", item: head, tail },
      [[m, "each"], ...segs.map(([text, kind]): Seg => [text, kind === "cond" ? "name" : kind])],
      head ? badTail(body, m.length) : "Say what to repeat, like 'For each product in products'",
    );
  }

  if ((m = word(/^(?:on|when)(?=\s|$)/i))) {
    const { head, tail, segs } = withTail(body, m.length);
    return make(
      { t: "on", event: head, tail },
      [[m, "on"], ...segs],
      head ? badTail(body, m.length) : "Say which event, like 'On tap Buy'",
    );
  }

  if ((m = word(/^go\s+to(?=\s|$)/i))) {
    const to = body.slice(m.length).trim();
    return make(
      { t: "go", to },
      [
        [m, "go"],
        [body.slice(m.length), "name"],
      ],
      to ? undefined : "Say which screen to go to",
    );
  }

  if ((m = word(/^show(?=\s|$)/i))) {
    const names = splitNames(body.slice(m.length));
    return make(
      { t: "show", names },
      [
        [m, "show"],
        [body.slice(m.length), "name"],
      ],
      names.length ? undefined : "Say what to show",
    );
  }

  if ((m = word(/^loop(?=\s|$)/i))) {
    const untilAt = lastWord(body, "until", m.length);
    const goAt = lastWord(body, "go to", untilAt);
    const thenAt = goAt < 0 ? -1 : lastWord(body.slice(0, goAt), "then", untilAt);
    const action = untilAt < 0 ? "" : body.slice(m.length, untilAt).trim();
    const untilEnd = thenAt >= 0 ? thenAt : goAt;
    const until = goAt < 0 ? "" : body.slice(untilAt + 5, untilEnd).trim();
    const goLen = goAt < 0 ? 0 : body.slice(goAt).match(/^go\s+to/i)![0].length;
    const to = goAt < 0 ? "" : body.slice(goAt + goLen).trim();
    if (!action || !until || !to) {
      return make(
        { t: "loop", action, until, to },
        [[body, "plain"]],
        "Write it as: Loop <something> until <event> then go to <screen>",
      );
    }
    const segs: Seg[] = [
      [m, "loop"],
      [body.slice(m.length, untilAt), "cond"],
      [body.slice(untilAt, untilAt + 5), "loop"],
      [body.slice(untilAt + 5, untilEnd), "cond"],
      [thenAt >= 0 ? body.slice(thenAt, goAt) : "", "loop"],
      [body.slice(goAt, goAt + goLen), "go"],
      [body.slice(goAt + goLen), "name"],
    ];
    return make({ t: "loop", action, until, to }, segs);
  }

  let error = "Start the line with Screen:, Show, For each, If, Else, On or Go to";
  if (/^(?:screen|page|component|title)\b/i.test(body)) error = "Add a colon, like 'Screen: Home'";
  else if (/^goto\b/i.test(body)) error = "Write 'Go to' as two words";
  else if (/^foreach\b/i.test(body)) error = "Write 'For each' as two words";
  else if (/^elif\b|^elseif\b/i.test(body)) error = "Write 'Else if' as two words";
  return make({ t: "unknown" }, [[body, "plain"]], error);
}

// ------------------------------------------------------------ tree level

type Frame = { indent: number; children: Node[] };

function tailNodes(tail: Tail | undefined, line: number): Node[] {
  if (!tail) return [];
  if (tail.kind === "go") return [{ kind: "go", to: tail.to, line }];
  return tail.names.map((name) => ({ kind: "show" as const, name, line, children: [] }));
}

export function parse(source: string): Journey {
  const lines = source.split(/\r\n|\n|\r/).map(classifyLine);
  const blocks: Block[] = [];
  const issues: Issue[] = [];
  let title: string | null = null;
  let block: Block | null = null;
  let stack: Frame[] = [];

  lines.forEach((line, index) => {
    const number = index + 1;
    const fail = (message: string) => {
      line.error = message;
      issues.push({ line: number, message });
    };
    if (line.error) return issues.push({ line: number, message: line.error });
    const { stmt } = line;
    if (stmt.t === "blank" || stmt.t === "note") return;
    if (stmt.t === "title") return void (title = stmt.text);
    if (stmt.t === "block") {
      if (blocks.some((b) => b.name.toLowerCase() === stmt.name.toLowerCase())) {
        return fail(`'${stmt.name}' is already defined above`);
      }
      block = {
        name: stmt.name,
        kind: stmt.component ? "component" : "screen",
        line: number,
        children: [],
      };
      blocks.push(block);
      stack = [{ indent: -1, children: block.children }];
      return;
    }
    if (!block) return fail("Start with a 'Screen:' line first");

    while (stack.length > 1 && stack[stack.length - 1].indent >= line.indent) stack.pop();
    const siblings = stack[stack.length - 1].children;
    const open = (children: Node[]) => stack.push({ indent: line.indent, children });

    switch (stmt.t) {
      case "show": {
        const nodes = stmt.names.map((name) => ({
          kind: "show" as const,
          name,
          line: number,
          children: [] as Node[],
        }));
        siblings.push(...nodes);
        open(nodes[nodes.length - 1].children);
        return;
      }
      case "go":
        siblings.push({ kind: "go", to: stmt.to, line: number });
        return;
      case "loop":
        siblings.push({
          kind: "loop",
          action: stmt.action,
          until: stmt.until,
          to: stmt.to,
          line: number,
        });
        return;
      case "each":
      case "on": {
        const node: Node =
          stmt.t === "each"
            ? {
                kind: "each",
                item: stmt.item,
                line: number,
                children: tailNodes(stmt.tail, number),
              }
            : {
                kind: "on",
                event: stmt.event,
                line: number,
                children: tailNodes(stmt.tail, number),
              };
        siblings.push(node);
        open(node.children);
        return;
      }
      case "if": {
        const branch: Branch = {
          cond: stmt.cond,
          line: number,
          children: tailNodes(stmt.tail, number),
        };
        siblings.push({ kind: "if", line: number, branches: [branch] });
        open(branch.children);
        return;
      }
      case "elseif":
      case "else": {
        const last = siblings[siblings.length - 1];
        if (last?.kind !== "if") return fail("Put this right after an If, at the same indent");
        if (last.branches[last.branches.length - 1].cond === null)
          return fail("This If already has an Else");
        const branch: Branch = {
          cond: stmt.t === "elseif" ? stmt.cond : null,
          line: number,
          children: tailNodes(stmt.tail, number),
        };
        last.branches.push(branch);
        open(branch.children);
        return;
      }
      default:
        return;
    }
  });

  // Screens that are linked to but never written become dashed "ghosts".
  const known = new Set(blocks.map((b) => b.name.toLowerCase()));
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind === "go" || node.kind === "loop") {
        if (!known.has(node.to.toLowerCase())) {
          known.add(node.to.toLowerCase());
          blocks.push({ name: node.to, kind: "ghost", line: node.line, children: [] });
        }
      } else if (node.kind === "if") node.branches.forEach((b) => visit(b.children));
      else visit(node.children);
    }
  };
  blocks.slice().forEach((b) => visit(b.children));

  return { title, blocks, issues, lines };
}

// --------------------------------------------------------------- mermaid

export function mermaidLabel(input: string): string {
  const clean = input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "and")
    .replace(/[<>[\]{}|#"`]/g, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return " ";
  return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean;
}

const COLORS = {
  go: "#e4a04a",
  if: "#e7c27a",
  on: "#d99bc4",
  loop: "#9db7d4",
  muted: "#a39888",
};

const CLASS_DEFS = [
  "classDef screen fill:#211e17,stroke:#e4a04a,color:#f4efe6,stroke-width:1.5px",
  "classDef start fill:#e4a04a,stroke:#c4842e,color:#1a1208,stroke-width:1.5px",
  "classDef component fill:#1b1a22,stroke:#b3a6e0,color:#f4efe6,stroke-width:1.5px",
  "classDef ghost fill:#14130f,stroke:#a39888,color:#d9d0c2,stroke-dasharray:5 4,stroke-width:1.5px",
  "classDef show fill:#1c1a15,stroke:#5a5244,color:#f4efe6",
  "classDef ref fill:#1b1a22,stroke:#b3a6e0,color:#f4efe6",
  "classDef cond fill:#2a2415,stroke:#e7c27a,color:#f4efe6",
  "classDef on fill:#26192a,stroke:#d99bc4,color:#f4efe6",
  "classDef go fill:#2a1f10,stroke:#e4a04a,color:#f4efe6",
  "classDef loop fill:#17211c,stroke:#8fbf9f,color:#f4efe6",
];

type EdgeOpts = { label?: string; color?: string; style?: "-->" | "-.->" | "~~~" };

class Writer {
  out: string[] = [];
  // Mermaid puts a node in whichever subgraph first mentions it, so links
  // between screens are held back and written after every subgraph.
  later: [string, string, EdgeOpts][] = [];
  classes = new Map<string, string[]>();
  links: string[] = [];
  private link = 0;
  private seq = 0;

  id(prefix: string) {
    return `${prefix}${this.seq++}`;
  }
  line(text: string, depth = 1) {
    this.out.push(`${"  ".repeat(depth)}${text}`);
  }
  tag(id: string, cls: string) {
    this.classes.set(cls, [...(this.classes.get(cls) ?? []), id]);
  }
  // Mermaid numbers every link, invisible ones included, for linkStyle.
  edge(from: string, to: string, opts: EdgeOpts = {}, depth = 1) {
    const arrow = opts.style ?? "-->";
    const label = opts.label && arrow !== "~~~" ? `|"${mermaidLabel(opts.label)}"|` : "";
    this.line(`${from} ${arrow}${label} ${to}`, depth);
    if (opts.color)
      this.links.push(`  linkStyle ${this.link} stroke:${opts.color},stroke-width:1.7px`);
    this.link += 1;
  }
  finish(title: string | null) {
    for (const [from, to, opts] of this.later) this.edge(from, to, opts);
    const head = title ? ["---", `title: ${mermaidLabel(title).replace(/:/g, " ")}`, "---"] : [];
    const classLines = [...this.classes].map(([cls, ids]) => `  class ${ids.join(",")} ${cls}`);
    return [
      ...head,
      ...this.out,
      ...CLASS_DEFS.map((c) => `  ${c}`),
      ...classLines,
      ...this.links,
    ].join("\n");
  }
}

function findBlock(blocks: Block[], name: string) {
  const key = name.toLowerCase();
  return blocks.find((b) => b.name.toLowerCase() === key);
}

/** Screen-level map: one box per screen, arrows for every way to move on. */
function flowMermaid(journey: Journey): string {
  const { blocks } = journey;
  const w = new Writer();
  w.out.push("flowchart TD");
  const ids = new Map<Block, string>();
  const startBlock = blocks.find((b) => b.kind === "screen");
  const used = new Set<Block>();

  // Components only appear when they carry interactions of their own.
  const hasMoves = (nodes: Node[]): boolean =>
    nodes.some((n) =>
      n.kind === "go" || n.kind === "loop"
        ? true
        : n.kind === "if"
          ? n.branches.some((b) => hasMoves(b.children))
          : hasMoves(n.children),
    );

  for (const block of blocks) {
    if (block.kind === "component" && !hasMoves(block.children)) continue;
    const id = w.id("n");
    ids.set(block, id);
    const shape =
      block.kind === "component"
        ? `[["${mermaidLabel(block.name)}"]]`
        : `["${mermaidLabel(block.name)}"]`;
    w.line(`${id}${shape}`);
    w.tag(id, block === startBlock ? "start" : block.kind);
  }

  const seen = new Set<string>();
  const walk = (from: Block, nodes: Node[], labels: string[], color: string) => {
    const fromId = ids.get(from)!;
    for (const node of nodes) {
      if (node.kind === "go") {
        const target = findBlock(blocks, node.to);
        const toId = target && ids.get(target);
        const key = `${fromId}>${toId}>${labels.join()}`;
        if (!toId || seen.has(key)) continue;
        seen.add(key);
        w.edge(fromId, toId, { label: labels.join(" · ") || undefined, color });
      } else if (node.kind === "loop") {
        const target = findBlock(blocks, node.to);
        const toId = target && ids.get(target);
        if (!toId) continue;
        const loopId = w.id("l");
        w.line(`${loopId}(["${mermaidLabel(`Loop ${node.action}`)}"])`);
        w.tag(loopId, "loop");
        w.edge(fromId, loopId, { label: labels.join(" · ") || undefined, color: COLORS.loop });
        w.edge(loopId, toId, { label: `until ${node.until}`, color: "#8fbf9f" });
      } else if (node.kind === "if") {
        node.branches.forEach((b) =>
          walk(from, b.children, [...labels, b.cond ?? "else"], COLORS.if),
        );
      } else if (node.kind === "on") {
        walk(from, node.children, [...labels, node.event], COLORS.on);
      } else if (node.kind === "show") {
        const ref = findBlock(blocks, node.name);
        if (ref?.kind === "component" && ids.has(ref) && !used.has(ref)) {
          used.add(ref);
          w.edge(fromId, ids.get(ref)!, { style: "-.->", color: "#b3a6e0" });
        }
        walk(from, node.children, labels, color);
      } else {
        walk(from, node.children, labels, color);
      }
    }
  };
  for (const block of blocks) if (ids.has(block)) walk(block, block.children, [], COLORS.go);
  return w.finish(journey.title);
}

/** Storyboard: each screen drawn as a box holding its layout, with interactions wired between them. */
function storyMermaid(journey: Journey): string {
  const { blocks } = journey;
  const w = new Writer();
  w.out.push("flowchart TD");
  const targets = new Map<Block, string>();
  const startBlock = blocks.find((b) => b.kind === "screen");

  // Every block gets a header node so arrows always land on a real node,
  // which keeps Mermaid's cluster layout stable.
  for (const block of blocks) targets.set(block, w.id("h"));

  const target = (name: string) => {
    const b = findBlock(blocks, name);
    return b ? targets.get(b) : undefined;
  };

  // Returns the ids of nodes emitted at this level (first one is the entry).
  const emit = (owner: Block, nodes: Node[], depth: number): string[] => {
    const ids: string[] = [];
    for (const node of nodes) {
      if (node.kind === "show") {
        const ref = findBlock(blocks, node.name);
        if (node.children.length) {
          const id = w.id("g");
          w.line(`subgraph ${id}["${mermaidLabel(node.name)}"]`, depth);
          w.line("direction TB", depth + 1);
          chain(emit(owner, node.children, depth + 1), depth + 1);
          w.line("end", depth);
          w.tag(id, "show");
          ids.push(id);
        } else {
          const id = w.id("s");
          w.line(`${id}["${mermaidLabel(node.name)}"]`, depth);
          w.tag(id, ref?.kind === "component" ? "ref" : "show");
          if (ref?.kind === "component" && ref !== owner)
            w.later.push([id, targets.get(ref)!, { style: "-.->", color: "#b3a6e0" }]);
          ids.push(id);
        }
      } else if (node.kind === "each") {
        const id = w.id("e");
        if (node.children.length) {
          w.line(`subgraph ${id}["${mermaidLabel(`For each ${node.item}`)}"]`, depth);
          w.line("direction TB", depth + 1);
          chain(emit(owner, node.children, depth + 1), depth + 1);
          w.line("end", depth);
          w.line(`style ${id} stroke-dasharray:5 4`, depth);
        } else {
          w.line(
            `${id}@{ shape: procs, label: "${mermaidLabel(`For each ${node.item}`)}" }`,
            depth,
          );
          w.tag(id, "show");
        }
        ids.push(id);
      } else if (node.kind === "if") {
        const id = w.id("c");
        w.line(`${id}{"${mermaidLabel(node.branches[0].cond ?? "")}?"}`, depth);
        w.tag(id, "cond");
        ids.push(id);
        node.branches.forEach((branch, i) => {
          const label = i === 0 ? "yes" : branch.cond ? `else if ${branch.cond}` : "else";
          const inner = emit(owner, branch.children, depth);
          chain(inner, depth);
          if (inner[0]) w.edge(id, inner[0], { label, color: COLORS.if });
        });
      } else if (node.kind === "on") {
        const id = w.id("o");
        w.line(`${id}(["${mermaidLabel(`on ${node.event}`)}"])`, depth);
        w.tag(id, "on");
        ids.push(id);
        const rest = node.children.filter((child) => child.kind !== "go");
        for (const child of node.children) {
          if (child.kind !== "go") continue;
          const to = target(child.to);
          if (to && to !== targets.get(owner)) w.later.push([id, to, { color: COLORS.on }]);
        }
        const inner = emit(owner, rest, depth);
        chain(inner, depth);
        if (inner[0]) w.edge(id, inner[0], { color: COLORS.on });
      } else if (node.kind === "go") {
        const id = w.id("t");
        w.line(`${id}(["${mermaidLabel(`go to ${node.to}`)}"])`, depth);
        w.tag(id, "go");
        const to = target(node.to);
        if (to && to !== targets.get(owner)) w.later.push([id, to, { color: COLORS.go }]);
        ids.push(id);
      } else {
        const id = w.id("l");
        w.line(`${id}(["${mermaidLabel(`Loop ${node.action} until ${node.until}`)}"])`, depth);
        w.tag(id, "loop");
        const to = target(node.to);
        if (to && to !== targets.get(owner)) w.later.push([id, to, { color: "#8fbf9f" }]);
        ids.push(id);
      }
    }
    return ids;
  };

  // Invisible links stack siblings top to bottom.
  const chain = (ids: string[], depth: number) => {
    for (let i = 1; i < ids.length; i += 1) w.edge(ids[i - 1], ids[i], { style: "~~~" }, depth);
  };

  for (const block of blocks) {
    const head = targets.get(block)!;
    const cls = block === startBlock ? "start" : block.kind;
    if (!block.children.length) {
      w.line(`${head}["${mermaidLabel(block.name)}"]`);
      w.tag(head, cls);
      continue;
    }
    const id = w.id("b");
    w.line(`subgraph ${id}[" "]`);
    w.line("direction TB", 2);
    w.line(`${head}["${mermaidLabel(block.name)}"]`, 2);
    w.tag(head, cls);
    chain([head, ...emit(block, block.children, 2)], 2);
    w.line("end");
    w.line(`style ${id} fill:#13120e,stroke:${block.kind === "component" ? "#b3a6e0" : "#342f26"}`);
  }
  return w.finish(journey.title);
}

export function toMermaid(journey: Journey, view: ViewKind): string {
  if (!journey.blocks.length) return "";
  return view === "flow" ? flowMermaid(journey) : storyMermaid(journey);
}

// ---------------------------------------------------------------- editing

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
  // New lines keep the current line's indent, so snippets land in the same block.
  const indent = before.match(/^[ \t]*/)![0];
  const prefix = before.trim() ? `\n${indent}` : "";
  const suffix = after.trim() ? `\n${indent}` : "";
  const piece = prefix + snippet + suffix;
  const next = source.slice(0, start) + piece + source.slice(end);
  return { next, cursor: start + prefix.length + cursorInSnippet };
}
