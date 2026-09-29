import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

export interface FolderRoute {
  path: string;
  key: string;
  exists: boolean;
  git: boolean;
  repoRoot: string | null;
  targetPath: string | null;
  kind: "repository" | "subfolder" | "worktree" | "non-git" | "missing";
}

function git(path: string, argument: string): string | null {
  try {
    return execFileSync("git", ["-C", path, "rev-parse", argument], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function folderRoute(path: string): FolderRoute {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { path, key: path, exists: false, git: false, repoRoot: null, targetPath: null, kind: "missing" };
  }
  const key = realpathSync(path);
  const top = git(key, "--show-toplevel");
  if (!top) return { path, key, exists: true, git: false, repoRoot: null, targetPath: key, kind: "non-git" };
  const repoRoot = realpathSync(top);
  const gitDir = git(key, "--git-dir");
  const commonDir = git(key, "--git-common-dir");
  const absolute = (value: string) => realpathSync(isAbsolute(value) ? value : resolve(key, value));
  const worktree = Boolean(gitDir && commonDir && absolute(gitDir) !== absolute(commonDir));
  const mainRoot = worktree && commonDir && basename(absolute(commonDir)) === ".git"
    ? dirname(absolute(commonDir)) : repoRoot;
  return {
    path, key, exists: true, git: true, repoRoot,
    targetPath: mainRoot,
    kind: worktree ? "worktree" : key === repoRoot ? "repository" : "subfolder",
  };
}

export function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}
