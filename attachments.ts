import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { History } from "./history.js";
import type { CodexCatalog } from "./source.js";

const imageMimeByExtension: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

function decodeDataUrl(url: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(url);
  if (!match) return null;
  return { bytes: Buffer.from(match[2]!, "base64"), mimeType: match[1]! };
}

export interface AttachmentResult {
  uploaded: number;
  unresolved: string[];
}

export async function attachHistory(
  bb: BbPluginApi,
  catalog: CodexCatalog,
  projectId: string,
  sourceId: string,
  history: History,
  existingAttachments = new Map<string, {type: "localImage" | "localFile"; path: string}[]>(),
): Promise<AttachmentResult> {
  const fromRollout = await catalog.imageDataUrls(sourceId);
  let embeddedByPath: Map<string, string> | null = null;
  let imageIndex = 0;
  let uploaded = 0;
  const unresolved: string[] = [];
  for (const pending of history.pendingAttachments) {
    const item = pending.entry.item;
    if (item.type !== "user") continue;
    const attachments: NonNullable<typeof item.attachments> = [];
    for (const [partIndex, part] of pending.parts.entries()) {
      if (part.type !== "localFile") imageIndex++;
      const label = part.candidate.startsWith("data:") || part.candidate.length > 4096
        ? `attachment sha256:${createHash("sha256").update(part.candidate).digest("hex")}` : part.candidate;
      const cacheKey = `upload:${createHash("sha256").update(JSON.stringify([projectId, sourceId, pending.key, partIndex, part])).digest("hex")}`;
      const cached = await bb.storage.kv.get<{ type: "localImage" | "localFile"; path: string } | { unavailable: string }>(cacheKey);
      if (cached) {
        if ("path" in cached) attachments.push(cached);
        else { item.text += `\n[Attachment unavailable: ${label}]`; unresolved.push(cached.unavailable); }
        continue;
      }
      const unavailable = async (message: string) => {
        unresolved.push(message);
        item.text += `\n[Attachment unavailable: ${label}]`;
        // Pin the first outcome, so a retry cannot change an immutable turn.
        await bb.storage.kv.set(cacheKey, { unavailable: message });
      };
      const type = part.type;
      if (type !== "localImage" && type !== "localFile" && type !== "image") continue;
      const isImage = type !== "localFile";
      const candidate = part.candidate;
      if (typeof candidate !== "string") continue;
      const rolloutImage = isImage ? fromRollout[imageIndex - 1] : undefined;
      let bytes: Uint8Array | null = null;
      let mimeType: string | undefined;
      let filename = isImage ? `codex-image-${imageIndex}.png` : basename(candidate);
      const dataUrl = candidate.startsWith("data:") ? candidate : null;
      if (dataUrl) {
        const decoded = decodeDataUrl(dataUrl);
        if (decoded) {
          bytes = decoded.bytes;
          mimeType = decoded.mimeType;
          const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
          filename = `codex-image-${imageIndex}.${extension}`;
        }
      }
      if (bytes === null && candidate.startsWith("/")) {
        try {
          const file = await stat(candidate);
          if (file.isFile() && file.size <= (isImage ? 10 : 25) * 1024 * 1024) {
            bytes = await readFile(candidate);
            filename = basename(candidate);
            if (isImage) mimeType = imageMimeByExtension[filename.split(".").at(-1)?.toLowerCase() ?? ""];
          }
        } catch { }
      }
      if (bytes === null && isImage) {
        embeddedByPath ??= await catalog.imageDataUrlsByPath(sourceId);
        if (!embeddedByPath.has(candidate) && candidate.startsWith("/")) {
          const related = await catalog.relatedImageDataUrlsByPath(sourceId, candidate);
          for (const [path, url] of related) embeddedByPath.set(path, url);
        }
        const recovered = embeddedByPath.get(candidate) ?? rolloutImage;
        const decoded = recovered ? decodeDataUrl(recovered) : null;
        if (decoded) {
          bytes = decoded.bytes;
          mimeType = decoded.mimeType;
          const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
          filename = `codex-image-${imageIndex}.${extension}`;
        }
      }
      if (bytes === null) {
        await unavailable(`${sourceId}: ${type} ${label}`);
        continue;
      }
      const maxBytes = (isImage ? 10 : 25) * 1024 * 1024;
      if (bytes.byteLength > maxBytes) {
        await unavailable(`${sourceId}: ${type} exceeds ${maxBytes} bytes`);
        continue;
      }
      const existing = existingAttachments.get(pending.key);
      if (existing) {
        const reference = existing[partIndex];
        if (!reference || reference.type !== (isImage ? "localImage" : "localFile")) throw new Error("Legacy attachment count/type differs");
        const saved = await bb.sdk.projects.attachments.read({ projectId, path: reference.path });
        if (!Buffer.from(bytes).equals(Buffer.from(saved.bytes))) throw new Error("Legacy attachment bytes differ; adoption cannot replace ownership/content");
        await bb.storage.kv.set(cacheKey, reference);
        attachments.push(reference);
        continue;
      }
      try {
        const result = await bb.sdk.projects.attachments.upload({
          projectId, clientFile: bytes, filename,
          ...(mimeType ? { mimeType } : {}),
        });
        const attachment = { type: isImage ? "localImage" as const : "localFile" as const, path: result.path };
        await bb.storage.kv.set(cacheKey, attachment);
        attachments.push(attachment);
        uploaded++;
      } catch (cause) {
        await unavailable(`${sourceId}: ${type} upload failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (attachments.length > 32) throw new Error(`${sourceId}: user attachments exceed 32`);
    if (attachments.length) item.attachments = attachments;
  }
  return { uploaded, unresolved };
}
