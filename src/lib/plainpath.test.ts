import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, classifyLine, insertSnippet, parse, toMermaid, type Node } from "./plainpath.ts";

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
