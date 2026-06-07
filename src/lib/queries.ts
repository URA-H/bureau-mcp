/**
 * Higher-level query helpers — these stitch the schema, parsers, and fs helpers
 * into the answers the MCP tools need.
 */

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parseTodoFile, todayStringLocal } from "./parsers.js";
import type { BureauSchema, TodayDigest, TodoItem } from "./types.js";

/**
 * Find the daily todos file for a given department + date.
 * Looks under any subfolder named "todos" first, then falls back to
 * the department root.
 */
async function locateTodoFile(
  schema: BureauSchema,
  department: string,
  date: string,
): Promise<string | null> {
  const deptPath = join(schema.root, department);
  const candidates: string[] = [];

  // todos/YYYY-MM-DD.md — the canonical secretary layout
  candidates.push(join(deptPath, "todos", `${date}.md`));
  // department/YYYY-MM-DD.md — fallback for departments without a todos/ subfolder
  candidates.push(join(deptPath, `${date}.md`));

  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      // not present, try next
    }
  }
  return null;
}

/**
 * List TODOs for a date across one or all departments.
 */
export async function listTodos(
  schema: BureauSchema,
  options: {
    date?: string;
    department?: string;
    status?: "all" | "open" | "done";
  } = {},
): Promise<TodoItem[]> {
  const date = options.date ?? todayStringLocal();
  const status = options.status ?? "all";
  const targets = options.department
    ? schema.departments.filter((d) => d.folder === options.department)
    : schema.departments;

  const out: TodoItem[] = [];
  for (const dept of targets) {
    const path = await locateTodoFile(schema, dept.folder, date);
    if (!path) continue;
    let text: string;
    try {
      text = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    const items = parseTodoFile(text, dept.folder, date);
    for (const it of items) {
      if (status === "open" && it.done) continue;
      if (status === "done" && !it.done) continue;
      out.push(it);
    }
  }
  return out;
}

/**
 * Build a "today" digest: per-department TODO counts + presence of
 * decisions/learnings/inbox entries.
 */
export async function getTodayDigest(
  schema: BureauSchema,
  date: string = todayStringLocal(),
): Promise<TodayDigest> {
  const departments = [];
  for (const dept of schema.departments) {
    const todoPath = await locateTodoFile(schema, dept.folder, date);
    let open = 0;
    let done = 0;
    if (todoPath) {
      try {
        const text = await readFile(todoPath, "utf-8");
        const items = parseTodoFile(text, dept.folder, date);
        for (const it of items) {
          if (it.done) done++;
          else open++;
        }
      } catch {
        // ignore read failure, leave counts at 0
      }
    }
    const inboxEntries = await countMatches(
      schema,
      dept.folder,
      "inbox",
      `${date}.md`,
    );
    const decisionsExist = await fileExists(
      schema,
      dept.folder,
      "notes",
      `${date}-decisions.md`,
    );
    const learningsExist = await fileExists(
      schema,
      dept.folder,
      "notes",
      `${date}-learnings.md`,
    );
    departments.push({
      department: dept.folder,
      todoPath: todoPath
        ? todoPath.slice(schema.root.length + 1)
        : null,
      todoCounts: { open, done },
      inboxEntries,
      decisionsExist,
      learningsExist,
    });
  }
  return { date, departments };
}

async function fileExists(
  schema: BureauSchema,
  ...parts: string[]
): Promise<boolean> {
  try {
    await access(join(schema.root, ...parts));
    return true;
  } catch {
    return false;
  }
}

async function countMatches(
  schema: BureauSchema,
  department: string,
  subfolder: string,
  fileName: string,
): Promise<number> {
  // For now, "presence" → 1 if file exists, 0 otherwise. inbox/ in particular
  // tends to be one file per day with multiple entries inside; we don't
  // attempt to parse those entries here.
  return (await fileExists(schema, department, subfolder, fileName)) ? 1 : 0;
}
