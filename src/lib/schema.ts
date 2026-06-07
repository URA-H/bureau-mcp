/**
 * Bureau schema builder.
 *
 * Parses the root-level CLAUDE.md (and falls back to filesystem inspection)
 * to derive the bureau's department list and naming conventions.
 *
 * The CLAUDE.md is treated as the source of truth:
 *  - A markdown table whose first column header is one of
 *    {"部署", "department", "Department"} describes departments
 *  - A fenced code block containing folder names provides subfolder layout
 *
 * Both parsers fall back gracefully if the format differs.
 */

import { readdir, stat, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  BureauSchema,
  Department,
  FileConventions,
} from "./types.js";

const DEFAULT_CONVENTIONS: FileConventions = {
  daily: "YYYY-MM-DD.md",
  topic: "kebab-case.md",
  decisions: "YYYY-MM-DD-decisions.md",
  learnings: "YYYY-MM-DD-learnings.md",
};

const IGNORED_TOP_LEVEL_NAMES = new Set([
  ".DS_Store",
  ".git",
  "CLAUDE.md",
  "AGENTS.md",
  "README.md",
  "node_modules",
]);

/**
 * Build the bureau schema from a root directory.
 *
 * @param rootPath absolute path to the bureau root, e.g. ".../.company"
 */
export async function buildSchema(rootPath: string): Promise<BureauSchema> {
  const root = resolve(rootPath);
  await assertDirectory(root);

  const claudeMd = await tryReadClaudeMd(root);

  const fromDoc = claudeMd ? parseDepartmentsFromMarkdown(claudeMd) : [];
  const fromFs = await discoverDepartmentsFromFs(root);

  // Merge: doc declarations win for role, fs presence is authoritative for existence
  const merged = mergeDepartments(fromDoc, fromFs);

  return {
    root,
    departments: merged,
    fileConventions: DEFAULT_CONVENTIONS,
  };
}

// ─── filesystem helpers ────────────────────────────────────────

async function assertDirectory(path: string): Promise<void> {
  const s = await stat(path).catch(() => null);
  if (!s || !s.isDirectory()) {
    throw new Error(
      `BUREAU_ROOT does not point to a directory: ${path}`,
    );
  }
}

async function tryReadClaudeMd(root: string): Promise<string | null> {
  const path = join(root, "CLAUDE.md");
  try {
    await access(path);
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function discoverDepartmentsFromFs(root: string): Promise<Department[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const departments: Department[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (IGNORED_TOP_LEVEL_NAMES.has(entry.name)) continue;

    const folder = entry.name;
    const subfolders = await listSubfolders(join(root, folder));
    departments.push({ folder, role: null, subfolders });
  }
  return departments;
}

async function listSubfolders(deptPath: string): Promise<string[]> {
  const entries = await readdir(deptPath, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

// ─── markdown parsers ──────────────────────────────────────────

/**
 * Parse the "departments" table out of CLAUDE.md.
 *
 * Recognises a markdown table whose first column header is in
 * {"部署", "department", "Department"}. The second column is treated as
 * "folder", and any further column is concatenated as "role".
 */
export function parseDepartmentsFromMarkdown(text: string): Department[] {
  const lines = text.split("\n");
  const results: Department[] = [];
  let inTable = false;
  let headerCols: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const cells = splitTableRow(line);

    if (cells === null) {
      inTable = false;
      headerCols = [];
      continue;
    }

    // Detect header
    if (!inTable) {
      const first = cells[0]?.trim() ?? "";
      if (["部署", "department", "Department"].includes(first)) {
        headerCols = cells.map((c) => c.trim());
        inTable = true;
        // The next line is the separator; skip ahead one more line
        i++;
      }
      continue;
    }

    // Inside the body of the recognised table
    if (cells.length < 2) continue;
    const folder = cells[1]?.trim() ?? "";
    if (!folder) continue;
    const role = cells.slice(2).map((c) => c.trim()).filter(Boolean).join(" / ") || null;
    results.push({ folder, role, subfolders: [] });
  }
  return results;
}

/** Returns null if the line isn't a markdown table row */
function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // ignore separator rows like |---|---|
  if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(trimmed)) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((c) => c);
}

// ─── merge ─────────────────────────────────────────────────────

function mergeDepartments(
  fromDoc: Department[],
  fromFs: Department[],
): Department[] {
  const byFolder = new Map<string, Department>();
  // FS first (authoritative for existence)
  for (const d of fromFs) byFolder.set(d.folder, { ...d });
  // Overlay doc (authoritative for role)
  for (const d of fromDoc) {
    const existing = byFolder.get(d.folder);
    if (existing) {
      existing.role = d.role ?? existing.role;
    }
    // departments in the doc but not on disk are skipped — the source of truth
    // is what's actually there
  }
  return [...byFolder.values()].sort((a, b) => a.folder.localeCompare(b.folder));
}
