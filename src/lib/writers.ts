/**
 * Write-side helpers for bureau-mcp (Phase 2).
 *
 * Safety contract:
 *   - All file paths are anchored to BUREAU_ROOT via assertWithinRoot()
 *   - Only Markdown files (.md) are written
 *   - Append-only: existing lines are never deleted, only added or status-flipped
 *   - File creation only happens through createIfMissing() with a minimal header
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { assertWithinRoot } from "./fs.js";
import { todayStringLocal } from "./parsers.js";
import type { BureauSchema } from "./types.js";

const MARKDOWN_EXT = ".md";

export type AppendKind = "inbox" | "decisions" | "learnings";

export interface AddTodoOptions {
  date?: string;
  priority?: string;
  due?: string;
}

export interface WriteResult {
  /** Bureau-root-relative path to the file that was touched */
  path: string;
  /** Whether the file was newly created */
  created: boolean;
}

export interface CompleteTodoResult extends WriteResult {
  /** Whether a matching open TODO was found and flipped */
  matched: boolean;
  /** 1-indexed line number of the flipped TODO (if matched) */
  line: number | null;
}

// ─── public API ────────────────────────────────────────────────

/**
 * Append a new TODO line to the daily todos file of the given department.
 * Creates the file (with a minimal header) if it doesn't yet exist.
 */
export async function addTodo(
  schema: BureauSchema,
  department: string,
  text: string,
  options: AddTodoOptions = {},
): Promise<WriteResult> {
  assertDepartmentExists(schema, department);
  assertNonEmpty(text, "todo text");
  const date = options.date ?? todayStringLocal();
  assertDateFormat(date);

  const filePath = resolveTodoFilePath(schema, department, date);
  const header = `# ${date} TODO\n\n`;
  const { created } = await createIfMissing(schema.root, filePath, header);

  const line = renderTodoLine(text, options.priority, options.due);
  await appendLine(schema.root, filePath, line);
  return {
    path: relative(schema.root, filePath),
    created,
  };
}

/**
 * Find the first open TODO whose text contains `textMatch` (case-insensitive)
 * and flip its checkbox from `[ ]` to `[x]`. No-op (matched: false) if no
 * open TODO matches.
 */
export async function completeTodo(
  schema: BureauSchema,
  department: string,
  textMatch: string,
  date: string = todayStringLocal(),
): Promise<CompleteTodoResult> {
  assertDepartmentExists(schema, department);
  assertNonEmpty(textMatch, "textMatch");
  assertDateFormat(date);

  const filePath = resolveTodoFilePath(schema, department, date);
  const exists = await fileExists(filePath);
  if (!exists) {
    return {
      path: relative(schema.root, filePath),
      created: false,
      matched: false,
      line: null,
    };
  }

  const safePath = assertWithinRoot(schema.root, filePath);
  const original = await readFile(safePath, "utf-8");
  const lines = original.split("\n");
  const needle = textMatch.toLowerCase();
  let flippedLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*-\s*\[ \]/.test(line)) continue;
    if (!line.toLowerCase().includes(needle)) continue;
    lines[i] = line.replace(/^(\s*-\s*)\[ \]/, "$1[x]");
    flippedLine = i + 1;
    break;
  }

  if (flippedLine !== null) {
    await writeFile(safePath, lines.join("\n"), "utf-8");
  }
  return {
    path: relative(schema.root, filePath),
    created: false,
    matched: flippedLine !== null,
    line: flippedLine,
  };
}

/**
 * Append free-form content to today's inbox / decisions / learnings file for
 * the given department. Adds a horizontal rule + HH:mm timestamp section so
 * multiple entries on the same day remain traceable.
 */
export async function appendToToday(
  schema: BureauSchema,
  department: string,
  kind: AppendKind,
  content: string,
  date: string = todayStringLocal(),
): Promise<WriteResult> {
  assertDepartmentExists(schema, department);
  assertNonEmpty(content, "content");
  assertDateFormat(date);

  const filePath = resolveAppendTargetPath(schema, department, kind, date);
  const header = renderAppendHeader(kind, date);
  const { created } = await createIfMissing(schema.root, filePath, header);

  const section = renderAppendSection(content);
  await appendLine(schema.root, filePath, section);
  return {
    path: relative(schema.root, filePath),
    created,
  };
}

// ─── path resolution ──────────────────────────────────────────

function resolveTodoFilePath(
  schema: BureauSchema,
  department: string,
  date: string,
): string {
  return join(schema.root, department, "todos", `${date}.md`);
}

function resolveAppendTargetPath(
  schema: BureauSchema,
  department: string,
  kind: AppendKind,
  date: string,
): string {
  switch (kind) {
    case "inbox":
      return join(schema.root, department, "inbox", `${date}.md`);
    case "decisions":
      return join(
        schema.root,
        department,
        "notes",
        `${date}-decisions.md`,
      );
    case "learnings":
      return join(
        schema.root,
        department,
        "notes",
        `${date}-learnings.md`,
      );
  }
}

// ─── filesystem primitives ────────────────────────────────────

async function createIfMissing(
  root: string,
  filePath: string,
  header: string,
): Promise<{ created: boolean }> {
  const safe = assertWithinRoot(root, filePath);
  assertMarkdownExt(safe);
  const present = await fileExists(safe);
  if (present) return { created: false };
  await mkdir(dirname(safe), { recursive: true });
  await writeFile(safe, header, "utf-8");
  return { created: true };
}

async function appendLine(
  root: string,
  filePath: string,
  text: string,
): Promise<void> {
  const safe = assertWithinRoot(root, filePath);
  assertMarkdownExt(safe);
  const existing = await readFile(safe, "utf-8");
  const sep = existing.endsWith("\n") ? "" : "\n";
  await writeFile(safe, existing + sep + text + "\n", "utf-8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ─── line / section renderers ─────────────────────────────────

function renderTodoLine(
  text: string,
  priority?: string,
  due?: string,
): string {
  const parts = [`- [ ] ${text.trim()}`];
  if (priority) parts.push(`優先度: ${priority.trim()}`);
  if (due) parts.push(`期限: ${due.trim()}`);
  return parts.join(" | ");
}

function renderAppendHeader(kind: AppendKind, date: string): string {
  switch (kind) {
    case "inbox":
      return `# ${date} Inbox\n\n`;
    case "decisions":
      return `# ${date} 意思決定ログ\n\n`;
    case "learnings":
      return `# ${date} 学び・気づき\n\n`;
  }
}

function renderAppendSection(content: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `\n---\n\n## ${hh}:${mm}\n\n${content.trim()}\n`;
}

// ─── argument guards ──────────────────────────────────────────

function assertDepartmentExists(
  schema: BureauSchema,
  department: string,
): void {
  if (!schema.departments.some((d) => d.folder === department)) {
    throw new Error(
      `Unknown department: ${department}. Available: ${schema.departments
        .map((d) => d.folder)
        .join(", ")}`,
    );
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertDateFormat(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`date must be YYYY-MM-DD, got: ${date}`);
  }
}

function assertMarkdownExt(path: string): void {
  if (!path.toLowerCase().endsWith(MARKDOWN_EXT)) {
    throw new Error(`Only Markdown files can be written: ${path}`);
  }
}
