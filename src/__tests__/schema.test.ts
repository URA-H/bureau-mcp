import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSchema, parseDepartmentsFromMarkdown } from "../lib/schema.js";

const CLAUDE_MD = `# Company - 仮想組織管理システム

## オーナープロフィール
...

## 組織構成

\`\`\`
.company/
├── CLAUDE.md
├── secretary/
├── note-writer/
└── coach/
\`\`\`

## 部署一覧

| 部署 | フォルダ | 役割 |
|------|---------|------|
| 秘書室 | secretary | 窓口・相談役。TODO 管理 |
| noteライター | note-writer | note 記事の企画・執筆 |
| コーチ | coach | ジャーナリング |
`;

describe("parseDepartmentsFromMarkdown", () => {
  it("extracts departments from the 部署一覧 table", () => {
    const depts = parseDepartmentsFromMarkdown(CLAUDE_MD);
    expect(depts.map((d) => d.folder)).toEqual([
      "secretary",
      "note-writer",
      "coach",
    ]);
    expect(depts[0]!.role).toContain("窓口");
  });

  it("returns empty when no recognised table is present", () => {
    expect(parseDepartmentsFromMarkdown("# title\nno tables here")).toEqual([]);
  });

  it("ignores stray pipes that aren't table rows", () => {
    const text = `Plain text with a | pipe | inline.\n`;
    expect(parseDepartmentsFromMarkdown(text)).toEqual([]);
  });
});

describe("buildSchema (integration)", () => {
  let root: string;

  beforeAll(async () => {
    root = join(tmpdir(), `bureau-test-${Date.now()}`);
    await mkdir(join(root, "secretary", "todos"), { recursive: true });
    await mkdir(join(root, "secretary", "notes"), { recursive: true });
    await mkdir(join(root, "note-writer", "articles"), { recursive: true });
    await mkdir(join(root, "coach", "journal"), { recursive: true });
    await writeFile(join(root, "CLAUDE.md"), CLAUDE_MD, "utf-8");
  });

  it("returns departments declared in CLAUDE.md and present on disk", async () => {
    const schema = await buildSchema(root);
    const folders = schema.departments.map((d) => d.folder).sort();
    expect(folders).toEqual(["coach", "note-writer", "secretary"]);
  });

  it("attaches role from CLAUDE.md to FS-discovered departments", async () => {
    const schema = await buildSchema(root);
    const secretary = schema.departments.find((d) => d.folder === "secretary");
    expect(secretary?.role).toContain("窓口");
  });

  it("discovers subfolders from disk", async () => {
    const schema = await buildSchema(root);
    const secretary = schema.departments.find((d) => d.folder === "secretary");
    expect(secretary?.subfolders).toEqual(["notes", "todos"]);
  });

  it("throws when root is missing", async () => {
    await expect(buildSchema(join(root, "nope"))).rejects.toThrow(
      /BUREAU_ROOT/,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
});
