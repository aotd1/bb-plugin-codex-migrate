import { randomBytes } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SourceThread } from "./source.js";

export type ImportBatch = Parameters<BbPluginApi["sdk"]["threads"]["experimental_importHistory"]>[0];
export type HistoryTurn = NonNullable<ImportBatch["turns"]>[number];
export type HistoryItem = HistoryTurn["items"][number]["item"];
export interface PendingAttachment { type: "localImage" | "localFile" | "image"; candidate: string }
export interface History {
  turns: HistoryTurn[];
  pendingAttachments: { entry: HistoryTurn["items"][number]; parts: PendingAttachment[]; key: string }[];
  unsupported: string[];
  userMessages: number;
  assistantMessages: number;
  images: number;
}
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}
const record = (x: unknown): Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const list = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const str = (x: unknown): string => typeof x === "string" ? x : "";
function terminal(x: unknown): "completed" | "failed" | "interrupted" {
  if (x === undefined || x === null) return "completed";
  if (x === "completed" || x === "failed" || x === "interrupted") return x;
  throw new Error(`Nonterminal status: ${String(x)}`);
}
function time(x: unknown, fallback: number): number {
  const value = typeof x === "number" ? Math.floor(x * 1000) : fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error("Invalid source timestamp");
  return value;
}
export function convertHistory(raw: unknown, meta: SourceThread): History {
  const source = z.object({ id: z.string(), turns: z.array(z.object({ id: z.string(), startedAt: z.number().nullable().optional(), completedAt: z.number().nullable().optional(), status: z.string().optional(), items: z.array(z.record(z.string(), z.unknown())).optional() }).passthrough()).optional() }).passthrough().parse(raw);
  if (source.id !== meta.id) throw new Error(`Codex thread identity mismatch for ${meta.id}`);
  const history: History = { turns: [], pendingAttachments: [], unsupported: [], userMessages: 0, assistantMessages: 0, images: 0 };
  const ids = new Set<string>();
  for (const [turnIndex, turn] of (source.turns ?? []).entries()) {
    if (ids.has(turn.id)) throw new Error(`Duplicate source turn ID: ${turn.id}`);
    ids.add(turn.id);
    let state: HistoryTurn["status"];
    try { state = terminal(turn.status); } catch { history.unsupported.push(`${turn.id}: unfinished turn; later turns deferred to preserve append order`); break; }
    const start = time(turn.startedAt, meta.createdAtMs + turnIndex);
    const end = time(turn.completedAt, start);
    if (end < start) throw new Error(`Turn ${turn.id} completion precedes start`);
    const converted: HistoryTurn = { id: `turn:${turn.id}`, order: turnIndex, createdAt: start, completedAt: end, status: state, items: [] };
    const pendingStart = history.pendingAttachments.length;
    let finalized = true;
    for (const [index, rawItem] of (turn.items ?? []).entries()) {
      const kind = str(rawItem.type);
      const label = `${turn.id}/${str(rawItem.id) || index}`;
      let item: HistoryItem | undefined;
      let pending: PendingAttachment[] = [];
      try {
        if (kind === "userMessage") {
          const texts: string[] = [];
          for (const part of list(rawItem.content).map(record)) {
            if (part.type === "text") texts.push(str(part.text));
            else if (part.type === "localImage" || part.type === "localFile" || part.type === "image") {
              const candidate = str(part.type === "image" ? part.url : part.path);
              if (!candidate) throw new Error("Attachment lacks path/URL");
              pending.push({ type: part.type, candidate });
            } else history.unsupported.push(`${label}: user content ${str(part.type) || "unknown"}`);
          }
          item = { type: "user", text: texts.join("") };
          if (!item.text && !pending.length) { history.unsupported.push(`${label}: empty/unsupported user input`); continue; }
        } else if (kind === "agentMessage" || kind === "plan") item = { type: kind === "plan" ? "plan" : "assistant", text: str(rawItem.text) };
        else if (kind === "reasoning") {
          const strings = (x: unknown) => list(x).map(value => { if (typeof value !== "string") throw new Error("Non-string reasoning"); return value; });
          item = { type: "reasoning", summary: strings(rawItem.summary), content: strings(rawItem.content) };
        } else if (kind === "mcpToolCall" || kind === "functionCallOutput") {
          if (rawItem.arguments != null && (typeof rawItem.arguments !== "object" || Array.isArray(rawItem.arguments))) throw new Error("Tool arguments must be a JSON object");
          if (kind === "mcpToolCall" && !str(rawItem.tool)) throw new Error("Tool name is missing");
          item = { type: "tool", name: str(rawItem.tool ?? rawItem.name) || "functionCallOutput", server: str(rawItem.server ?? rawItem.namespace) || "codex", status: terminal(rawItem.status), ...(rawItem.arguments == null ? {} : { arguments: record(rawItem.arguments) as Extract<HistoryItem, { type: "tool" }>["arguments"] }), ...(rawItem.result === undefined && rawItem.output === undefined ? {} : { result: (rawItem.result ?? rawItem.output ?? null) as Extract<HistoryItem, { type: "tool" }>["result"] }), ...(rawItem.error == null ? {} : { error: typeof rawItem.error === "string" ? rawItem.error : JSON.stringify(rawItem.error) }) };
        } else if (kind === "commandExecution") item = { type: "command", command: str(rawItem.command), cwd: str(rawItem.cwd), output: str(rawItem.aggregatedOutput), status: terminal(rawItem.status), ...(rawItem.exitCode == null ? {} : { exitCode: rawItem.exitCode as number }) };
        else if (kind === "fileChange") item = { type: "fileChange", status: terminal(rawItem.status), changes: list(rawItem.changes).map(record).map(change => {
          const k = typeof change.kind === "string" ? change.kind : str(record(change.kind).type);
          if (k !== "add" && k !== "delete" && k !== "update") throw new Error(`Unknown file change kind ${k}`);
          return { path: str(change.path), kind: k, ...(typeof change.movePath === "string" ? { movePath: change.movePath } : {}), ...(typeof change.diff === "string" ? { diff: change.diff } : {}) };
        }) };
        else history.unsupported.push(`${label}: ${kind || "unknown item"}`);
      } catch (cause) {
        history.unsupported.push(`${label}: ${cause instanceof Error ? cause.message : cause}`);
        if (cause instanceof Error && cause.message.startsWith("Nonterminal status")) { finalized = false; break; }
        continue;
      }
      if (!item) continue;
      const at = time(rawItem.createdAt, start + Math.floor((end - start) * index / Math.max(1, (turn.items ?? []).length)));
      if (at < start || at > end) throw new Error(`${label}: item time outside turn`);
      const entry = { createdAt: at, item };
      converted.items.push(entry);
      if (item.type === "user") { history.userMessages++; history.images += pending.filter(p => p.type !== "localFile").length; }
      if (item.type === "assistant") history.assistantMessages++;
      if (pending.length) history.pendingAttachments.push({ entry, parts: pending, key: `${converted.id}/${index}` });
    }
    if (!finalized) {
      history.pendingAttachments.splice(pendingStart);
      history.unsupported.push(`${turn.id}: unfinished item; whole turn and later turns deferred`);
      break;
    }
    if (converted.items.length > 100) throw new Error(`Turn ${turn.id} exceeds 100 items; whole turns cannot be split`);
    if (converted.items.length) history.turns.push(converted);
  }
  return history;
}
