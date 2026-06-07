import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSchema } from "../lib/schema.js";
import {
  addTodo,
  appendToToday,
  completeTodo,
} from "../lib/writers.js";
import type { BureauSchema } from "../lib/types.js";

const CLAUDE_MD = `# bureau

## 部署一覧

| 部署 | フォルダ | 役割 |
|------|---------|------|
| 秘書室 | secretary | 窓口 |
`;

let root: string;
let schema: BureauSchema;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  root = join(tmpdir(), `bureau-writers-${Date.now()}`);
  await mkdir(join(root, "secretary"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), CLAUDE_MD, "utf-8");
  schema = await buildSchema(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset writable folders between tests; CLAUDE.md & directories stay.
  await rm(join(root, "secretary", "todos"), {
    recursive: true,
    force: true,
  });
  await rm(join(root, "secretary", "notes"), {
    recursive: true,
    force: true,
  });
  await rm(join(root, "secretary", "inbox"), {
    recursive: true,
    force: true,
  });
});

describe("addTodo", () => {
  it("creates a new todos file with header and a checkbox line", async () => {
    const result = await addTodo(
      schema,
      "secretary",
      "Phase 2 を出荷する",
      { date: "2026-06-07", priority: "高", due: "2026-06-07" },
    );
    expect(result.created).toBe(true);
    const body = await readFile(join(root, result.path), "utf-8");
    expect(body).toContain("# 2026-06-07 TODO");
    expect(body).toContain(
      "- [ ] Phase 2 を出荷する | 優先度: 高 | 期限: 2026-06-07",
    );
  });

  it("appends without recreating the header on subsequent calls", async () => {
    await addTodo(schema, "secretary", "first", { date: "2026-06-07" });
    const second = await addTodo(schema, "secretary", "second", {
      date: "2026-06-07",
    });
    expect(second.created).toBe(false);
    const body = await readFile(join(root, second.path), "utf-8");
    const headers = body.split("# 2026-06-07 TODO").length - 1;
    expect(headers).toBe(1);
    expect(body).toContain("- [ ] first");
    expect(body).toContain("- [ ] second");
  });

  it("rejects unknown departments", async () => {
    await expect(
      addTodo(schema, "ghost", "x"),
    ).rejects.toThrow(/Unknown department/);
  });

  it("rejects bad date format", async () => {
    await expect(
      addTodo(schema, "secretary", "x", { date: "06/07/2026" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("rejects empty text", async () => {
    await expect(
      addTodo(schema, "secretary", "   "),
    ).rejects.toThrow(/non-empty/);
  });
});

describe("completeTodo", () => {
  it("flips the first matching open TODO to done", async () => {
    await addTodo(schema, "secretary", "Phase 2 を出荷する", {
      date: "2026-06-07",
    });
    await addTodo(schema, "secretary", "READMEを書く", {
      date: "2026-06-07",
    });
    const result = await completeTodo(
      schema,
      "secretary",
      "Phase 2",
      "2026-06-07",
    );
    expect(result.matched).toBe(true);
    expect(result.line).not.toBeNull();
    const body = await readFile(join(root, result.path), "utf-8");
    expect(body).toContain("- [x] Phase 2 を出荷する");
    expect(body).toContain("- [ ] READMEを書く");
  });

  it("is a no-op when no open TODO matches", async () => {
    await addTodo(schema, "secretary", "first", { date: "2026-06-07" });
    const result = await completeTodo(
      schema,
      "secretary",
      "ghost",
      "2026-06-07",
    );
    expect(result.matched).toBe(false);
    expect(result.line).toBeNull();
  });

  it("returns matched=false when the todos file doesn't exist", async () => {
    const result = await completeTodo(
      schema,
      "secretary",
      "anything",
      "2026-06-07",
    );
    expect(result.matched).toBe(false);
  });

  it("does not flip already-done TODOs", async () => {
    await addTodo(schema, "secretary", "thing", { date: "2026-06-07" });
    await completeTodo(schema, "secretary", "thing", "2026-06-07");
    const again = await completeTodo(
      schema,
      "secretary",
      "thing",
      "2026-06-07",
    );
    expect(again.matched).toBe(false);
  });
});

describe("appendToToday", () => {
  it("creates a decisions file with header and timestamped section", async () => {
    const result = await appendToToday(
      schema,
      "secretary",
      "decisions",
      "本日 bureau-mcp Phase 2 を出荷",
      "2026-06-07",
    );
    expect(result.created).toBe(true);
    const body = await readFile(join(root, result.path), "utf-8");
    expect(result.path).toContain("notes/2026-06-07-decisions.md");
    expect(body).toContain("# 2026-06-07 意思決定ログ");
    expect(body).toContain("本日 bureau-mcp Phase 2 を出荷");
    // timestamp section is rendered
    expect(body).toMatch(/## \d{2}:\d{2}/);
  });

  it("routes inbox writes to inbox/YYYY-MM-DD.md", async () => {
    const result = await appendToToday(
      schema,
      "secretary",
      "inbox",
      "今気づいた",
      "2026-06-07",
    );
    expect(result.path).toContain("inbox/2026-06-07.md");
    expect(await exists(join(root, result.path))).toBe(true);
  });

  it("routes learnings writes to notes/YYYY-MM-DD-learnings.md", async () => {
    const result = await appendToToday(
      schema,
      "secretary",
      "learnings",
      "今日の学び",
      "2026-06-07",
    );
    expect(result.path).toContain("notes/2026-06-07-learnings.md");
  });

  it("appends a second section to the same file without duplicating header", async () => {
    await appendToToday(
      schema,
      "secretary",
      "decisions",
      "first",
      "2026-06-07",
    );
    const second = await appendToToday(
      schema,
      "secretary",
      "decisions",
      "second",
      "2026-06-07",
    );
    expect(second.created).toBe(false);
    const body = await readFile(join(root, second.path), "utf-8");
    const headers = body.split("# 2026-06-07 意思決定ログ").length - 1;
    expect(headers).toBe(1);
    expect(body).toContain("first");
    expect(body).toContain("second");
  });
});
