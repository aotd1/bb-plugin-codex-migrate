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
): Promise<AttachmentResult> {
  const fromRollout = await catalog.imageDataUrls(sourceId);
  let embeddedByPath: Map<string, string> | null = null;
  let imageIndex = 0;
  let uploaded = 0;
  const unresolved: string[] = [];
  for (const event of history.events) {
    if (event.type !== "client/turn/requested") continue;
    const data = JSON.parse(event.data) as { input?: Record<string, unknown>[] };
    if (!Array.isArray(data.input)) continue;
    for (const part of data.input) {
      const type = part.type;
      if (type !== "localImage" && type !== "localFile" && type !== "image") continue;
      const isImage = type !== "localFile";
      const candidate = type === "image" ? part.url : part.path;
      if (typeof candidate !== "string") continue;
      const rolloutImage = isImage ? fromRollout[imageIndex++] : undefined;
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
        if (type === "image" && /^https?:\/\//u.test(candidate)) continue;
        unresolved.push(`${sourceId}: ${type} ${candidate}`);
        continue;
      }
      const maxBytes = (isImage ? 10 : 25) * 1024 * 1024;
      if (bytes.byteLength > maxBytes) {
        unresolved.push(`${sourceId}: ${type} exceeds ${maxBytes} bytes`);
        continue;
      }
      try {
        const result = await bb.sdk.projects.attachments.upload({
          projectId, clientFile: bytes, filename,
          ...(mimeType ? { mimeType } : {}),
        });
        part.type = isImage ? "localImage" : "localFile";
        part.path = result.path;
        delete part.url;
        uploaded++;
      } catch (cause) {
        unresolved.push(`${sourceId}: ${type} upload failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    event.data = JSON.stringify(data);
  }
  return { uploaded, unresolved };
}
