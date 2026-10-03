import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { History, HistoryItem, HistoryTurn, ImportBatch } from "./history.js";
import { formatTitle, type TitleMode } from "./titles.js";
import type { SourceThread } from "./source.js";

type Sdk = BbPluginApi["sdk"];
type EventRow = Awaited<ReturnType<Sdk["threads"]["events"]["list"]>>[number];
type Binding = NonNullable<Awaited<ReturnType<Sdk["threads"]["experimental_findExternalThread"]>>["binding"]>;
export interface ExistingImport { threadId: string; projectId: string; archived: boolean; binding?: Binding; conflict?: string }
export const sourceIdentity = (hostId: string) => `codex-local:${hostId}`;
function stable(value: unknown): string {
  const sorted = (x: unknown): unknown => Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, sorted(v)])) : x;
  return JSON.stringify(sorted(value));
}
export const fingerprint = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const size = (batch: ImportBatch, pluginId: string) => Buffer.byteLength(JSON.stringify({ ...batch, pluginId }), "utf8");
export function batches(base: Omit<ImportBatch, "messages" | "turns">, turns: HistoryTurn[], pluginId: string): ImportBatch[] {
  const result: ImportBatch[] = [];
  let current: ImportBatch = { ...base, messages: [], turns: [] };
  let count = 0;
  for (const turn of turns) {
    if (!turn.items.length || turn.items.length > 100) throw new Error(`Invalid whole turn size: ${turn.id}`);
    const single = { ...base, messages: [], turns: [turn] };
    if (size(single, pluginId) > 1024 * 1024) throw new Error(`Whole turn ${turn.id} exceeds 1 MiB; cannot split it`);
    if (count + turn.items.length > 500 || size({ ...current, turns: [...current.turns!, turn] }, pluginId) > 1024 * 1024) {
      result.push(current); current = { ...base, messages: [], turns: [] }; count = 0;
    }
    current.turns!.push(turn); count += turn.items.length;
  }
  if (current.turns!.length || !result.length) result.push(current);
  return result;
}
// Check semantic constraints before the first API mutation, including later batches.
export function validateHistory(turns: HistoryTurn[]): void {
  const ids = new Set<string>(); let order = -1;
  const strings = (x: unknown): void => {
    if (typeof x === "string" && x.length > 128_000) throw new Error("History text exceeds 128000 characters");
    if (Array.isArray(x)) x.forEach(strings);
  };
  const json = (value: unknown, seen = new Set<object>()): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || seen.has(value)) throw new Error("Tool content must be finite, acyclic JSON");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Tool content must be plain JSON");
    seen.add(value); for (const child of Object.values(value)) json(child,seen); seen.delete(value);
  };
  for (const turn of turns) {
    if (!turn.id || turn.id.length > 512 || ids.has(turn.id) || !Number.isSafeInteger(turn.order) || turn.order <= order) throw new Error("History IDs/orders must be unique and increasing");
    ids.add(turn.id); order = turn.order;
    for (const t of [turn.createdAt, turn.completedAt, ...turn.items.map(i => i.createdAt)]) if (!Number.isSafeInteger(t) || t < 0 || t > 8_640_000_000_000_000) throw new Error("Invalid history time");
    if (turn.completedAt < turn.createdAt) throw new Error("Invalid turn bounds");
    for (const { item, createdAt } of turn.items) {
      if (createdAt < turn.createdAt || createdAt > turn.completedAt) throw new Error("Item outside turn bounds");
      if (item.type === "user" || item.type === "assistant" || item.type === "plan") strings(item.text);
      if (item.type === "user" && (!item.text && !item.attachments?.length || (item.attachments?.length ?? 0) > 32)) throw new Error("Invalid user content/attachment count");
      if (item.type === "reasoning") { strings(item.summary); strings(item.content); if (item.summary.length > 100 || item.content.length > 100) throw new Error("Reasoning exceeds 100 entries"); }
      if (item.type === "tool") { if (!item.name || item.name.length > 512 || (item.server !== undefined && (!item.server || item.server.length > 512))) throw new Error("Invalid tool identity"); strings(item.error); if (item.arguments !== undefined) json(item.arguments); if (item.result !== undefined) json(item.result); }
      if (item.type === "command") { strings(item.command); strings(item.output); if (item.cwd.length > 4096 || item.exitCode !== undefined && !Number.isInteger(item.exitCode)) throw new Error("Invalid command metadata"); }
      if (item.type === "fileChange") { if (item.changes.length > 100) throw new Error("Too many file changes"); for (const c of item.changes) { if (!c.path || c.path.length > 4096 || (c.movePath?.length ?? 0) > 4096) throw new Error("Invalid file path"); strings(c.diff); } }
    }
  }
}
function runtimeRows(rows: EventRow[], turnId: string): EventRow[] {
  const accepted = rows.filter(r => r.type === "turn/input/accepted" && r.scope.kind === "turn" && r.scope.turnId === turnId);
  const requests = accepted.map(r => r.type === "turn/input/accepted" ? r.data.clientRequestId : null);
  return rows.filter(r => (r.type === "client/turn/requested" && requests.includes(r.data.requestId)) || (r.scope.kind === "turn" && r.scope.turnId === turnId && r.type === "item/completed" && r.data.item.type !== "userMessage"));
}
// Acknowledge a verified supported subset by source turn identity. Other legacy
// events remain untouched; omissions/deferred turns are reported by the converter.
function legacyRows(history: History, events: EventRow[]): EventRow[] {
  const flat = events.filter(r => r.type === "client/turn/requested" || r.type === "item/completed");
  // Invalid old canonical tools must never be hidden by an omission/deferred turn.
  for (const row of flat) if (row.type === "item/completed" && row.data.item.type === "toolCall" && Object.hasOwn(row.data.item,"error") && row.data.item.error === null) throw new Error("Invalid legacy tool error:null; public import cannot repair it");
  const entries = history.turns.flatMap(t => t.items);
  if (flat.length === entries.length) return flat;
  const selected: EventRow[] = [];
  const covered = new Set<number>();
  for (const layout of history.legacyLayout) {
    const rows = runtimeRows(events,layout.turnId);
    if (rows.length !== layout.itemIds.length) throw new Error(`Legacy item count differs in source turn ${layout.turnId}`);
    for (const [i,row] of rows.entries()) {
      if (covered.has(row.seq)) throw new Error("Legacy sequence maps to several source turns");
      covered.add(row.seq);
      if (row.type === "item/completed" && layout.itemIds[i] !== null && row.data.item.id !== layout.itemIds[i]) throw new Error(`Legacy source item identity differs at sequence ${row.seq}`);
    }
    if (!layout.deferred) selected.push(...layout.supportedIndices.map(i => rows[i]!));
  }
  if (flat.some(row => !covered.has(row.seq))) throw new Error("Legacy has additional events outside the source snapshot");
  if (selected.length !== entries.length) throw new Error("Legacy supported item count differs from source snapshot");
  return selected;
}
function semantic(row: EventRow): HistoryItem | null {
  if (row.type === "client/turn/requested") {
    const input = row.data.input;
    if (!input) return null;
    if (input.some(p => p.type !== "text" && p.type !== "localImage" && p.type !== "localFile")) throw new Error("Unsupported legacy user content");
    return { type: "user", text: input.filter(p => p.type === "text").map(p => p.text).join(""), ...(input.some(p => p.type === "localImage" || p.type === "localFile") ? { attachments: input.filter(p => p.type === "localImage" || p.type === "localFile").map(p => ({ type: p.type as "localImage" | "localFile", path: (p as {path:string}).path })) } : {}) };
  }
  if (row.type !== "item/completed") return null;
  const item = row.data.item;
  switch (item.type) {
    case "userMessage": return semantic({ ...row, type: "client/turn/requested", data: { input: item.content } } as EventRow);
    case "agentMessage": return { type: "assistant", text: item.text };
    case "plan": return { type: "plan", text: item.text };
    case "reasoning": return { type: "reasoning", summary: item.summary, content: item.content };
    case "toolCall":
      if (Object.hasOwn(item, "error") && item.error === null) throw new Error("Invalid legacy tool error:null; public import cannot repair it");
      return { type: "tool", name: item.tool, ...(item.server === undefined ? {} : {server:item.server}), ...(item.arguments === undefined ? {} : {arguments:item.arguments}), status: item.status as "completed", ...(item.result === undefined ? {} : {result:item.result}), ...(item.error === undefined ? {} : {error:item.error}) };
    case "commandExecution": return { type: "command", command: item.command, cwd: item.cwd, output: item.aggregatedOutput ?? "", status: item.status as "completed", ...(item.exitCode == null ? {} : {exitCode:item.exitCode}) };
    case "fileChange": return { type: "fileChange", changes: item.changes, status: item.status as "completed" };
    default: throw new Error(`Unsupported legacy item ${item.type}`);
  }
}
export class ExternalHistoryStore {
  private index = new Map<string, ExistingImport[]>();
  constructor(private bb: BbPluginApi, readonly hostId: string) {}
  private key(projectId: string, conversationId: string) { return { projectId, sourceId: sourceIdentity(this.hostId), conversationId }; }
  async events(threadId: string, identitiesOnly = false): Promise<EventRow[]> {
    const rows: EventRow[] = []; let after = 0;
    for (;;) {
      const page = await this.bb.sdk.threads.events.list({ threadId, afterSeq: String(after), order: "asc", limit: "100", ...(identitiesOnly ? { types: ["thread/identity"] as ["thread/identity"] } : {}) });
      if (!page.length) return rows;
      const next = page.at(-1)!.seq;
      if (next <= after) throw new Error("Public event cursor did not advance");
      rows.push(...page); after = next;
      if (page.length < 100) return rows;
    }
  }
  async load(sourceIds: string[], projectIds: string[]): Promise<void> {
    this.index.clear();
    sourceIds = [...new Set(sourceIds)];
    if (sourceIds.length === 0) return;
    const add = (id: string, existing: ExistingImport) => {
      const matches = this.index.get(id) ?? [];
      const prior = matches.find(m => m.threadId === existing.threadId);
      if (prior) Object.assign(prior, existing); else matches.push(existing);
      this.index.set(id, matches);
    };
    for (const projectId of projectIds) for (const id of sourceIds) {
      const {binding} = await this.bb.sdk.threads.experimental_findExternalThread(this.key(projectId,id));
      if (binding) add(id, { threadId: binding.threadId, projectId, archived: binding.archived, binding });
    }
    // Legacy candidates are enumerated through public list/events, including archives.
    for (const archived of [false, true]) {
      for (let offset = 0;; offset += 100) {
        const page = await this.bb.sdk.threads.list({ archived, includeHidden: true, limit: 100, offset });
        for (const thread of page) {
          if (thread.providerId !== "codex" || thread.deletedAt !== null || thread.environmentHostId !== null && thread.environmentHostId !== this.hostId) continue;
          const identities = (await this.events(thread.id, true)).filter(row => row.type === "thread/identity");
          const current = identities.at(-1)?.data.providerThreadId;
          for (const id of new Set(identities.map(row => row.data.providerThreadId))) {
            if (typeof id !== "string" || !sourceIds.includes(id)) continue;
            add(id, { threadId: thread.id, projectId: thread.projectId, archived: thread.archivedAt !== null,
              ...(id !== current ? {conflict:"Legacy provider session identity changed; choose an explicit conversation policy"} : thread.status && !["idle", "error"].includes(thread.status) || thread.queuedWork && thread.queuedWork !== "none" || thread.hasPendingInteraction ? {conflict:"Existing Codex thread has active, queued or pending BB work; retry after it settles"} : {}) });
          }
        }
        if (page.length < 100) break;
      }
    }
  }
  existing(id: string): ExistingImport | null {
    const matches = this.index.get(id) ?? [];
    if (matches.length > 1) return { ...matches[0]!, conflict: `Ambiguous Codex session: ${matches.map(m => m.threadId).join(", ")}` };
    return matches[0] ?? null;
  }
  async diagnoseLegacy(source: SourceThread, history: History): Promise<void> {
    const existing = this.existing(source.id);
    if (!existing || existing.binding) return;
    if (existing.conflict) throw new Error(existing.conflict);
    const rows = legacyRows(history,await this.events(existing.threadId));
    const entries = history.turns.flatMap(turn => turn.items);
    if (rows.length !== entries.length) throw new Error("Legacy item count differs from the source snapshot");
    for (const [i, entry] of entries.entries()) {
      const actual = semantic(rows[i]!);
      const pending = history.pendingAttachments.find(p => p.entry === entry);
      if (pending && entry.item.type === "user" && actual?.type === "user") {
        if (actual.text !== entry.item.text || (actual.attachments?.length ?? 0) !== pending.parts.length || pending.parts.some((p,index) => actual.attachments?.[index]?.type !== (p.type === "localFile" ? "localFile" : "localImage"))) throw new Error(`Legacy user text/attachment shape differs at sequence ${rows[i]!.seq}`);
      } else if (stable(actual) !== stable(entry.item)) throw new Error(`Legacy content differs at sequence ${rows[i]!.seq}`);
    }
  }
  async attachmentReferences(source: SourceThread, history: History): Promise<Map<string, NonNullable<Extract<HistoryItem, {type:"user"}>["attachments"]>>> {
    const result = new Map<string, NonNullable<Extract<HistoryItem, {type:"user"}>["attachments"]>>();
    const existing = this.existing(source.id);
    if (!existing) return result;
    if (existing.conflict) throw new Error(existing.conflict);
    const events = await this.events(existing.threadId);
    const match = (entries: HistoryTurn["items"], rows: EventRow[]) => {
      if (rows.length !== entries.length) throw new Error("Adoption/acknowledgement conflict: item count differs");
      for (const [i, entry] of entries.entries()) {
        if (entry.item.type !== "user") continue;
        const item = semantic(rows[i]!);
        if (item?.type !== "user" || item.text !== entry.item.text) throw new Error("Existing user content differs");
        const pending = history.pendingAttachments.find(p => p.entry === entry);
        if (pending) result.set(pending.key, item.attachments ?? []);
      }
    };
    if (!existing.binding) match(history.turns.flatMap(turn => turn.items), legacyRows(history,events));
    else if (existing.binding.mode === "interactive") for (const turn of history.turns.filter(t => t.order > (existing.binding!.lastOrder ?? -1))) {
      const rows = runtimeRows(events,turn.id.slice("turn:".length));
      if (rows.length) match(turn.items,rows);
    }
    return result;
  }
  async importThread(args: {projectId: string; projectRoot: string; source: SourceThread; history: History; titleMode: TitleMode; titleMaxLength: number; onBatch?: (inserted: number, skipped: number) => Promise<void>}): Promise<{threadId:string; inserted:number; skipped:number; limitations:string[]}> {
    const {source, history, projectId} = args;
    const existing = this.existing(source.id);
    if (existing?.conflict) throw new Error(existing.conflict);
    if (existing && existing.projectId !== projectId) throw new Error("Legacy/bound conversation belongs to another project");
    const {binding} = await this.bb.sdk.threads.experimental_findExternalThread(this.key(projectId,source.id));
    if (binding && (binding.sessionId !== source.id || binding.providerId !== "codex" || binding.generation !== 0)) throw new Error("Source identity/generation changed; explicit release/reset policy required");
    const adopted = existing && !binding;
    const turns = structuredClone(history.turns);
    if (adopted || binding?.archived) {
      const rows = legacyRows(history,await this.events(existing?.threadId ?? binding!.threadId));
      const flat = turns.flatMap(t => t.items);
      if (flat.length !== rows.length) throw new Error("Legacy adoption conflict: item count differs; no history will be rewritten");
      for (const [i, entry] of flat.entries()) {
        if (stable(semantic(rows[i]!)) !== stable(entry.item)) throw new Error(`Legacy adoption conflict at sequence ${rows[i]!.seq}: source content differs`);
        entry.existingSequence = rows[i]!.seq; entry.existingCreatedAt = rows[i]!.createdAt;
      }
    } else if (binding?.mode === "interactive") {
      // BB replies already have canonical events. Acknowledge only an exact suffix
      // under the same source turn ID, never guess by searching repeated text.
      const rows = await this.events(binding.threadId);
      for (const turn of turns.filter(t => t.order > (binding.lastOrder ?? -1))) {
        const sourceTurn = turn.id.slice("turn:".length);
        const candidates = runtimeRows(rows,sourceTurn);
        if (!candidates.length) continue;
        if (candidates.length !== turn.items.length) throw new Error(`BB-owned turn ${sourceTurn} cannot be reconciled unambiguously`);
        for (const [i, entry] of turn.items.entries()) {
          if (stable(semantic(candidates[i]!)) !== stable(entry.item)) throw new Error(`BB-owned turn ${sourceTurn} content conflict`);
          entry.existingSequence = candidates[i]!.seq; entry.existingCreatedAt = candidates[i]!.createdAt;
        }
      }
    }
    validateHistory(turns);
    const base = { ...this.key(projectId, source.id), providerId: "codex", sessionId: source.id, generation: 0, attention: "preserve" as const,
      initialTitle: formatTitle(source.title, args.titleMode, args.titleMaxLength).slice(0,512) || "Codex conversation", initialSourceTitle: source.title.slice(0,4096) || "Codex conversation",
      initialCreatedAt: source.createdAtMs, initialUpdatedAt: Math.max(source.createdAtMs, source.updatedAtMs), activityAt: Math.max(source.createdAtMs, source.updatedAtMs),
      initialPluginMetadata: { sourceSessionId: source.id, sourceCwd: source.cwd },
      ...((adopted || binding?.archived) ? { adoptThreadId: existing?.threadId ?? binding!.threadId } : {}), ...(binding ? {threadId:binding.threadId} : {}) };
    const requests = batches(base, turns, this.bb.pluginId);
    for (const turn of turns) {
      const key = `fingerprint:${fingerprint([base.sourceId,projectId,source.id,turn.id])}`;
      const digest = fingerprint({ ...turn, items: turn.items.map(({item,createdAt}) => ({item,createdAt})) });
      const prior = await this.bb.storage.kv.get<string>(key);
      if (prior && prior !== digest) throw new Error(`Immutable source turn changed: ${turn.id}; explicit source reset policy required`);
      await this.bb.storage.kv.set(key,digest);
    }
    let threadId = binding?.threadId; let inserted = 0; let skipped = 0;
    try {
      for (const request of requests) {
        const result = await this.bb.sdk.threads.experimental_importHistory(request);
        threadId = result.threadId; inserted += result.inserted; skipped += result.skipped;
        await args.onBatch?.(inserted,skipped);
      }
    } catch (cause) { throw new Error(`History import interrupted after ${inserted} confirmed entries; rerun the same selection to replay committed batches safely. ${cause instanceof Error ? cause.message : cause}`); }
    if (!threadId) throw new Error("Missing imported thread ID");
    const limitations = [...history.unsupported];
    if (source.title.length > 4096) limitations.push("Source title exceeds the 4096-character search title limit");
    if (args.titleMode === "original" && source.title.length > 512) limitations.push("Displayed title exceeds the 512-character API limit; full searchable title retained up to 4096 characters");
    if (source.archived && !existing?.archived) {
      // Archive passive history; no hidden runtime/session claim is retained.
      const latest = await this.bb.sdk.threads.experimental_findExternalThread(this.key(projectId,source.id));
      if (latest.binding?.mode !== "passive") limitations.push("Existing interactive thread kept unarchived; release/archive explicitly");
      else {
        try { await this.bb.sdk.threads.archive({threadId}); }
        catch (cause) { limitations.push(`History saved; archive pending: ${cause instanceof Error ? cause.message : cause}`); }
      }
    } else if (!source.archived && !existing?.archived) {
      try { await this.bind(threadId,source.id,projectId,source.cwd,args.projectRoot); }
      catch (cause) { limitations.push(`History saved; Codex continuation pending: ${cause instanceof Error ? cause.message : cause}`); }
    }
    if (existing?.archived && !source.archived) limitations.push("Existing archive preserved; unarchive explicitly before binding");
    return { threadId, inserted, skipped, limitations };
  }
  async bind(threadId:string, sessionId:string, projectId:string, cwd:string, projectRoot:string): Promise<void> {
    const {binding} = await this.bb.sdk.threads.experimental_findExternalThread(this.key(projectId,sessionId));
    if (!binding || binding.threadId !== threadId) throw new Error("External binding changed");
    if (binding.mode === "interactive") return; // Keep adopted/existing environment and handle.
    const paths = cwd.includes("/.codex/worktrees/") ? [cwd,projectRoot] : [projectRoot,cwd];
    let environmentId: string | undefined;
    for (const path of [...new Set(paths)]) {
      const matches: string[] = [];
      for (let offset=0;;offset+=100) {
        const page = await this.bb.sdk.environments.list({projectId,hostId:this.hostId,path,status:"ready",limit:100,offset});
        matches.push(...page.filter(e => (e.lifecycle.phase === "active" || e.lifecycle.phase === "retiring") && e.lifecycle.teardown === null).map(e => e.id));
        if (page.length<100) break;
      }
      if (matches.length > 1) throw new Error(`Several ready environments match ${path}; choose one explicitly`);
      if (matches[0]) {environmentId=matches[0];break;}
    }
    if (!environmentId) {
      if (typeof this.bb.sdk.environments.experimental_ensureProjectCheckout !== "function") throw new Error("Ready checkout requires runtime Plugin SDK >=0.6.11; update BB before continuation");
      const project = await this.bb.sdk.projects.get({projectId});
      const sources = project.sources.filter(source => source.hostId === this.hostId && source.type === "local_path");
      if (sources.length !== 1) throw new Error("Expected exactly one local project source on the source host; choose an environment explicitly");
      const source = sources[0]!;
      if (source.path !== projectRoot) throw new Error("Project source path changed; preview routing again before continuation");
      const ready = await this.bb.sdk.environments.experimental_ensureProjectCheckout({projectId,hostId:this.hostId,expectedSourceId:source.id,expectedSourcePath:source.path});
      environmentId = ready.environment.id;
    }
    await this.bb.sdk.threads.experimental_bindExternalSession({threadId, expectedGeneration:binding.generation,expectedSessionId:binding.sessionId,providerId:"codex",providerThreadId:sessionId,environmentId});
  }
}
