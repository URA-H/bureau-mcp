/**
 * Markdown parsers for bureau-mcp.
 *
 * Only as much grammar as we need:
 *  - GFM checklist items (`- [ ]` / `- [x]`)
 *  - Inline "優先度: X" and "期限: YYYY-MM-DD" hints used by secretary/
 */

import type { TodoItem } from "./types.js";

const CHECKLIST_RE = /^\s*-\s*\[(?<mark>[ xX])\]\s*(?<rest>.*)$/;
const PRIORITY_RE = /優先度:\s*([^|｜\n]+?)(?=\s*[\|｜]|\s*期限|$)/;
const DUE_RE = /期限:\s*(\d{4}-\d{2}-\d{2})/;

/**
 * Parse a daily TODO file for a department.
 *
 * @param text     file contents
 * @param department  department this file belongs to
 * @param date     date in YYYY-MM-DD
 */
export function parseTodoFile(
  text: string,
  department: string,
  date: string,
): TodoItem[] {
  const out: TodoItem[] = [];
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    const m = line.match(CHECKLIST_RE);
    if (!m || !m.groups) return;
    const mark = m.groups["mark"]!.toLowerCase();
    const rest = m.groups["rest"]!;
    const done = mark === "x";
    const priority = rest.match(PRIORITY_RE)?.[1]?.trim() ?? null;
    const due = rest.match(DUE_RE)?.[1] ?? null;
    const cleanText = stripMeta(rest);
    out.push({
      department,
      date,
      line: idx + 1,
      raw: line,
      text: cleanText,
      done,
      priority,
      due,
    });
  });
  return out;
}

/**
 * Strip the "| 優先度: X | 期限: Y" suffix so the surfacing text is clean.
 */
function stripMeta(rest: string): string {
  // Cut everything after the first "|" or "｜"
  const cut = rest.search(/[\|｜]/);
  if (cut === -1) return rest.trim();
  return rest.slice(0, cut).trim();
}

/**
 * Today's date in JST as YYYY-MM-DD.
 * We use the local Date object — the server is expected to run on the user's
 * machine in their timezone.
 */
export function todayStringLocal(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
