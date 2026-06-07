import { describe, it, expect } from "vitest";
import { parseTodoFile, todayStringLocal } from "../lib/parsers.js";

describe("parseTodoFile", () => {
  const sample = `# 2026-06-04 TODO

## メイン
- [ ] StockLens README 執筆 | 優先度: 高 | 期限: 2026-06-04
- [x] GitHubリポジトリ公開化 | 完了: 2026-06-04
  - 詳細: foo
- [ ] スクリーンショット撮影 | 優先度: 通常 | 期限: 2026-06-20

## 備考
- 関連: secretary/notes/2026-06-03-decisions.md
`;

  it("extracts checkbox lines and ignores non-checkbox bullets", () => {
    const items = parseTodoFile(sample, "secretary", "2026-06-04");
    expect(items).toHaveLength(3);
    expect(items[0]!.done).toBe(false);
    expect(items[1]!.done).toBe(true);
    expect(items[2]!.done).toBe(false);
  });

  it("captures priority and due date", () => {
    const items = parseTodoFile(sample, "secretary", "2026-06-04");
    expect(items[0]!.priority).toBe("高");
    expect(items[0]!.due).toBe("2026-06-04");
    expect(items[2]!.priority).toBe("通常");
    expect(items[2]!.due).toBe("2026-06-20");
  });

  it("strips meta from displayed text", () => {
    const items = parseTodoFile(sample, "secretary", "2026-06-04");
    expect(items[0]!.text).toBe("StockLens README 執筆");
    expect(items[1]!.text).toBe("GitHubリポジトリ公開化");
  });

  it("captures line numbers and department", () => {
    const items = parseTodoFile(sample, "secretary", "2026-06-04");
    expect(items[0]!.line).toBe(4);
    expect(items[0]!.department).toBe("secretary");
  });
});

describe("todayStringLocal", () => {
  it("formats as YYYY-MM-DD in local timezone", () => {
    const d = new Date(2026, 5, 7, 10, 30); // June 7, 2026 local
    expect(todayStringLocal(d)).toBe("2026-06-07");
  });
  it("zero-pads single-digit months/days", () => {
    const d = new Date(2026, 0, 5);
    expect(todayStringLocal(d)).toBe("2026-01-05");
  });
});
