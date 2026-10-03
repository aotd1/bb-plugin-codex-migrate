import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { ApplyReport, ProjectSummary, RunStatus, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

function conflictType(reason: string): string {
  const detail = reason.replace(/^Legacy diagnostic conflict: /, "");
  if (detail.startsWith("Legacy content differs")) return "Legacy content mismatch";
  if (detail.startsWith("Legacy item count differs") || detail.startsWith("Legacy supported item count differs")) return "Legacy item count mismatch";
  if (detail.startsWith("Legacy has additional events")) return "Unmapped legacy events";
  if (detail.startsWith("Legacy source item identity differs")) return "Legacy item identity mismatch";
  if (detail.startsWith("Invalid legacy tool")) return "Invalid legacy tool data";
  if (detail.startsWith("Ambiguous Codex session:")) return "Ambiguous Codex session";
  return detail.replace(/ at sequence \d+.*$/, "").replace(/ in source turn .*$/, "");
}

function CodexMigrationPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [gitInitRoots, setGitInitRoots] = useState<string[]>([]);
  const [selectedThreads, setSelectedThreads] = useState<string[]>([]);
  const [preview, setPreview] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [current, setCurrent] = useState<RunStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    const status = await rpc.call("status", null);
    setCurrent(status.current);
    setReport(status.report);
  }, [rpc]);

  useRealtime("migration-progress", () => { void refreshStatus().catch(() => {}); });

  useEffect(() => {
    void refreshStatus().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    rpc.call("scan", { projects: [], all: false, includeThreads: false })
      .then((result) => {
        setProjects(result.projects);
        const roots = [...new Map(result.projects.flatMap((project) => project.rootDetails.map((root) => [root.key, root]))).values()];
        setSelectedRoots(roots.map((root) => root.key));
        setGitInitRoots(roots.filter((root) => root.kind === "non-git").map((root) => root.key));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc, refreshStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshStatus().catch(() => {}); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const allRoots = [...new Set(projects?.flatMap((project) => project.rootDetails.map((root) => root.key)) ?? [])];
  const allSelected = allRoots.length > 0 && allRoots.every((key) => selectedRoots.includes(key));
  const currentFolder = current?.projectProgress.find((item) => item.sourceId === current.currentProject)?.name;
  const progressPercent = current?.total ? Math.min(100, Math.round(current.processed / current.total * 100)) : 0;
  const toggleAll = (checked: boolean) => {
    setSelectedRoots(checked ? allRoots : []);
    setPreview(null);
  };

  const toggleProject = (project: ProjectSummary) => {
    const keys = project.rootDetails.map((root) => root.key);
    const select = !keys.every((key) => selectedRoots.includes(key));
    setSelectedRoots((current) => select ? [...new Set([...current, ...keys])] : current.filter((key) => !keys.includes(key)));
    setPreview(null);
  };

  const toggleRoot = (key: string) => {
    setSelectedRoots((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    setPreview(null);
  };

  const inspect = async () => {
    if (selectedRoots.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("scan", { projects: [], roots: selectedRoots, all: false, includeThreads: true });
      setPreview(result.projects);
      setSelectedThreads([...new Set(result.projects.flatMap(project => project.threads.map(thread => thread.id)))]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const uniqueRoots = [...new Map(preview?.flatMap((project) => project.rootDetails.map((root) => [root.key, root])) ?? []).values()];
  const conversationConflicts = new Map(preview?.flatMap(project => project.conflicts.map(conflict => [conflict.sourceId, conflict] as const)) ?? []);
  const unresolvedConflicts = [...new Map(preview?.flatMap((project) => project.conflicts.filter(conflict => selectedThreads.includes(conflict.sourceId)).map((conflict) => [conflict.sourceId, conflict])) ?? []).values()];
  const conflictGroups = new Map<string, string[]>();
  for (const conflict of unresolvedConflicts) {
    const type = conflictType(conflict.reason);
    conflictGroups.set(type, [...(conflictGroups.get(type) ?? []), conflict.sourceId]);
  }
  const eligibleRoots = uniqueRoots.filter((root) => root.kind !== "missing" && (root.kind !== "non-git" || gitInitRoots.includes(root.key)));
  const startImport = async () => {
    if (selectedRoots.length === 0 || preview === null || eligibleRoots.length === 0 || starting || current?.state === "running" || selectedThreads.length === 0 || unresolvedConflicts.length > 0) return;
    setStarting(true);
    setError(null);
    try {
      await rpc.call("start", { projects: [], roots: selectedRoots, gitInitRoots: gitInitRoots.filter((key) => selectedRoots.includes(key)), all: false, existingOnly: false, limit: null, threadIds: selectedThreads });
      await refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-4 md:px-5">
        <h1 className="text-xl font-semibold">Import from Codex</h1>
        <p className="mt-2 text-sm text-muted-foreground">Select folders to import. Shared folders stay selected together in every Codex project.</p>
        <p className="mt-1 text-xs text-muted-foreground">Imported chat titles are shortened to 80 characters by default. Change the mode or length in Settings → Installed plugins → Codex Migrate.</p>
        {report && current?.state !== "running" && report.projects.some(project => project.partiallyImported.length || project.failed.length) && <section className="mt-4 rounded-lg border border-border p-3 text-sm" aria-label="Migration limitations">
          <p className="font-medium">Saved history may be partial. Review these conversations before continuing.</p>
          {report.projects.flatMap(project => [...project.partiallyImported, ...project.failed].map(entry => <p key={`${project.sourceId}:${entry.sourceId}`} className="mt-2 break-words text-xs">{entry.sourceId} · {entry.message}</p>))}
        </section>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {projects === null ? <p className="mt-6 text-sm text-muted-foreground">Scanning Codex projects…</p> : (
          <div className="mt-5 divide-y divide-border rounded-lg border border-border bg-card">
            <div className="px-4 py-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleAll(checked === true)} aria-label="Select all projects" />
                <span>All</span>
              </label>
              {current && <div className="ml-7 mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                <p><span className="font-medium">{current.state === "running" ? "Importing" : `Last import: ${current.state}`}</span> · {current.processed} / {current.total} chats · {current.imported} added this run{current.partiallyImported > 0 ? ` · ${current.partiallyImported} partially imported` : ""} · {current.existing} already in BB · {current.skippedEmpty} empty skipped{current.failed > 0 ? ` · ${current.failed} failed` : ""}</p>
                {current.total > 0 && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} /></div>}
                {currentFolder && <p className="mt-1 truncate">Current folder: {currentFolder}</p>}
                {current.currentThread && <p className="truncate">Current chat: {current.currentThread}</p>}
                {current.error && <p className="text-destructive">{current.error}</p>}
                <p>Updated {new Date(current.updatedAt).toLocaleString()}</p>
              </div>}
            </div>
            {projects.map((project) => {
              const keys = project.rootDetails.map((root) => root.key);
              const checked = keys.length > 0 && keys.every((key) => selectedRoots.includes(key));
              const partial = !checked && keys.some((key) => selectedRoots.includes(key));
              return <div key={project.sourceId} className="px-4 py-3">
                <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                  <Checkbox checked={partial ? "indeterminate" : checked} onCheckedChange={() => toggleProject(project)} aria-label={`Select ${project.name}`} className="data-[state=indeterminate]:border-foreground data-[state=indeterminate]:bg-foreground data-[state=indeterminate]:text-background" />
                  <span>{project.name}</span>
                </label>
                <div className="ml-7 mt-2 space-y-2">
                  {project.rootDetails.map((root) => {
                    const status = current?.projectProgress.find((item) => item.sourceId === root.key) ?? current?.projectProgress.find((item) => item.sourceId === project.sourceId);
                    return <label key={root.path} className="flex cursor-pointer items-start gap-2 text-xs">
                      <Checkbox checked={selectedRoots.includes(root.key)} onCheckedChange={() => toggleRoot(root.key)} aria-label={`Select folder ${root.path}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all">{root.path}</span>
                        <span className="block text-muted-foreground">{root.kind === "subfolder" ? "Git subfolder" : root.kind === "worktree" ? "Git worktree" : root.kind === "non-git" ? "No Git repository" : root.kind === "missing" ? "Missing folder" : "Git repository"} → {root.targetProjectName}{root.linkedProjects.length > 1 ? ` · shared with ${root.linkedProjects.filter((name) => name !== project.name).join(", ")}` : ""}</span>
                        {status && <span className="mt-1 block text-muted-foreground" role="status">
                          <span className="font-medium">{status.state}</span> · {status.processed} / {status.total} chats · {status.imported} added this run{status.partiallyImported > 0 ? ` · ${status.partiallyImported} partially imported` : ""} · {status.existing} already in BB · {status.skippedEmpty} empty skipped{status.failed > 0 ? ` · ${status.failed} failed` : ""}
                          {status.total > 0 && <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, Math.round(status.processed / status.total * 100))}%` }} /></span>}
                          {status.currentThread && <span className="block truncate">Current: {status.currentThread}</span>}
                          {status.error && <span className="block text-destructive">{status.error}</span>}
                          <span className="block">Updated {new Date(status.updatedAt).toLocaleString()}</span>
                        </span>}
                      </span>
                    </label>;
                  })}
                </div>
              </div>;
            })}
          </div>
        )}
        <Button className="mt-4" onClick={inspect} disabled={selectedRoots.length === 0 || busy}>
          {busy ? "Scanning…" : "Preview selected projects"}
        </Button>
        {preview && <div className="mt-6 space-y-4">
          {uniqueRoots.map((root) => <section key={root.key} className="rounded-lg border border-border bg-card p-4">
            <h2 className="break-all font-medium">{root.path}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{root.candidates} chats · {root.linkedProjects.join(", ")} → {root.targetProjectId ? `BB: ${root.targetProjectName}` : `new BB project: ${root.targetProjectName}`}</p>
            {root.kind === "subfolder" && <p className="mt-2 text-sm">This folder is inside a Git repository. Its chats will go to the parent repository project at {root.targetPath}.</p>}
            {root.kind === "worktree" && <p className="mt-2 text-sm">Worktree chats will go to the main repository project at {root.targetPath}.</p>}
            {root.kind === "missing" && <p className="mt-2 text-sm text-destructive">The folder is missing. Deselect it before importing.</p>}
            {root.kind === "non-git" && <div className="mt-3 rounded border border-border p-3 text-sm">
              <p>Warning: this folder is not in a Git repository. Import will run git init here without creating a commit or remote.</p>
              <label className="mt-2 flex items-center gap-2">
                <Checkbox checked={gitInitRoots.includes(root.key)} onCheckedChange={(checked) => setGitInitRoots((current) => checked === true ? [...new Set([...current, root.key])] : current.filter((key) => key !== root.key))} aria-label={`Initialize Git in ${root.path}`} />
                <span>Initialize Git and import this folder</span>
              </label>
              {!gitInitRoots.includes(root.key) && <p className="mt-2 text-muted-foreground">This folder will be skipped.</p>}
            </div>}
          </section>)}
          <section className="rounded-lg border border-border p-4">
            <h2 className="font-medium">Select conversations</h2>
            {unresolvedConflicts.length > 0 && <Button className="mt-2" onClick={() => setSelectedThreads(current => current.filter(id => !conversationConflicts.has(id)))}>Exclude conflicted conversations</Button>}
            {[...new Map(preview.flatMap(project => project.threads.map(thread => [thread.id, thread] as const))).values()].map(thread => <div key={thread.id} className="mt-3">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={selectedThreads.includes(thread.id)} onCheckedChange={checked => setSelectedThreads(current => checked === true ? [...current, thread.id] : current.filter(id => id !== thread.id))} />{thread.title || thread.id}{thread.archived ? " · archived" : ""}{thread.alreadyImported ? " · existing in BB" : ""}</label>
              {conversationConflicts.has(thread.id) && <p className="mt-1 text-xs text-destructive">{conversationConflicts.get(thread.id)!.reason}</p>}
              {thread.limitations.map((limitation, index) => <p key={index} className="mt-1 text-xs text-muted-foreground">{limitation}</p>)}
            </div>)}
          </section>
          {unresolvedConflicts.length > 0 && <div className="rounded border border-destructive p-3 text-xs text-destructive">
            <p>{unresolvedConflicts.length} selected conversations have conflicts; review their reasons or exclude them.</p>
            {unresolvedConflicts.slice(0, 10).map((conflict) => <p key={conflict.sourceId} className="mt-1 truncate">{conflict.title || conflict.sourceId} · {conflict.reason} · {conflict.cwd}{conflict.importedProjectId ? ` · BB ${conflict.importedProjectId}` : ""}</p>)}
          </div>}
          <div className="rounded-lg border border-border bg-card p-4">
            {unresolvedConflicts.length > 0 && <p className="mt-2 text-sm text-destructive">{unresolvedConflicts.length} conflicts still block import.</p>}
            {conflictGroups.size > 0 && <div className="mt-3 space-y-2" aria-label="Deselect conversations by conflict type">
              <p className="text-sm">Deselect conversations by conflict type:</p>
              {[...conflictGroups].map(([type, ids]) => <Button key={type} variant="outline" className="mr-2 h-auto whitespace-normal text-left" onClick={() => {
                const excluded = new Set(ids);
                setSelectedThreads(current => current.filter(id => !excluded.has(id)));
              }}>Deselect: {type} ({ids.length})</Button>)}
            </div>}
            <p className="text-sm">{eligibleRoots.length} unique folders will be imported. History is saved in atomic batches. A failed run can leave committed history; rerun the same selection to continue.</p>
            <Button className="mt-3" onClick={startImport} disabled={starting || current?.state === "running" || eligibleRoots.length === 0 || uniqueRoots.some((root) => root.kind === "missing") || unresolvedConflicts.length > 0 || selectedThreads.length === 0}>{current?.state === "running" ? `Importing ${current.processed} / ${current.total}…` : starting ? "Starting import…" : "Import selected folders"}</Button>
            {current?.state === "running" && <p className="mt-2 text-xs text-muted-foreground" role="status">{current.imported} added this run{current.partiallyImported > 0 ? ` · ${current.partiallyImported} partially imported` : ""} · {current.existing} already in BB · {current.skippedEmpty} empty skipped{current.failed > 0 ? ` · ${current.failed} failed` : ""}{currentFolder ? ` · ${currentFolder}` : ""} · Updated {new Date(current.updatedAt).toLocaleTimeString()}</p>}
          </div>
        </div>}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "codex-migrate", title: "Codex migration", path: "codex-migrate", component: CodexMigrationPage, icon: "codex-migrate/import" });
});
