// Plainpath: describe screens, layout and interactions in plain English,
// get a Mermaid flowchart back. Pure module: no DOM, no imports.

export type TokenKind =
  | "plain"
  | "screen"
  | "go"
  | "if"
  | "loop"
  | "show"
  | "on"
  | "each"
  | "button"
  | "text"
  | "media"
  | "step"
  | "name"
  | "cond"
  | "note";

export type Token = { text: string; kind: TokenKind };

type Tail = { kind: "go"; to: string } | { kind: "show"; names: string[] };

export type BlockKind = "screen" | "modal" | "component";

export type MediaSize = "wide" | "square" | "tall";

type Stmt =
  | { t: "blank" }
  | { t: "note" }
  | { t: "title"; text: string }
  | { t: "block"; name: string; kind: BlockKind }
  | { t: "if"; cond: string; tail?: Tail }
  | { t: "elseif"; cond: string; tail?: Tail }
  | { t: "else"; tail?: Tail }
  | { t: "each"; item: string; tail?: Tail }
  | { t: "on"; event: string; tail?: Tail }
  | { t: "button"; label: string; tail?: Tail }
  | { t: "choose"; prompt: string }
  | { t: "option"; label: string; text: string; tail?: Tail }
  | { t: "words"; text: string }
  | { t: "step"; title: string }
  | { t: "text"; text: string; heading: boolean }
  | { t: "media"; caption: string; video: boolean; size: MediaSize }
  | { t: "go"; to: string }
  | { t: "show"; names: string[] }
  | { t: "loop"; action: string; until: string; to: string }
  | { t: "unknown" };

export type Line = { tokens: Token[]; indent: number; stmt: Stmt; error?: string };

export type Branch = { cond: string | null; line: number; children: Node[] };

export type StepNode = {
  kind: "step";
  title: string;
  line: number;
  children: Node[];
  number: number;
  total: number;
};

/** `step` is set when the target is a step of the same screen ("next step", "step 3"). */
export type Node =
  | { kind: "show"; name: string; line: number; children: Node[] }
  | { kind: "text"; text: string; heading: boolean; line: number }
  | { kind: "media"; caption: string; video: boolean; size: MediaSize; line: number }
  | { kind: "button"; label: string; line: number; children: Node[] }
  | { kind: "choose"; prompt: string; line: number; children: Node[] }
  | { kind: "option"; label: string; text: string; line: number; children: Node[] }
  | { kind: "each"; item: string; line: number; children: Node[] }
  | { kind: "on"; event: string; line: number; children: Node[] }
  | { kind: "if"; line: number; branches: Branch[] }
  | StepNode
  | { kind: "go"; to: string; line: number; step?: number }
  | { kind: "loop"; action: string; until: string; to: string; line: number; step?: number };

export type Block = {
  name: string;
  kind: BlockKind | "ghost";
  line: number;
  children: Node[];
  steps: StepNode[];
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

const ROAST = `Title: Datakaffe roast
Screen: Library
  Text: rooost.party
  For each blend in my library
    Show Blend Card
  On tap + on Ethiopian Sunset open Coffee Type

Component: Blend Card
  Show Blend Photo, Name, + Button

Popup: Coffee Type
  Headline: Which kind of roast?
  Choose roast flow:
    Datakaffe: weigh and analyse the beans first, goes to Datakaffe Roasting
    Almindelig kaffe: the classic roast, goes to Regular Roasting
  Button Cancel goes to Library

Screen: Datakaffe Roasting
  Step: Measure beans X
    Text:
      Put the analysis bowl on the scale.
      Measure 200 g of beans X into it.
    When the USB analyser has made the analysis go to next step
  Step: Measure beans Y
    Text:
      Empty the bowl into the roaster.
      Measure 200 g of beans Y into it.
    When the USB analyser has made the analysis go to next step
  Step: Put both bowls into the roaster
  Step: Start the roast
`;

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
    Button Checkout goes to Cart
  On tap Cart Icon go to Cart
  On submit search go to Results

Component: Product Card
  Show Image, Title, Price
  Button Add goes to Cart

Screen: Cart
  For each item in cart show Cart Row
  On tap Checkout
    If signed in go to Payment
    Else open Sign In

Popup: Sign In
  Show Email Field, Password Field
  Button Sign in goes to Payment

Screen: Payment
  Loop bank checks the card until it answers then go to Receipt
  If card is declined go to Payment
`;

const SIGNUP = `Title: Create account
Screen: Landing
  Headline: Plan your week in a minute
  Video: 30 second product tour
  Button Sign up goes to Sign Up

Screen: Sign Up
  Show Email Field, Password Field
  On submit
    If email is taken
      Text: That email already has an account
    Else if form is valid go to Check Inbox
    Else
      Show Field Hints

Screen: Check Inbox
  Loop waiting for the link until they tap it then go to Welcome

Screen: Welcome
  Go to Home
`;

export const EXAMPLES: { id: string; label: string; source: string }[] = [
  { id: "roast", label: "Roast", source: ROAST },
  { id: "shop", label: "Shop", source: SHOP },
  { id: "signup", label: "Sign up", source: SIGNUP },
];

export const STARTER = ROAST;

export const BLANK = `Screen: Home
  `;

// ------------------------------------------------------------- line level

// Ways of saying "go to". The passive ones read naturally after an event:
// "When the scan is done you are taken to Results".
const GO = String.raw`go(?:es)?\s+to|opens?|(?:advance|move|navigate|continue|jump|return)s?\s+to|(?:is|are|gets?)\s+(?:advanced|taken|sent|moved|returned)\s+to`;
const GO_START =
  /^(?:go(?:es)?\s+to|open|(?:advance|move|navigate|continue|jump|return)\s+to)(?=\s|$)/i;
const BARE = /^opens?$|^show$/i;

// "Image: hero photo", "Photo of the beans", "Video: how to roast (square)".
const MEDIA_START =
  /^(?:image|picture|photo|illustration|logo|thumbnail|avatar|banner|video|clip|media)(?:\s*:|\s+of\b|(?=\s*$))\s*/i;

// Show parts named like pictures are drawn as pictures too: "Show Hero Image".
const MEDIA_NAME = /\b(?:image|picture|photo|illustration|logo|thumbnail|avatar|video)s?$/i;

// Avatars default to square; everything else to a landscape frame.
const defaultSize = (name: string): MediaSize => (/avatars?\b/i.test(name) ? "square" : "wide");

function mediaCaption(text: string, fallback: MediaSize): { caption: string; size: MediaSize } {
  const sized = text.match(/\s*\((wide|square|tall|portrait|landscape)\)\s*$/i);
  const word = sized?.[1].toLowerCase();
  const size: MediaSize = !word
    ? fallback
    : word === "square"
      ? "square"
      : word === "tall" || word === "portrait"
        ? "tall"
        : "wide";
  return { caption: unquote(sized ? text.slice(0, sized.index) : text), size };
}

// Compiled once per pattern: these run for every line on every keystroke.
const regexes = new Map<string, RegExp>();
function wordRegex(words: string): RegExp {
  let re = regexes.get(words);
  if (!re) regexes.set(words, (re = new RegExp(`(?:^|\\s)(${words})(?=\\s|$)`, "gi")));
  re.lastIndex = 0;
  return re;
}

// Index of the last whole-word, case-insensitive `kw` in `hay` (after `from`).
function lastWord(hay: string, kw: string, from = 0): number {
  const re = wordRegex(kw.replace(/ /g, "\\s+"));
  let at = -1;
  for (let m = re.exec(hay); m; m = re.exec(hay)) {
    const start = m.index + m[0].length - m[1].length;
    if (start >= from) at = start;
  }
  return at;
}

const unquote = (text: string) =>
  text
    .trim()
    .replace(/^["“'](.*)["”']$/, "$1")
    .replace(/[.!]+$/, "")
    .trim();

function splitNames(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map(unquote)
    .filter(Boolean);
}

// Strip glue people naturally type before an action: "If x, then go to y",
// "When it is done you are taken to y".
function trimGlue(text: string): string {
  return text
    .replace(/(?:[\s,]+(?:then|you|they|we|he|she|(?:the\s+)?users?))*[\s,]*$/i, "")
    .trim();
}

type Seg = [string, TokenKind];

type Split = { head: string; tail?: Tail; segs: Seg[]; error?: string };

// `If x go to Y` / `For each x show Y`: split off an optional action at the end.
// The last action word wins, so "If menu is open show Help" shows Help.
function withTail(body: string, start: number, allowShow = true): Split {
  const re = wordRegex(`${GO}${allowShow ? "|show" : ""}`);
  const found: { at: number; word: string }[] = [];
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const at = m.index + m[0].length - m[1].length;
    if (at >= start) found.push({ at, word: m[1] });
  }
  while (found.length) {
    const { at, word } = found.pop()!;
    const rest = unquote(body.slice(at + word.length));
    // A bare "open" or "show" with nothing after is part of the sentence, not an action.
    if (!rest && BARE.test(word)) continue;
    const isShow = /^show$/i.test(word);
    const segs: Seg[] = [
      [body.slice(start, at), "cond"],
      [word, isShow ? "show" : "go"],
      [body.slice(at + word.length), "name"],
    ];
    const head = trimGlue(body.slice(start, at));
    if (!rest) return { head, segs, error: "Say which screen to go to" };
    const tail: Tail = isShow
      ? { kind: "show", names: splitNames(rest) }
      : { kind: "go", to: rest };
    return { head, segs, tail };
  }
  return { head: unquote(body.slice(start)), segs: [[body.slice(start), "cond"]] };
}

// Indent, the text after any indent or list bullet, and a Line builder that
// keeps that prefix as the first token.
function lineParts(raw: string) {
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
  return { indent, body, make };
}

const asLabel = (segs: Seg[]): Seg[] =>
  segs.map(([text, kind]): Seg => [text, kind === "cond" ? "button" : kind]);

/**
 * A line indented under `Choose …`: `Label: description [goes to X]`, or just
 * `Label [goes to X]`. Read in context by the parser, so any words can be an option.
 */
export function classifyOption(raw: string): Line {
  const { body, make } = lineParts(raw);
  if (!body.trim()) return make({ t: "blank" }, [[body, "plain"]]);
  if (/^(?:note:|\/\/)/i.test(body)) return make({ t: "note" }, [[body, "note"]]);
  const colon = body.indexOf(":");
  if (colon > 0) {
    const label = unquote(body.slice(0, colon));
    const { head, tail, segs, error } = withTail(body, colon + 1, false);
    return make(
      { t: "option", label, text: head, tail },
      [[body.slice(0, colon), "button"], [":", "plain"], ...segs],
      label ? error : "Name the option before the colon",
    );
  }
  const { head, tail, segs, error } = withTail(body, 0, false);
  return make({ t: "option", label: head, text: "", tail }, asLabel(segs), error);
}

/** A line inside a multi-line `Text:` block: taken word for word. */
export function classifyWords(raw: string): Line {
  const { body, make } = lineParts(raw);
  return make({ t: "words", text: body.trim() }, [[body, "name"]]);
}

export function classifyLine(raw: string): Line {
  const { body, make } = lineParts(raw);
  const word = (re: RegExp) => body.match(re)?.[0];
  const keyed = (kind: TokenKind, m: string, rest: TokenKind = "name"): Seg[] => [
    [m, kind],
    [body.slice(m.length), rest],
  ];
  let m: string | undefined;

  if (!body.trim()) return make({ t: "blank" }, [[body, "plain"]]);
  if ((m = word(/^(?:note:|\/\/)/i))) return make({ t: "note" }, [[body, "note"]]);

  if ((m = word(/^title:/i))) {
    const text = body.slice(m.length).trim();
    return make(
      { t: "title", text },
      keyed("screen", m),
      text ? undefined : "Give the title a name",
    );
  }

  if ((m = word(/^(?:screen|page|view|component|modal|popup|pop-up|dialog|sheet):/i))) {
    const name = unquote(body.slice(m.length));
    const kind: BlockKind = /^(?:screen|page|view)/i.test(m)
      ? "screen"
      : /^component/i.test(m)
        ? "component"
        : "modal";
    return make(
      { t: "block", name, kind },
      keyed("screen", m),
      name ? undefined : `Give it a name after '${m}'`,
    );
  }

  if ((m = word(/^step\b(?:\s*\d+)?(?:\s+(?:of|out\s+of)\s+\S+)?\s*[:.\-–—]?/i))) {
    const title = unquote(body.slice(m.length));
    return make(
      { t: "step", title },
      keyed("step", m),
      title ? undefined : "Give the step a headline, like 'Step: Weigh the beans'",
    );
  }

  if ((m = word(MEDIA_START))) {
    const { caption, size } = mediaCaption(body.slice(m.length), defaultSize(m));
    return make({ t: "media", caption, video: /^video|^clip/i.test(m), size }, keyed("media", m));
  }

  if ((m = word(/^(?:text|headline|heading|label|message|says?)\b\s*:?/i))) {
    const text = unquote(body.slice(m.length));
    const heading = /^head/i.test(m);
    // With nothing after the colon, the indented lines below are the text.
    return make({ t: "text", text, heading }, keyed("text", m));
  }

  if ((m = word(/^(?:choose|select|pick)(?=[\s:]|$)/i))) {
    const prompt = unquote(body.slice(m.length).replace(/:\s*$/, ""));
    return make({ t: "choose", prompt }, keyed("button", m));
  }

  if ((m = word(/^(?:button|link)\b\s*:?/i))) {
    const { head, tail, segs, error } = withTail(body, m.length, false);
    return make(
      { t: "button", label: head, tail },
      [[m, "button"], ...asLabel(segs)],
      head ? error : "Say what the button says, like 'Button Buy goes to Cart'",
    );
  }

  if ((m = word(/^(?:else\s+if|otherwise\s+if)(?=\s|$)/i))) {
    const { head, tail, segs, error } = withTail(body, m.length);
    return make(
      { t: "elseif", cond: head, tail },
      [[m, "if"], ...segs],
      head ? error : "Say what the condition is",
    );
  }

  if ((m = word(/^(?:else|otherwise)(?=[\s,:]|$)/i))) {
    const rest = body.slice(m.length);
    if (!rest.trim()) return make({ t: "else" }, keyed("if", m, "plain"));
    const { tail, segs, error } = withTail(body, m.length);
    return make(
      { t: "else", tail },
      [[m, "if"], ...segs],
      error ??
        (tail ? undefined : "After Else, write 'go to …' or 'show …', or put the lines below it"),
    );
  }

  if ((m = word(/^if(?=\s|$)/i))) {
    const { head, tail, segs, error } = withTail(body, m.length);
    return make(
      { t: "if", cond: head, tail },
      [[m, "if"], ...segs],
      head ? error : "Say what the condition is after 'If'",
    );
  }

  if ((m = word(/^for\s+each(?=\s|$)/i))) {
    const { head, tail, segs, error } = withTail(body, m.length);
    return make(
      { t: "each", item: head, tail },
      [[m, "each"], ...segs.map(([text, kind]): Seg => [text, kind === "cond" ? "name" : kind])],
      head ? error : "Say what to repeat, like 'For each product in products'",
    );
  }

  if ((m = word(/^(?:on|when|after|once)(?=\s|$)/i))) {
    const { head, tail, segs, error } = withTail(body, m.length);
    return make(
      { t: "on", event: head, tail },
      [[m, "on"], ...segs],
      head ? error : "Say which event, like 'When they tap Buy'",
    );
  }

  if ((m = word(GO_START))) {
    const to = unquote(body.slice(m.length));
    return make({ t: "go", to }, keyed("go", m), to ? undefined : "Say which screen to go to");
  }

  if ((m = word(/^show(?=\s|$)/i))) {
    const rest = body.slice(m.length).trim();
    // Show "Some words" is text on the screen rather than a named part.
    if (/^["“]/.test(rest)) {
      return make({ t: "text", text: unquote(rest), heading: false }, keyed("show", m, "plain"));
    }
    const names = splitNames(rest);
    return make(
      { t: "show", names },
      keyed("show", m),
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
    const to = goAt < 0 ? "" : unquote(body.slice(goAt + goLen));
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

  let error = "Start the line with Screen:, Show, Text:, Button, Step:, If, When or Go to";
  if (/^(?:screen|page|component|popup|modal|title)\b/i.test(body))
    error = "Add a colon, like 'Screen: Home'";
  else if (/^goto\b/i.test(body)) error = "Write 'Go to' as two words";
  else if (/^foreach\b/i.test(body)) error = "Write 'For each' as two words";
  else if (/^elif\b|^elseif\b/i.test(body)) error = "Write 'Else if' as two words";
  else if (/^(?:user|they|you|he|she)\b/i.test(body))
    error = "Describe it from the screen's side: 'When they tap Buy go to Cart'";
  return make({ t: "unknown" }, [[body, "plain"]], error);
}

// ------------------------------------------------------------ tree level

type TextNode = Extract<Node, { kind: "text" }>;

type Frame = { indent: number; children: Node[]; choose?: boolean; words?: TextNode };

function tailNodes(tail: Tail | undefined, line: number): Node[] {
  if (!tail) return [];
  if (tail.kind === "go") return [{ kind: "go", to: tail.to, line }];
  return tail.names.map((name) => ({ kind: "show" as const, name, line, children: [] }));
}

const childrenOf = (node: Node): Node[] =>
  node.kind === "if"
    ? node.branches.flatMap((b) => b.children)
    : "children" in node
      ? node.children
      : [];

// "next step", "previous step", "step 3", "the first/last step" → step number.
function stepTarget(to: string, current: number | null, total: number): number | string | null {
  const text = to.toLowerCase().replace(/^the\s+/, "");
  const numbered = text.match(/^step\s+(\d+)$/);
  if (numbered) return Number(numbered[1]);
  if (text === "first step") return 1;
  if (text === "last step") return total;
  const relative = text.match(/^(next|previous|prev) step$/);
  if (!relative) return null;
  if (current == null) return `'${to}' only works inside a Step`;
  return relative[1] === "next" ? current + 1 : current - 1;
}

export function parse(source: string): Journey {
  const raw = source.split(/\r\n|\n|\r/);
  const lines = raw.map(classifyLine);
  const blocks: Block[] = [];
  const issues: Issue[] = [];
  let title: string | null = null;
  let block: Block | null = null;
  let stack: Frame[] = [];

  lines.forEach((first, index) => {
    const number = index + 1;
    let line = first;
    const words = stack[stack.length - 1]?.words;
    if (words && line.stmt.t === "blank") {
      // A blank line inside a text block is a paragraph break.
      if (words.text) words.text += "\n";
      return;
    }
    if (block && line.stmt.t !== "blank" && line.stmt.t !== "note") {
      while (stack.length > 1 && stack[stack.length - 1].indent >= line.indent) stack.pop();
      const top = stack[stack.length - 1];
      // Lines indented under a Choose are its options, whatever words they start with.
      if (top.choose) line = lines[index] = classifyOption(raw[index]);
      // Lines indented under an empty Text: are its text, word for word.
      if (top.words) {
        line = lines[index] = classifyWords(raw[index]);
        top.words.text += (top.words.text ? "\n" : "") + (line.stmt as { text: string }).text;
        return;
      }
    }
    const fail = (message: string) => {
      line.error = message;
      issues.push({ line: number, message });
    };
    if (line.stmt.t === "unknown" && block) {
      const siblings = stack[stack.length - 1].children;
      // An option written at the same indent as its Choose.
      if (siblings[siblings.length - 1]?.kind === "choose") {
        line.error = "Indent the options under 'Choose …' by two spaces (or Tab)";
      }
    }
    if (line.error) return issues.push({ line: number, message: line.error });
    const { stmt } = line;
    if (stmt.t === "blank" || stmt.t === "note") return;
    if (stmt.t === "title") return void (title = stmt.text);
    if (stmt.t === "block") {
      if (blocks.some((b) => b.name.toLowerCase() === stmt.name.toLowerCase())) {
        return fail(`'${stmt.name}' is already defined above`);
      }
      block = { name: stmt.name, kind: stmt.kind, line: number, children: [], steps: [] };
      blocks.push(block);
      stack = [{ indent: -1, children: block.children }];
      return;
    }
    if (!block) return fail("Start with a 'Screen:' line first");

    while (stack.length > 1 && stack[stack.length - 1].indent >= line.indent) stack.pop();
    const siblings = stack[stack.length - 1].children;
    const add = (node: Node, open = true) => {
      siblings.push(node);
      if (open && "children" in node) stack.push({ indent: line.indent, children: node.children });
    };

    switch (stmt.t) {
      case "show": {
        const nodes = stmt.names.map((name) => ({
          kind: "show" as const,
          name,
          line: number,
          children: [],
        }));
        nodes.slice(0, -1).forEach((node) => add(node, false));
        return add(nodes[nodes.length - 1]);
      }
      case "text": {
        const node: TextNode = {
          kind: "text",
          text: stmt.text,
          heading: stmt.heading,
          line: number,
        };
        siblings.push(node);
        if (!stmt.text) stack.push({ indent: line.indent, children: [], words: node });
        return;
      }
      case "media":
        return add({
          kind: "media",
          caption: stmt.caption,
          video: stmt.video,
          size: stmt.size,
          line: number,
        });
      case "go":
        return add({ kind: "go", to: stmt.to, line: number });
      case "loop":
        return add({
          kind: "loop",
          action: stmt.action,
          until: stmt.until,
          to: stmt.to,
          line: number,
        });
      case "step":
        return add({
          kind: "step",
          title: stmt.title,
          line: number,
          children: [],
          number: 0,
          total: 0,
        });
      case "choose": {
        const node: Node = { kind: "choose", prompt: stmt.prompt, line: number, children: [] };
        siblings.push(node);
        stack.push({ indent: line.indent, children: node.children, choose: true });
        return;
      }
      case "option":
        return add({
          kind: "option",
          label: stmt.label,
          text: stmt.text,
          line: number,
          children: tailNodes(stmt.tail, number),
        });
      case "button":
        return add({
          kind: "button",
          label: stmt.label,
          line: number,
          children: tailNodes(stmt.tail, number),
        });
      case "each":
        return add({
          kind: "each",
          item: stmt.item,
          line: number,
          children: tailNodes(stmt.tail, number),
        });
      case "on":
        return add({
          kind: "on",
          event: stmt.event,
          line: number,
          children: tailNodes(stmt.tail, number),
        });
      case "if": {
        const branch: Branch = {
          cond: stmt.cond,
          line: number,
          children: tailNodes(stmt.tail, number),
        };
        siblings.push({ kind: "if", line: number, branches: [branch] });
        stack.push({ indent: line.indent, children: branch.children });
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
        stack.push({ indent: line.indent, children: branch.children });
        return;
      }
      default:
        return;
    }
  });

  const known = new Set(blocks.map((b) => b.name.toLowerCase()));
  for (const owner of blocks.slice()) {
    // Number the steps of each screen in reading order.
    const collect = (nodes: Node[]) =>
      nodes.forEach((node) => {
        if (node.kind === "step") owner.steps.push(node);
        collect(childrenOf(node));
      });
    collect(owner.children);
    owner.steps.forEach((step, i) =>
      Object.assign(step, { number: i + 1, total: owner.steps.length }),
    );

    // Resolve step targets; screens linked to but never written become dashed "ghosts".
    const visit = (nodes: Node[], current: number | null) =>
      nodes.forEach((node) => {
        if (node.kind === "go" || node.kind === "loop") {
          const step = stepTarget(node.to, current, owner.steps.length);
          if (typeof step === "string") issues.push({ line: node.line, message: step });
          else if (step != null) {
            if (step < 1 || step > owner.steps.length) {
              const message = owner.steps.length
                ? `There is no step ${step} here (this screen has ${owner.steps.length})`
                : "This screen has no steps yet. Add 'Step: …' lines";
              issues.push({ line: node.line, message });
            } else node.step = step;
          } else if (!known.has(node.to.toLowerCase())) {
            known.add(node.to.toLowerCase());
            blocks.push({ name: node.to, kind: "ghost", line: node.line, children: [], steps: [] });
          }
        }
        if (node.kind === "text") {
          node.text = node.text.replace(/\n+$/, "");
          if (!node.text) {
            issues.push({
              line: node.line,
              message: "Write the words after the colon, or on indented lines below",
            });
          }
        }
        if (node.kind === "choose" && !node.children.length) {
          issues.push({
            line: node.line,
            message: "Add the options on the lines below, indented, like 'Datakaffe: weigh first'",
          });
        }
        visit(childrenOf(node), node.kind === "step" ? node.number : current);
      });
    visit(owner.children, null);
  }
  issues.sort((a, b) => a.line - b.line);
  for (const issue of issues) lines[issue.line - 1].error ??= issue.message;

  return { title, blocks, issues, lines };
}

// --------------------------------------------------------------- mermaid

const WRAP = 26;

function cleanLabel(input: string): string {
  return input
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "and")
    .replace(/[<>[\]{}|#"`]/g, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

// Greedy word wrap. Words much longer than a line (URLs, IDs) are split.
export function wrapText(text: string, width = WRAP): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(" ")) {
    while (word.length > width + 6) {
      if (line) lines.push(line);
      lines.push(word.slice(0, width));
      line = "";
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Safe Mermaid label text, wrapped with explicit line breaks. Breaking lines
 * ourselves keeps boxes sized right in every browser instead of relying on
 * Mermaid's own measuring, which clips text when the font loads late.
 */
export function mermaidLabel(input: string, width = WRAP): string {
  // Each written line wraps on its own; an empty line stays as a gap.
  const lines = input.split("\n").map((line) => {
    const clean = cleanLabel(line);
    return clean ? wrapText(clean, width).join("<br>") : "";
  });
  return lines.some(Boolean) ? lines.join("<br>") : " ";
}

const COLORS = {
  go: "#e4a04a",
  if: "#e7c27a",
  on: "#d99bc4",
  button: "#7fc4c9",
  loop: "#9db7d4",
  step: "#8fbf9f",
  component: "#b3a6e0",
  muted: "#a39888",
};

const CLASS_DEFS = [
  "classDef screen fill:#211e17,stroke:#e4a04a,color:#f4efe6,stroke-width:1.5px",
  "classDef start fill:#e4a04a,stroke:#c4842e,color:#1a1208,stroke-width:1.5px",
  "classDef modal fill:#1d1820,stroke:#d99bc4,color:#f4efe6,stroke-width:1.5px,stroke-dasharray:6 3",
  "classDef component fill:#1b1a22,stroke:#b3a6e0,color:#f4efe6,stroke-width:1.5px",
  "classDef ghost fill:#14130f,stroke:#a39888,color:#d9d0c2,stroke-dasharray:5 4,stroke-width:1.5px",
  "classDef show fill:#1c1a15,stroke:#5a5244,color:#f4efe6",
  "classDef ref fill:#1b1a22,stroke:#b3a6e0,color:#f4efe6",
  "classDef caption fill:transparent,stroke:transparent,color:#d9d0c2",
  "classDef media fill:#1c1a15,stroke:#5a5244,color:#d9d0c2",
  "classDef text fill:transparent,stroke:transparent,color:#d9d0c2,font-style:italic",
  "classDef headline fill:transparent,stroke:transparent,color:#f4efe6,font-weight:bold,font-size:18px",
  "classDef button fill:#16292a,stroke:#7fc4c9,color:#f4efe6,stroke-width:1.5px",
  "classDef option fill:#1c1a15,stroke:#7fc4c9,color:#f4efe6",
  "classDef step fill:#17211c,stroke:#8fbf9f,color:#f4efe6,stroke-width:1.5px",
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
  node(id: string, shape: string, cls: string, depth = 1) {
    this.line(`${id}${shape}`, depth);
    this.tag(id, cls);
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
    const head = title ? ["---", `title: ${cleanLabel(title).replace(/:/g, " ")}`, "---"] : [];
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

const MEDIA_SIZES: Record<MediaSize, [number, number]> = {
  wide: [176, 110],
  square: [120, 120],
  tall: [110, 160],
};

/** A wireframe-style picture: mountains and a sun, or a play button for video. */
function placeholder(width: number, height: number, video: boolean): string {
  const art = video
    ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 5}" fill="#4a4335"/>` +
      `<path d="M${width / 2 - 6} ${height / 2 - 10}v20l16-10z" fill="#e4a04a"/>`
    : `<circle cx="${width * 0.74}" cy="${height * 0.3}" r="${Math.min(width, height) / 10}" fill="#e4a04a"/>` +
      `<path d="M0 ${height}L${width * 0.34} ${height * 0.45}L${width * 0.56} ${height * 0.8}L${width * 0.69} ${height * 0.6}L${width} ${height}Z" fill="#4a4335"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#26231c"/>${art}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const q = (text: string) => `"${mermaidLabel(text)}"`;

function findBlock(blocks: Block[], name: string) {
  const key = name.toLowerCase();
  return blocks.find((b) => b.name.toLowerCase() === key);
}

// Anything that leads somewhere else: a go to or a loop, at any depth.
const hasMoves = (nodes: Node[]): boolean =>
  nodes.some((n) => n.kind === "go" || n.kind === "loop" || hasMoves(childrenOf(n)));

/** A step that says nothing about moving on simply continues to the next step. */
const flowsOn = (owner: Block, step: StepNode): StepNode | undefined =>
  hasMoves(step.children) ? undefined : owner.steps[step.number];

const stepLabel = (step: StepNode) =>
  `Step ${step.number} of ${step.total}<br>${mermaidLabel(step.title)}`;

function blockShape(block: Block) {
  if (block.kind === "component") return `[[${q(block.name)}]]`;
  if (block.kind === "modal") return `(${q(block.name)})`;
  return `[${q(block.name)}]`;
}

/** Screen-level map: one box per screen (and per step), arrows for every way to move on. */
function flowMermaid(journey: Journey): string {
  const { blocks } = journey;
  const w = new Writer();
  w.out.push("flowchart TD");
  const ids = new Map<Block, string>();
  const stepIds = new Map<StepNode, string>();
  const startBlock = blocks.find((b) => b.kind === "screen");
  const used = new Set<Block>();

  // Components only appear when they carry interactions of their own.
  for (const block of blocks) {
    if (block.kind === "component" && !hasMoves(block.children)) continue;
    const id = w.id("n");
    ids.set(block, id);
    w.node(id, blockShape(block), block === startBlock ? "start" : block.kind);
    block.steps.forEach((step, i) => {
      const stepId = w.id("p");
      stepIds.set(step, stepId);
      w.node(stepId, `("${stepLabel(step)}")`, "step");
      if (i === 0) w.edge(id, stepId, { style: "-.->", color: COLORS.step });
    });
  }

  const targetOf = (owner: Block, node: { to: string; step?: number }) =>
    node.step ? stepIds.get(owner.steps[node.step - 1]) : ids.get(findBlock(blocks, node.to)!);

  const seen = new Set<string>();
  const walk = (owner: Block, fromId: string, nodes: Node[], labels: string[], color: string) => {
    for (const node of nodes) {
      if (node.kind === "go") {
        const toId = targetOf(owner, node);
        const key = `${fromId}>${toId}>${labels.join()}`;
        if (!toId || seen.has(key)) continue;
        seen.add(key);
        w.edge(fromId, toId, { label: labels.join(" · ") || undefined, color });
      } else if (node.kind === "loop") {
        const toId = targetOf(owner, node);
        if (!toId) continue;
        const loopId = w.id("l");
        w.node(loopId, `([${q(`Loop ${node.action}`)}])`, "loop");
        w.edge(fromId, loopId, { label: labels.join(" · ") || undefined, color: COLORS.loop });
        w.edge(loopId, toId, { label: `until ${node.until}`, color: COLORS.step });
      } else if (node.kind === "if") {
        node.branches.forEach((b) =>
          walk(owner, fromId, b.children, [...labels, b.cond ?? "else"], COLORS.if),
        );
      } else if (node.kind === "on") {
        walk(owner, fromId, node.children, [...labels, node.event], COLORS.on);
      } else if (node.kind === "button") {
        walk(owner, fromId, node.children, [...labels, `tap ${node.label}`], COLORS.button);
      } else if (node.kind === "option") {
        walk(owner, fromId, node.children, [...labels, `choose ${node.label}`], COLORS.button);
      } else if (node.kind === "choose") {
        walk(owner, fromId, node.children, labels, color);
      } else if (node.kind === "step") {
        const next = flowsOn(owner, node);
        if (next) w.edge(stepIds.get(node)!, stepIds.get(next)!, { color: COLORS.step });
        walk(owner, stepIds.get(node)!, node.children, [], COLORS.go);
      } else if (node.kind === "show") {
        const ref = findBlock(blocks, node.name);
        if (ref?.kind === "component" && ids.has(ref) && !used.has(ref)) {
          used.add(ref);
          w.edge(fromId, ids.get(ref)!, { style: "-.->", color: COLORS.component });
        }
        walk(owner, fromId, node.children, labels, color);
      } else if (node.kind === "each") {
        walk(owner, fromId, node.children, labels, color);
      }
    }
  };
  for (const block of blocks) {
    const id = ids.get(block);
    if (id) walk(block, id, block.children, [], COLORS.go);
  }
  return w.finish(journey.title);
}

/** Storyboard: each screen drawn as a box holding its layout, with interactions wired between them. */
function storyMermaid(journey: Journey): string {
  const { blocks } = journey;
  const w = new Writer();
  w.out.push("flowchart TD");
  const heads = new Map<Block, string>();
  const stepHeads = new Map<StepNode, string>();
  const startBlock = blocks.find((b) => b.kind === "screen");

  // Every screen and step gets a header node so arrows always land on a real
  // node, which keeps Mermaid's cluster layout stable.
  for (const block of blocks) {
    heads.set(block, w.id("h"));
    for (const step of block.steps) stepHeads.set(step, w.id("p"));
  }

  const targetOf = (owner: Block, node: { to: string; step?: number }) => {
    if (node.step) return stepHeads.get(owner.steps[node.step - 1]);
    const to = findBlock(blocks, node.to);
    return to && to !== owner ? heads.get(to) : undefined;
  };

  // Moves out of an interaction become arrows; anything else is drawn below it.
  const interaction = (
    owner: Block,
    id: string,
    children: Node[],
    color: string,
    depth: number,
  ) => {
    for (const child of children) {
      if (child.kind !== "go") continue;
      const to = targetOf(owner, child);
      if (to) w.later.push([id, to, { color }]);
    }
    const inner = emit(
      owner,
      children.filter((child) => child.kind !== "go"),
      depth,
    );
    chain(inner, depth);
    if (inner[0]) w.edge(id, inner[0], { color });
  };

  // A subgraph holding `children`, optionally led by a header node [id, shape, class].
  const group = (
    owner: Block,
    id: string,
    label: string,
    children: Node[],
    depth: number,
    head?: [string, string, string],
  ) => {
    // Mermaid leaves room for one line of subgraph title only, so a title that
    // wraps is drawn as a caption node inside the group instead.
    if (!head && mermaidLabel(label).includes("<br>")) {
      head = [w.id("k"), `[${q(label)}]`, "caption"];
      label = " ";
    }
    w.line(`subgraph ${id}[${q(label)}]`, depth);
    w.line("direction TB", depth + 1);
    if (head) w.node(head[0], head[1], head[2], depth + 1);
    chain([...(head ? [head[0]] : []), ...emit(owner, children, depth + 1)], depth + 1);
    w.line("end", depth);
  };

  // Returns the ids of nodes emitted at this level (first one is the entry).
  const emit = (owner: Block, nodes: Node[], depth: number): string[] => {
    const ids: string[] = [];
    for (const node of nodes) {
      if (
        node.kind === "media" ||
        (node.kind === "show" &&
          !node.children.length &&
          MEDIA_NAME.test(node.name) &&
          findBlock(blocks, node.name)?.kind !== "component")
      ) {
        const id = w.id("m");
        const media =
          node.kind === "media"
            ? node
            : {
                caption: node.name,
                video: /videos?$/i.test(node.name),
                size: defaultSize(node.name),
              };
        const [width, height] = MEDIA_SIZES[media.size];
        const url = placeholder(width, height, media.video);
        const label = media.caption ? q(media.caption) : '" "';
        w.node(
          id,
          `@{ img: "${url}", label: ${label}, pos: "b", w: ${width}, h: ${height}, constraint: "on" }`,
          "media",
          depth,
        );
        ids.push(id);
      } else if (node.kind === "show") {
        const ref = findBlock(blocks, node.name);
        const id = w.id("s");
        if (node.children.length) {
          group(owner, id, node.name, node.children, depth);
          w.tag(id, "show");
        } else {
          w.node(id, `[${q(node.name)}]`, ref?.kind === "component" ? "ref" : "show", depth);
          if (ref?.kind === "component" && ref !== owner)
            w.later.push([id, heads.get(ref)!, { style: "-.->", color: COLORS.component }]);
        }
        ids.push(id);
      } else if (node.kind === "text") {
        const id = w.id("x");
        w.node(
          id,
          `[${q(node.heading ? node.text : `“${node.text}”`)}]`,
          node.heading ? "headline" : "text",
          depth,
        );
        ids.push(id);
      } else if (node.kind === "choose") {
        const id = w.id("q");
        group(
          owner,
          id,
          node.prompt ? `Choose ${node.prompt}` : "Choose one",
          node.children,
          depth,
        );
        w.line(`style ${id} fill:#132021,stroke:${COLORS.button}`, depth);
        ids.push(id);
      } else if (node.kind === "option") {
        const id = w.id("r");
        const text = node.text ? `<br>${mermaidLabel(node.text)}` : "";
        w.node(id, `["${mermaidLabel(`○ ${node.label}`)}${text}"]`, "option", depth);
        ids.push(id);
        interaction(owner, id, node.children, COLORS.button, depth);
      } else if (node.kind === "button") {
        const id = w.id("u");
        w.node(id, `(${q(node.label)})`, "button", depth);
        ids.push(id);
        interaction(owner, id, node.children, COLORS.button, depth);
      } else if (node.kind === "step") {
        const id = w.id("g");
        const head: [string, string, string] = [
          stepHeads.get(node)!,
          `[${q(node.title)}]`,
          "headline",
        ];
        group(owner, id, `Step ${node.number} of ${node.total}`, node.children, depth, head);
        const next = flowsOn(owner, node);
        if (next) w.later.push([head[0], stepHeads.get(next)!, { color: COLORS.step }]);
        w.line(`style ${id} fill:#141c17,stroke:${COLORS.step}`, depth);
        ids.push(id);
      } else if (node.kind === "each") {
        const id = w.id("e");
        if (node.children.length) {
          group(owner, id, `For each ${node.item}`, node.children, depth);
          w.line(`style ${id} stroke-dasharray:5 4`, depth);
        } else {
          w.node(id, `@{ shape: procs, label: ${q(`For each ${node.item}`)} }`, "show", depth);
        }
        ids.push(id);
      } else if (node.kind === "if") {
        const id = w.id("c");
        w.node(id, `{${q(`${node.branches[0].cond ?? ""}?`)}}`, "cond", depth);
        ids.push(id);
        node.branches.forEach((branch, i) => {
          const label = i === 0 ? "yes" : branch.cond ? `else if ${branch.cond}` : "else";
          const inner = emit(owner, branch.children, depth);
          chain(inner, depth);
          if (inner[0]) w.edge(id, inner[0], { label, color: COLORS.if });
        });
      } else if (node.kind === "on") {
        const id = w.id("o");
        w.node(id, `([${q(`when ${node.event}`)}])`, "on", depth);
        ids.push(id);
        interaction(owner, id, node.children, COLORS.on, depth);
      } else if (node.kind === "go") {
        const id = w.id("t");
        w.node(id, `([${q(`go to ${node.to}`)}])`, "go", depth);
        const to = targetOf(owner, node);
        if (to) w.later.push([id, to, { color: COLORS.go }]);
        ids.push(id);
      } else {
        const id = w.id("l");
        w.node(id, `([${q(`Loop ${node.action} until ${node.until}`)}])`, "loop", depth);
        const to = targetOf(owner, node);
        if (to) w.later.push([id, to, { color: COLORS.step }]);
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
    const head = heads.get(block)!;
    const cls = block === startBlock ? "start" : block.kind;
    if (!block.children.length) {
      w.node(head, blockShape(block), cls);
      continue;
    }
    const id = w.id("b");
    group(block, id, " ", block.children, 1, [head, blockShape(block), cls]);
    const stroke =
      block.kind === "component"
        ? COLORS.component
        : block.kind === "modal"
          ? `${COLORS.on},stroke-dasharray:6 3`
          : "#342f26";
    w.line(`style ${id} fill:#13120e,stroke:${stroke}`);
  }
  return w.finish(journey.title);
}

export function toMermaid(journey: Journey, view: ViewKind): string {
  if (!journey.blocks.length) return "";
  return view === "flow" ? flowMermaid(journey) : storyMermaid(journey);
}
