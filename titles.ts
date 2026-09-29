export type TitleMode = "original" | "truncate";

export function formatTitle(raw: string, mode: TitleMode, maxLength: number): string {
  const title = raw.trim();
  if (mode === "original") return title;
  const compact = title.replace(/\s+/gu, " ");
  const characters = Array.from(compact);
  if (characters.length <= maxLength) return compact;
  const prefix = characters.slice(0, maxLength - 1).join("");
  const lastSpace = prefix.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxLength * 0.6) ? prefix.slice(0, lastSpace) : prefix;
  return `${cut.trimEnd()}…`;
}
