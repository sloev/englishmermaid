import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLES,
  classifyLine,
  insertSnippet,
  mermaidLabel,
  parse,
  toMermaid,
  wrapText,
  type Node,
} from "./plainpath.ts";

const screen = (source: string, name: string) => parse(source).blocks.find((b) => b.name === name)!;

test("all examples parse cleanly and render both views", () => {
  for (const example of EXAMPLES) {
    const journey = parse(example.source);
    assert.deepEqual(journey.issues, [], example.id);
    assert.match(toMermaid(journey, "flow"), /^---\ntitle: .+\n---\nflowchart TD/);
    assert.match(toMermaid(journey, "story"), /subgraph/);
  }
});

test("legacy flat syntax still works", () => {
  const journey = parse("Screen: Home\nGo to List\nIf picks one go to Detail\n");
  assert.deepEqual(journey.issues, []);
  const home = journey.blocks[0];
  assert.equal(home.children.length, 2);
  assert.deepEqual(home.children[0], { kind: "go", to: "List", line: 2 });
  assert.equal(home.children[1].kind, "if");
  assert.deepEqual(
    journey.blocks.map((b) => [b.name, b.kind]),
    [
      ["Home", "screen"],
      ["List", "ghost"],
      ["Detail", "ghost"],
    ],
  );
});

test("indentation builds nested layout", () => {
  const home = screen("Screen: Home\n  Show Header\n    Show Logo, Menu\n  Show Footer\n", "Home");
  assert.equal(home.children.length, 2);
  const header = home.children[0] as Extract<Node, { kind: "show" }>;
  assert.deepEqual(
    header.children.map((n) => n.kind === "show" && n.name),
    ["Logo", "Menu"],
  );
});

test("if / else if / else chain with blocks and inline tails", () => {
  const src = `Screen: A
  If x
    Show One
  Else if y go to B
  Otherwise, show Three
`;
  const journey = parse(src);
  assert.deepEqual(journey.issues, []);
  const node = journey.blocks[0].children[0] as Extract<Node, { kind: "if" }>;
  assert.deepEqual(
    node.branches.map((b) => [b.cond, b.children.map((c) => c.kind)]),
    [
      ["x", ["show"]],
      ["y", ["go"]],
      [null, ["show"]],
    ],
  );
});

test("else must follow an if at the same indent", () => {
  const journey = parse("Screen: A\n  Show X\n  Else\n");
  assert.equal(journey.issues[0].line, 3);
  const twice = parse("Screen: A\n  If x go to B\n  Else go to C\n  Else go to D\n");
  assert.match(twice.issues[0].message, /already has an Else/);
});

test("for each and on, inline and as blocks", () => {
  const src = `Screen: List
  For each item in items show Row
  On tap Buy
    If signed in go to Pay
    Else go to Login
`;
  const [list] = parse(src).blocks;
  const each = list.children[0] as Extract<Node, { kind: "each" }>;
  assert.equal(each.item, "item in items");
  assert.equal(each.children[0].kind, "show");
  const on = list.children[1] as Extract<Node, { kind: "on" }>;
  assert.equal(on.event, "tap Buy");
  assert.equal(on.children[0].kind, "if");
});

test("flow view labels edges with the event and condition path", () => {
  const mermaid = toMermaid(parse("Screen: A\n  On tap Buy\n    If signed in go to B\n"), "flow");
  assert.match(mermaid, /-->\|"tap Buy · signed in"\|/);
});

test("components link from where they are shown", () => {
  const src = "Screen: A\n  Show Card\nComponent: Card\n  On tap go to B\n";
  const journey = parse(src);
  assert.equal(journey.blocks[1].kind, "component");
  assert.match(toMermaid(journey, "story"), /-\.->/);
  assert.match(toMermaid(journey, "flow"), /\[\["Card"\]\]/);
});

test("helpful errors", () => {
  assert.match(classifyLine("Screen Home").error!, /colon/);
  assert.match(classifyLine("goto Home").error!, /two words/);
  assert.match(classifyLine("If ").error!, /condition/);
  assert.match(classifyLine("If x go to").error!, /which screen/);
  assert.match(classifyLine("Loop forever").error!, /Loop/);
  assert.match(parse("Show X").issues[0].message, /Screen:/);
  assert.match(parse("Screen: A\nScreen: a").issues[0].message, /already defined/);
});

test("tokens cover the whole line", () => {
  for (const line of [
    "  - If cart is empty, then go to Home",
    "Loop a until b then go to C",
    "For each x in y show Z",
  ]) {
    assert.equal(
      classifyLine(line)
        .tokens.map((t) => t.text)
        .join(""),
      line,
    );
  }
});

test("labels are made safe for mermaid", () => {
  const mermaid = toMermaid(parse('Screen: A "quoted" [x] {y}\n'), "flow");
  assert.match(mermaid, /\["A quoted x y"\]/);
});

test("insertSnippet keeps the current indent", () => {
  const { next, cursor } = insertSnippet("Screen: A\n  Show X", 18, 18, "Go to ", 6);
  assert.equal(next, "Screen: A\n  Show X\n  Go to ");
  assert.equal(cursor, next.length);
});

test("buttons, text, headlines and popups", () => {
  const src = `Screen: Library
  Text: rooost.party
  On tap + on Ethiopian Sunset open Coffee Type
Popup: Coffee Type
  Headline: "Datakaffe or almindelig kaffe?"
  Button Datakaffe goes to Roasting
  Button: Almindelig kaffe
`;
  const journey = parse(src);
  assert.deepEqual(journey.issues, []);
  const [library, popup] = journey.blocks;
  assert.equal(popup.kind, "modal");
  assert.deepEqual(library.children[0], {
    kind: "text",
    text: "rooost.party",
    heading: false,
    line: 2,
  });
  const on = library.children[1] as Extract<Node, { kind: "on" }>;
  assert.equal(on.event, "tap + on Ethiopian Sunset");
  assert.deepEqual(on.children[0], { kind: "go", to: "Coffee Type", line: 3 });
  assert.deepEqual(popup.children[0], {
    kind: "text",
    text: "Datakaffe or almindelig kaffe?",
    heading: true,
    line: 5,
  });
  const button = popup.children[1] as Extract<Node, { kind: "button" }>;
  assert.equal(button.label, "Datakaffe");
  assert.deepEqual(button.children, [{ kind: "go", to: "Roasting", line: 6 }]);
  assert.deepEqual(popup.children[2], {
    kind: "button",
    label: "Almindelig kaffe",
    line: 7,
    children: [],
  });
  assert.match(toMermaid(journey, "flow"), /-->\|"tap Datakaffe"\|/);
});

test("steps are numbered and next step resolves", () => {
  const src = `Screen: Roast
  Step: Weigh beans X
    When the analyser is done you are advanced to the next step
  Step 2 - "Weigh beans Y."
    After the analysis go to step 3
  Step: Roast
`;
  const journey = parse(src);
  assert.deepEqual(journey.issues, []);
  const [roast] = journey.blocks;
  assert.deepEqual(
    roast.steps.map((s) => [s.number, s.total, s.title]),
    [
      [1, 3, "Weigh beans X"],
      [2, 3, "Weigh beans Y"],
      [3, 3, "Roast"],
    ],
  );
  const on = roast.steps[0].children[0] as Extract<Node, { kind: "on" }>;
  assert.equal(on.event, "the analyser is done");
  assert.deepEqual(on.children[0], { kind: "go", to: "the next step", line: 3, step: 2 });
  assert.equal(journey.blocks.length, 1, "step targets are not ghost screens");
  assert.match(toMermaid(journey, "flow"), /Step 1 of 3<br>Weigh beans X/);
  assert.match(toMermaid(journey, "story"), /subgraph \w+\["Step 2 of 3"\]/);
});

test("step targets are checked", () => {
  assert.match(
    parse("Screen: A\n  Step: one\n    Go to next step\n").issues[0].message,
    /no step 2/,
  );
  assert.match(parse("Screen: A\n  Go to next step\n").issues[0].message, /inside a Step/);
});

test("action words: last one wins, bare open/show stay in the sentence", () => {
  const menu = classifyLine("If menu is open show Help").stmt;
  assert.deepEqual(menu, {
    t: "if",
    cond: "menu is open",
    tail: { kind: "show", names: ["Help"] },
  });
  assert.deepEqual(classifyLine("When drawer is open").stmt, {
    t: "on",
    event: "drawer is open",
    tail: undefined,
  });
  assert.deepEqual(classifyLine("Button Show more").stmt, {
    t: "button",
    label: "Show more",
    tail: undefined,
  });
  assert.deepEqual(classifyLine("Open Settings").stmt, { t: "go", to: "Settings" });
  assert.match(classifyLine("User taps Buy").error!, /When they tap/);
});

test("long labels wrap instead of being cut", () => {
  const long = "Measure 200 g of beans X into the analysis bowl and wait for the analyser";
  const lines = wrapText(long);
  assert.equal(lines.join(" "), long);
  assert.ok(lines.every((line) => line.length <= 26));
  assert.equal(mermaidLabel(long), lines.join("<br>"));
  assert.deepEqual(wrapText("https://example.com/a/very/long/path/that/never/ends"), [
    "https://example.com/a/very",
    "/long/path/that/never/ends",
  ]);
  const mermaid = toMermaid(parse(`Title: ${long}\nScreen: ${long}\n  Text: ${long}\n`), "story");
  assert.match(mermaid, /title: Measure 200 g .* analyser\n/, "the diagram title is not wrapped");
  assert.ok(!mermaid.includes("…"));
});

test("choose: options are read in context, with optional descriptions and actions", () => {
  const src = `Screen: Start
  Choose roast flow:
    Dataoriented: this and that
    Normal: that and this, goes to Classic
    Screen: not a header here, just an option
    Show me later
      Go to Later
  Text: after the select
`;
  const journey = parse(src);
  assert.deepEqual(journey.issues, []);
  const [start] = journey.blocks;
  const choose = start.children[0] as Extract<Node, { kind: "choose" }>;
  assert.equal(choose.prompt, "roast flow");
  assert.deepEqual(
    choose.children.map(
      (o) => o.kind === "option" && [o.label, o.text, o.children.map((c) => c.kind)],
    ),
    [
      ["Dataoriented", "this and that", []],
      ["Normal", "that and this", ["go"]],
      ["Screen", "not a header here, just an option", []],
      ["Show me later", "", ["go"]],
    ],
  );
  assert.equal(start.children[1].kind, "text", "dedenting ends the options");
  assert.deepEqual(
    journey.blocks.map((b) => b.name),
    ["Start", "Classic", "Later"],
  );
  assert.equal(journey.lines[2].tokens.find((t) => t.kind === "button")?.text, "Dataoriented");
  assert.match(toMermaid(journey, "flow"), /-->\|"choose Normal"\|/);
  assert.match(toMermaid(journey, "story"), /"○ Dataoriented<br>this and that"/);
});

test("choose needs options", () => {
  assert.match(parse("Screen: A\n  Choose flavour\n").issues[0].message, /options/);
});

test("unindented options get a hint", () => {
  const journey = parse("Screen: A\nChoose roast flow:\nDataoriented: this and that\n");
  assert.match(journey.issues.find((i) => i.line === 3)!.message, /Indent the options/);
});

test("media placeholders", () => {
  assert.deepEqual(classifyLine("  Image: hero photo of the beans").stmt, {
    t: "media",
    caption: "hero photo of the beans",
    video: false,
    size: "wide",
  });
  assert.deepEqual(classifyLine("Photo of the roaster (square)").stmt, {
    t: "media",
    caption: "the roaster",
    video: false,
    size: "square",
  });
  assert.deepEqual(classifyLine("Video: how to roast (portrait)").stmt, {
    t: "media",
    caption: "how to roast",
    video: true,
    size: "tall",
  });
  assert.equal(classifyLine("Logo").stmt.t, "media");
  const journey = parse(
    "Screen: Home\n  Image: hero\n  Show Product Photo, Title\n  Video: tour\n",
  );
  assert.deepEqual(journey.issues, []);
  const story = toMermaid(journey, "story");
  assert.equal(
    story.match(/@\{ img: "data:image\/svg\+xml,/g)?.length,
    3,
    "image, photo part and video",
  );
  assert.match(story, /label: "Product Photo"/);
  assert.match(story, /\["Title"\]/, "ordinary parts stay boxes");
  assert.ok(!toMermaid(journey, "flow").includes("img:"), "flow view leaves layout out");
});

test("avatars default to square", () => {
  assert.equal((classifyLine("Avatar: Maria").stmt as { size: string }).size, "square");
  assert.match(toMermaid(parse("Screen: A\n  Show User Avatar\n"), "story"), /w: 120, h: 120/);
});
