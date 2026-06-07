/**
 * bureau-mcp tools (Phase 1 — read-only).
 *
 * Each tool returns text content; structured data is encoded as JSON for the
 * model to parse. We keep the surface narrow on purpose: list departments,
 * list todos, read a note, search notes, get today's digest.
 *
 * Write-side tools (add_todo, append_to_today) are deferred to Phase 2.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { readNote, searchNotes } from "../lib/fs.js";
import { todayStringLocal } from "../lib/parsers.js";
import { getTodayDigest, listTodos } from "../lib/queries.js";
import {
  addTodo,
  appendToToday,
  completeTodo,
} from "../lib/writers.js";
import type { BureauSchema } from "../lib/types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asJson(payload: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asText(payload: string): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: payload }] };
}

function asError(e: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text", text: `[bureau-mcp error] ${msg}` }],
    isError: true,
  };
}

export function registerBureauTools(
  server: McpServer,
  schema: BureauSchema,
): void {
  // ──────────────────────────────────────────────
  // bureau_list_departments
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_list_departments",
    {
      title: "bureau: list departments",
      description:
        "Bureau ルート配下に存在する部署一覧を返す。各部署について、フォルダ名・役割（CLAUDE.md から推定）・サブフォルダ構成を含む。",
      inputSchema: z.object({}).shape,
    },
    async () =>
      asJson({
        root: schema.root,
        departments: schema.departments,
      }),
  );

  // ──────────────────────────────────────────────
  // bureau_list_todos
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_list_todos",
    {
      title: "bureau: list TODOs",
      description:
        "指定日付の TODO を部署横断で返す。`status` で open / done / all をフィルタできる。日付を省略すると今日。",
      inputSchema: z.object({
        date: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("YYYY-MM-DD。省略時は今日（ローカルタイムゾーン）"),
        department: z
          .string()
          .optional()
          .describe("部署フォルダ名で絞り込み（例: secretary）"),
        status: z
          .enum(["all", "open", "done"])
          .default("all")
          .describe("TODO の完了状態でフィルタ"),
      }).shape,
    },
    async (args) => {
      try {
        const todos = await listTodos(schema, {
          date: args.date,
          department: args.department,
          status: args.status,
        });
        return asJson({ count: todos.length, todos });
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_read_note
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_read_note",
    {
      title: "bureau: read a note",
      description:
        "Bureau ルートからの相対パスでノートの中身を返す。ルート外への参照は traversal エラーとして拒否される。",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Bureau ルートからの相対パス（例: secretary/notes/2026-06-04-decisions.md）"),
      }).shape,
    },
    async (args) => {
      try {
        const content = await readNote(schema.root, args.path);
        return asText(content);
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_search_notes
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_search_notes",
    {
      title: "bureau: search notes",
      description:
        "全部署横断（または指定部署内）で大文字小文字を区別せず文字列を含むノートを検索し、行番号とスニペットを返す。",
      inputSchema: z.object({
        query: z.string().min(1).describe("検索文字列（plain text）"),
        department: z
          .string()
          .optional()
          .describe("部署フォルダ名で絞り込み"),
        maxMatches: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("返す最大マッチ数"),
      }).shape,
    },
    async (args) => {
      try {
        const matches = await searchNotes(schema.root, args.query, {
          department: args.department,
          maxMatches: args.maxMatches,
        });
        return asJson({ count: matches.length, matches });
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_get_today
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_get_today",
    {
      title: "bureau: today's digest",
      description:
        "今日の状態を集約: 部署ごとの open/done TODO 数、Inbox / decisions / learnings ファイルの存在。会話の冒頭で「今日どこから?」と聞きたいときに。",
      inputSchema: z.object({
        date: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("YYYY-MM-DD。省略時は今日"),
      }).shape,
    },
    async (args) => {
      try {
        const digest = await getTodayDigest(
          schema,
          args.date ?? todayStringLocal(),
        );
        return asJson(digest);
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_add_todo (Phase 2)
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_add_todo",
    {
      title: "bureau: add a TODO line",
      description:
        "指定部署の TODO ファイル（YYYY-MM-DD.md）に 1 行追記する。ファイルが無ければ作る。重要: 既存行は変更しない append-only。",
      inputSchema: z.object({
        department: z
          .string()
          .describe("対象部署のフォルダ名（例: secretary）"),
        text: z.string().min(1).describe("TODO 内容"),
        date: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("YYYY-MM-DD。省略時は今日"),
        priority: z
          .string()
          .optional()
          .describe("優先度ラベル（例: 高 / 通常 / 低）"),
        due: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("期限日（YYYY-MM-DD）"),
      }).shape,
    },
    async (args) => {
      try {
        const result = await addTodo(schema, args.department, args.text, {
          date: args.date,
          priority: args.priority,
          due: args.due,
        });
        return asJson(result);
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_complete_todo (Phase 2)
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_complete_todo",
    {
      title: "bureau: mark a TODO as done",
      description:
        "指定部署の指定日の TODO のうち、textMatch を含む最初の open 行を `[ ]` → `[x]` に変える。マッチしない場合は no-op。",
      inputSchema: z.object({
        department: z.string().describe("対象部署のフォルダ名"),
        textMatch: z
          .string()
          .min(1)
          .describe("完了させたい TODO に含まれる文字列（大文字小文字区別なし、最初の 1 件のみ）"),
        date: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("YYYY-MM-DD。省略時は今日"),
      }).shape,
    },
    async (args) => {
      try {
        const result = await completeTodo(
          schema,
          args.department,
          args.textMatch,
          args.date ?? todayStringLocal(),
        );
        return asJson(result);
      } catch (e) {
        return asError(e);
      }
    },
  );

  // ──────────────────────────────────────────────
  // bureau_append_to_today (Phase 2)
  // ──────────────────────────────────────────────
  server.registerTool(
    "bureau_append_to_today",
    {
      title: "bureau: append to inbox/decisions/learnings",
      description:
        "今日の inbox / decisions / learnings ファイルに 1 セクション分追記する。ファイルが無ければ最小ヘッダで作る。タイムスタンプ付きセクションで区切る。",
      inputSchema: z.object({
        department: z.string().describe("対象部署のフォルダ名"),
        kind: z
          .enum(["inbox", "decisions", "learnings"])
          .describe("追記先（inbox/decisions/learnings）"),
        content: z.string().min(1).describe("追記する内容（Markdown）"),
        date: z
          .string()
          .regex(DATE_RE)
          .optional()
          .describe("YYYY-MM-DD。省略時は今日"),
      }).shape,
    },
    async (args) => {
      try {
        const result = await appendToToday(
          schema,
          args.department,
          args.kind,
          args.content,
          args.date ?? todayStringLocal(),
        );
        return asJson(result);
      } catch (e) {
        return asError(e);
      }
    },
  );
}
