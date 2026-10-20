import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDoc,
  currentDocId,
  deleteDoc,
  docTitle,
  listDocs,
  listVersions,
  openLibrary,
  readDoc,
  saveDoc,
  setCurrentDoc,
} from "./library.ts";

test("titles come from Title:, else the first screen", () => {
  assert.equal(docTitle("Title: Shop\nScreen: Home"), "Shop");
  assert.equal(docTitle("screen: home\n  Show X"), "home");
  assert.equal(docTitle(""), "Untitled");
});

test("the library creates, autosaves, switches and deletes documents", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const first = openLibrary("Title: Starter\nScreen: A\n");
  assert.equal(readDoc(first.id), "Title: Starter\nScreen: A\n");
  assert.equal(currentDocId(), first.id);

  const second = createDoc("Title: Second\nScreen: B\n");
  assert.equal(currentDocId(), second.id);
  t.mock.timers.tick(1000);
  saveDoc(second.id, "Title: Second edit\nScreen: B\n");
  assert.deepEqual(
    listDocs().map((doc) => doc.title),
    ["Second edit", "Starter"],
    "newest first",
  );

  setCurrentDoc(first.id);
  assert.equal(openLibrary("ignored").id, first.id, "reopens the last document used");

  deleteDoc(second.id);
  assert.deepEqual(
    listDocs().map((doc) => doc.title),
    ["Starter"],
  );
  assert.equal(readDoc(second.id), null);
  assert.deepEqual(listVersions(second.id), []);
});

test("history keeps one version per editing session", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  const doc = createDoc("v1");
  saveDoc(doc.id, "v1");
  t.mock.timers.tick(10_000);
  saveDoc(doc.id, "v2");
  t.mock.timers.tick(10_000);
  saveDoc(doc.id, "v3");
  assert.deepEqual(
    listVersions(doc.id).map((v) => v.source),
    ["v3", "v1"],
    "quick edits fold into one version; the starting text stays",
  );
  t.mock.timers.tick(5 * 60_000);
  saveDoc(doc.id, "v4");
  t.mock.timers.tick(10_000);
  saveDoc(doc.id, "v5");
  assert.deepEqual(
    listVersions(doc.id).map((v) => v.source),
    ["v5", "v3", "v1"],
    "a pause starts a new version; the newest folds again",
  );
  // Typing on and on still leaves a version every couple of minutes.
  for (let i = 0; i < 30; i += 1) {
    t.mock.timers.tick(10_000);
    saveDoc(doc.id, `long ${i}`);
  }
  assert.ok(listVersions(doc.id).length >= 5);
});
