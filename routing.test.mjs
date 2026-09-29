import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderRoute } from "./.tmp-test/routing.js";

test("Git subfolders and worktrees route to the main repository; nested repositories remain separate", () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-codex-routing-"));
  const main = join(directory, "main");
  const subfolder = join(main, "notes");
  const nested = join(main, "module");
  const worktree = join(directory, "worktree");
  const standalone = join(directory, "standalone");
  for (const path of [main, subfolder, nested, standalone]) mkdirSync(path);
  try {
    execFileSync("git", ["-C", main, "init"], { stdio: "ignore" });
    writeFileSync(join(main, "README.md"), "test\n");
    execFileSync("git", ["-C", main, "add", "README.md"], { stdio: "ignore" });
    execFileSync("git", ["-C", main, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], { stdio: "ignore" });
    execFileSync("git", ["-C", main, "worktree", "add", "--detach", worktree], { stdio: "ignore" });
    execFileSync("git", ["-C", nested, "init"], { stdio: "ignore" });
    assert.deepEqual([folderRoute(main).kind, folderRoute(subfolder).kind, folderRoute(nested).kind, folderRoute(worktree).kind, folderRoute(standalone).kind],
      ["repository", "subfolder", "repository", "worktree", "non-git"]);
    assert.equal(folderRoute(subfolder).targetPath, realpathSync(main));
    assert.equal(folderRoute(worktree).targetPath, realpathSync(main));
    assert.equal(folderRoute(nested).targetPath, realpathSync(nested));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
