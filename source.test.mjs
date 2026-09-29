import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CodexCatalog } from "./.tmp-test/source.js";

test("recovers an attachment by its exact path from a long compacted history line", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-codex-images-"));
  const rolloutPath = join(directory, "rollout.jsonl");
  const childRolloutPath = join(directory, "child.jsonl");
  const imageUrl = "data:image/png;base64,aGVsbG8=";
  const db = new Database(join(directory, "state_5.sqlite"));
  try {
    db.exec("CREATE TABLE projects(id TEXT); CREATE TABLE project_roots(path TEXT); CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT)");
    db.prepare("INSERT INTO threads VALUES(?,?,?)").run("thread_1", rolloutPath, directory);
    db.prepare("INSERT INTO threads VALUES(?,?,?)").run("thread_2", childRolloutPath, directory);
    db.close();
    writeFileSync(childRolloutPath, "");
    writeFileSync(rolloutPath, JSON.stringify({
      type: "compacted",
      payload: {
        replacement_history: [{ role: "user", content: [
          { type: "input_text", text: '<image path="/missing/photo.png">' },
          { type: "input_image", image_url: imageUrl },
        ] }],
        guardian_history: [{ role: "assistant", content: [
          { type: "input_text", text: '<image path="/wrong/photo.png">' },
          { type: "input_image", image_url: imageUrl },
        ] }],
        padding: "x".repeat(11 * 1024 * 1024),
      },
    }) + "\n");
    const catalog = new CodexCatalog(directory);
    try {
      const images = await catalog.imageDataUrlsByPath("thread_1");
      assert.deepEqual([...images], [["/missing/photo.png", imageUrl]]);
      const related = await catalog.relatedImageDataUrlsByPath("thread_2", "/missing/photo.png");
      assert.deepEqual([...related], [["/missing/photo.png", imageUrl]]);
    } finally { catalog.close(); }
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses a complete local Codex projection when thread/read cannot answer", () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-codex-projection-"));
  const rolloutPath = join(directory, "rollout.jsonl");
  writeFileSync(rolloutPath, "{}\n");
  const state = new Database(join(directory, "state_5.sqlite"));
  const history = new Database(join(directory, "thread_history_1.sqlite"));
  try {
    state.exec("CREATE TABLE projects(id TEXT); CREATE TABLE project_roots(path TEXT); CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,created_at INTEGER)");
    state.prepare("INSERT INTO threads VALUES(?,?,?)").run("thread_1", rolloutPath, 123);
    history.exec("CREATE TABLE thread_history_projection_state(thread_id TEXT,next_rollout_byte_offset INTEGER); CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,rollout_ordinal INTEGER); CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_json TEXT,rollout_ordinal INTEGER)");
    history.prepare("INSERT INTO thread_history_projection_state VALUES(?,?)").run("thread_1", statSync(rolloutPath).size);
    history.prepare("INSERT INTO thread_turns VALUES(?,?,?,?,?,?)").run("thread_1", "turn_1", "completed", 124, 125, 1);
    history.prepare("INSERT INTO thread_items VALUES(?,?,?,?)").run("thread_1", "turn_1", JSON.stringify({ type: "userMessage", id: "item_1", content: [{ type: "text", text: "hello" }] }), 2);
    state.close();
    history.close();
    const catalog = new CodexCatalog(directory);
    try {
      assert.deepEqual(catalog.projectedThread("thread_1"), { id: "thread_1", createdAt: 123, turns: [
        { id: "turn_1", status: "completed", startedAt: 124, completedAt: 125, items: [{ type: "userMessage", id: "item_1", content: [{ type: "text", text: "hello" }] }] },
      ] });
    } finally { catalog.close(); }
  } finally {
    if (state.open) state.close();
    if (history.open) history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("skips only a verified empty placeholder without a source rollout", () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-codex-placeholder-"));
  const state = new Database(join(directory, "state_5.sqlite"));
  const history = new Database(join(directory, "thread_history_1.sqlite"));
  try {
    state.exec("CREATE TABLE projects(id TEXT); CREATE TABLE project_roots(path TEXT); CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,rollout_path TEXT,has_user_event INTEGER,tokens_used INTEGER,first_user_message TEXT,preview TEXT,created_at INTEGER,updated_at INTEGER)");
    state.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)").run("thread_1", "", join(directory, "missing.jsonl"), 0, 0, "", "", 123, 123);
    history.exec("CREATE TABLE thread_turns(thread_id TEXT); CREATE TABLE thread_items(thread_id TEXT)");
    history.close();
    const catalog = new CodexCatalog(directory);
    try {
      assert.equal(catalog.isEmptyPlaceholder("thread_1"), true);
      state.prepare("UPDATE threads SET tokens_used=1 WHERE id=?").run("thread_1");
      assert.equal(catalog.isEmptyPlaceholder("thread_1"), false);
    } finally { catalog.close(); }
  } finally {
    if (state.open) state.close();
    if (history.open) history.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
