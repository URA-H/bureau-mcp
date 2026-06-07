/**
 * Filesystem helpers for bureau-mcp.
 *
 * Conventions:
 *  - department/<subfolder>/YYYY-MM-DD.md  → daily notes / todos
 *  - department/<subfolder>/<topic>.md      → topic notes
 *  - All file ops are restricted to the bureau root for safety
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { NoteMatch } from "./types.js";

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_SNIPPET_LEN = 160;

/** Throw if `targetPath` would escape from `root` (path traversal guard). */
export function assertWithinRoot(root: string, targetPath: string): string {
  const r = resolve(root);
  const t = resolve(targetPath);
  const rel = relative(r, t);
  if (rel.startsWith("..") || rel.startsWith(sep + "..")) {
    throw new Error(
      `Path traversal blocked: ${targetPath} is outside the bureau root`,
    );
  }
  return t;
}

/** Read a file inside the bureau, with traversal protection. */
export async function readNote(root: string, relativePath: string): Promise<string> {
  const abs = assertWithinRoot(root, join(root, relativePath));
  const s = await stat(abs);
  if (!s.isFile()) throw new Error(`Not a file: ${relativePath}`);
  return readFile(abs, "utf-8");
}

/** Walk every Markdown file under root (depth-first), capped at maxFiles. */
export async function* walkMarkdown(
  root: string,
  maxFiles = DEFAULT_MAX_FILES,
): AsyncGenerator<string> {
  const stack: string[] = [root];
  let count = 0;
  while (stack.length > 0 && count < maxFiles) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        yield p;
        count++;
        if (count >= maxFiles) return;
      }
    }
  }
}

/** Simple case-insensitive grep across all markdown files under root. */
export async function searchNotes(
  root: string,
  query: string,
  options: {
    department?: string;
    maxMatches?: number;
    snippetLen?: number;
  } = {},
): Promise<NoteMatch[]> {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const maxMatches = options.maxMatches ?? 50;
  const snippetLen = options.snippetLen ?? DEFAULT_SNIPPET_LEN;
  const matches: NoteMatch[] = [];
  const scope = options.department ? join(root, options.department) : root;

  for await (const file of walkMarkdown(scope)) {
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx === -1) continue;

    // For each matching line within the file, emit one match (up to a budget)
    const rel = relative(root, file);
    const department = rel.split(sep)[0] ?? "";
    const lines = text.split("\n");
    const lowerLines = lower.split("\n");
    for (let i = 0; i < lowerLines.length; i++) {
      if (!lowerLines[i]!.includes(needle)) continue;
      matches.push({
        department,
        path: rel,
        line: i + 1,
        snippet: makeSnippet(lines[i]!, needle, snippetLen),
      });
      if (matches.length >= maxMatches) return matches;
    }
    idx = -1; // suppress unused-variable lint
  }
  return matches;
}

function makeSnippet(line: string, needleLower: string, snippetLen: number): string {
  const idx = line.toLowerCase().indexOf(needleLower);
  if (idx === -1) return line.slice(0, snippetLen);
  const half = Math.floor(snippetLen / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(line.length, idx + needleLower.length + half);
  let snippet = line.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < line.length) snippet = snippet + "…";
  return snippet;
}
