import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSchema } from "../lib/schema.js";
import { getTodayDigest, listTodos } from "../lib/queries.js";
import { searchNotes } from "../lib/fs.js";
import type { BureauSchema } from "../lib/types.js";

let root: string;
let schema: BureauSchema;

const CLAUDE_MD = `# Company

## 部署一覧

| 部署 | フォルダ | 役割 |
|------|---------|------|
| 秘書室 | secretary | 窓口 |
| コーチ | coach | ジャーナリング |
`;

const SECRETARY_TODOS = `# 2026-06-04 TODO

## メイン
- [x] StockLens 公開 | 完了: 2026-06-04
- [ ] サイト設計 | 優先度: 通常 | 期限: 2026-06-15
- [ ] スクショ撮影 | 優先度: 通常 | 期限: 2026-06-20
`;

const SECRETARY_DECISIONS = `# 2026-06-04 意思決定ログ

## ポートフォリオ集約
本日 ShareKanji を作成、結果 mechanic 不適合と判定。
`;

const COACH_TODOS = `# 2026-06-04
- [ ] 朝のジャーナル
- [x] 夜のリフレクション
`;

beforeAll(async () => {
  root = join(tmpdir(), `bureau-queries-${Date.now()}`);
  await mkdir(join(root, "secretary", "todos"), { recursive: true });
  await mkdir(join(root, "secretary", "notes"), { recursive: true });
  await mkdir(join(root, "coach", "todos"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), CLAUDE_MD, "utf-8");
  await writeFile(
    join(root, "secretary", "todos", "2026-06-04.md"),
    SECRETARY_TODOS,
    "utf-8",
  );
  await writeFile(
    join(root, "secretary", "notes", "2026-06-04-decisions.md"),
    SECRETARY_DECISIONS,
    "utf-8",
  );
  await writeFile(
    join(root, "coach", "todos", "2026-06-04.md"),
    COACH_TODOS,
    "utf-8",
  );
  schema = await buildSchema(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listTodos", () => {
  it("returns todos across all departments for a date", async () => {
    const todos = await listTodos(schema, { date: "2026-06-04" });
    // 3 from secretary + 2 from coach
    expect(todos).toHaveLength(5);
  });

  it("filters by department", async () => {
    const todos = await listTodos(schema, {
      date: "2026-06-04",
      department: "coach",
    });
    expect(todos.map((t) => t.department)).toEqual(["coach", "coach"]);
  });

  it("filters by status=open", async () => {
    const todos = await listTodos(schema, {
      date: "2026-06-04",
      status: "open",
    });
    expect(todos.every((t) => !t.done)).toBe(true);
  });

  it("filters by status=done", async () => {
    const todos = await listTodos(schema, {
      date: "2026-06-04",
      status: "done",
    });
    expect(todos.every((t) => t.done)).toBe(true);
  });
});

describe("getTodayDigest", () => {
  it("counts open/done per department and detects decisions file", async () => {
    const digest = await getTodayDigest(schema, "2026-06-04");
    expect(digest.date).toBe("2026-06-04");
    const secretary = digest.departments.find(
      (d) => d.department === "secretary",
    );
    expect(secretary?.todoCounts).toEqual({ open: 2, done: 1 });
    expect(secretary?.decisionsExist).toBe(true);
    expect(secretary?.learningsExist).toBe(false);

    const coach = digest.departments.find((d) => d.department === "coach");
    expect(coach?.todoCounts).toEqual({ open: 1, done: 1 });
  });
});

describe("searchNotes", () => {
  it("finds substring matches across departments", async () => {
    const matches = await searchNotes(root, "ShareKanji");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.path).toContain("decisions");
  });

  it("scopes to a single department when requested", async () => {
    const matches = await searchNotes(root, "ジャーナル", {
      department: "coach",
    });
    expect(matches.every((m) => m.department === "coach")).toBe(true);
  });

  it("returns empty for empty queries", async () => {
    const matches = await searchNotes(root, "");
    expect(matches).toEqual([]);
  });
});
