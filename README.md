# bureau-mcp

> フォルダで「部署 / TODO / ノート」を運用している個人の "仮想組織" を、Claude（や他の MCP クライアント）から読めるようにする MCP サーバー。Bring Your Own Bureau。

[![Tech: TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6)](https://www.typescriptlang.org/)
[![Tech: MCP SDK](https://img.shields.io/badge/MCP-SDK-1.18-blue)](https://github.com/modelcontextprotocol/typescript-sdk)
[![Tech: Node 20+](https://img.shields.io/badge/Node-20%2B-339933)](https://nodejs.org/)
[![Tests: Vitest](https://img.shields.io/badge/Vitest-2-6E9F18)](https://vitest.dev/)

---

## 目次

- [どんなアプリか](#どんなアプリか)
- [提供している tools](#提供している-tools)
- [使っている技術](#使っている技術)
- [アーキテクチャ](#アーキテクチャ)
- [仕組みの中身](#仕組みの中身)
- [使い方](#使い方)
- [Claude Code への登録](#claude-code-への登録)
- [テスト / 動作確認](#テスト--動作確認)
- [今後の予定](#今後の予定)
- [このリポジトリについて](#このリポジトリについて)

---

## どんなアプリか

ローカルのフォルダを **「部署を持つ個人の仮想組織」** として運用している人向けの MCP サーバーです。

たとえばこういう構成のフォルダがあったとして:

```
my-bureau/
├── CLAUDE.md
├── secretary/
│   ├── CLAUDE.md
│   ├── inbox/2026-06-07.md
│   ├── todos/2026-06-07.md
│   └── notes/2026-06-04-decisions.md
├── coach/
│   ├── journal/2026-06-07.md
│   └── goals/phase1.md
└── research/
    └── reports/...
```

このフォルダを `BUREAU_ROOT` に指定して MCP として登録すると、Claude が次のような会話を成立させられます:

> 「今日どこから手をつけるべき？」
> → Claude が `bureau_get_today` を呼んで、部署ごとの open TODO 数や decisions/learnings の存在を見て答えを返す

> 「`secretary/notes/` で ShareKanji の意思決定ログを探して」
> → Claude が `bureau_search_notes` を呼んで該当ノートのスニペットを並べ、`bureau_read_note` で本文を読む

ねらいは **「自分のメモやワークフローを Claude に読ませる、ただし read-only で安全に」** という最小単位の橋渡しです。

---

## 提供している tools

| ツール名 | 説明 |
|---|---|
| `bureau_list_departments` | Bureau ルート配下の部署一覧（フォルダ名 / 役割 / サブフォルダ） |
| `bureau_list_todos` | 指定日付の TODO 一覧（部署横断、status フィルタ可） |
| `bureau_read_note` | 相対パス指定でノートの中身を返す（traversal ブロックあり） |
| `bureau_search_notes` | 大文字小文字を区別しない grep。スニペット + 行番号付き |
| `bureau_get_today` | 今日の digest（部署ごとの open/done TODO 数、inbox/decisions/learnings の有無） |

Phase 1 は **read-only** で固定しています。書き込み（`bureau_add_todo` 等）は Phase 2 で予定。

---

## 使っている技術

| カテゴリ | 採用技術 |
|----------|----------|
| 言語 | TypeScript 5 |
| ランタイム | Node.js 20+ |
| MCP SDK | `@modelcontextprotocol/sdk` 1.18 |
| バリデーション | Zod 3 |
| ビルド | esbuild（単一ファイルバンドル、約 16KB） |
| テスト | Vitest 2 |

依存は MCP SDK と Zod のみ。Markdown パーサも自前の最小実装で、サードパーティの重量級ライブラリは入れていません。

---

## アーキテクチャ

```
                 ┌────────────────────────────────┐
                 │  Claude / Claude Code           │
                 └─────────────────┬──────────────┘
                                   │ stdio (JSON-RPC)
                 ┌─────────────────▼──────────────┐
                 │  bureau-mcp (TypeScript)        │
                 │                                 │
                 │   read-only tools:              │
                 │     - bureau_list_departments   │
                 │     - bureau_list_todos         │
                 │     - bureau_read_note          │
                 │     - bureau_search_notes       │
                 │     - bureau_get_today          │
                 └─────────────────┬──────────────┘
                                   │ filesystem (path traversal guard)
                 ┌─────────────────▼──────────────┐
                 │  $BUREAU_ROOT (ローカルフォルダ)  │
                 │                                 │
                 │   CLAUDE.md  ← schema source    │
                 │   secretary/                    │
                 │   coach/                        │
                 │   ...                           │
                 └─────────────────────────────────┘
```

- 通信は **stdio + JSON-RPC**（Claude Code 標準）
- ファイル操作は **`BUREAU_ROOT` の中だけ**。ルート外への参照は path traversal として拒否
- ルートの `CLAUDE.md` を schema source として読み、部署一覧と役割を引き出す
- `CLAUDE.md` が無くてもフォルダ構造だけから部署を発見する fallback あり

---

## 仕組みの中身

### 1. スキーマを設計関数で組み立てる

`src/lib/schema.ts` の `buildSchema(rootPath)` が起動時に呼ばれて、Bureau の構造を `BureauSchema` 型に組み立てます。

- ルート直下の `CLAUDE.md` を読み、`部署 / department / Department` を最初のカラムに持つ markdown table を探す
- 同じフォルダ名の部署が **実際にディスクに存在するか** を `fs.readdir` で照合する
- 両者をマージして「ディスクに存在する部署だけ、CLAUDE.md から拾った役割で補強」して返す

CLAUDE.md が無い・table が無い・パースに失敗しても、**ファイルシステムだけから部署一覧を作る fallback** に降ります。

### 2. TODO の grammar は最小

`src/lib/parsers.ts` の `parseTodoFile()` は GitHub-flavored markdown の checklist（`- [ ]` / `- [x]`）だけを抽出し、行内の `優先度: X | 期限: YYYY-MM-DD` を拾います。

```typescript
const CHECKLIST_RE = /^\s*-\s*\[(?<mark>[ xX])\]\s*(?<rest>.*)$/;
const PRIORITY_RE = /優先度:\s*([^|｜\n]+?)(?=\s*[\|｜]|\s*期限|$)/;
const DUE_RE = /期限:\s*(\d{4}-\d{2}-\d{2})/;
```

ネストしたサブタスク（インデント子要素）はトップレベル扱いせず、独立した一行として記録します。

### 3. 検索は素朴 grep

`src/lib/fs.ts` の `searchNotes()` は **case-insensitive な部分文字列マッチ** を全 markdown ファイルに対して走らせて、行番号とスニペット（前後 80 文字ずつ）を返します。

大規模な bureau だとサーチが重くなる前提なので、**走査するファイル数の上限** と **マッチ件数の上限** を持っています（既定 5000 / 50 件）。Phase 2 でインデックスを足すか、ripgrep にスイッチするかを検討予定。

### 4. パストラバーサル防御

`assertWithinRoot()` で、ユーザーが渡した相対パスが正規化後にルートの外を指していないか必ず検査します。`../../etc/passwd` のような入力は即エラーで弾きます。

### 5. ビルドはバンドル

ESM のモジュール解決を避けるため、`esbuild` で単一ファイル（約 16KB）にバンドルしています。`node_modules` は external として残るので Claude Code 用設定はパス指定だけで済みます。

---

## 使い方

### 前提

- Node.js 20+ / pnpm（または npm / yarn）
- フォルダで運用している個人ワークフロー（`.company/` のようなもの）

### セットアップ

```bash
git clone https://github.com/URA-H/bureau-mcp.git
cd bureau-mcp
pnpm install
pnpm build
```

`dist/index.js` が生成されます。

### 環境変数

`BUREAU_ROOT` に **あなたの bureau フォルダ（ルート）への絶対パス** を指定します。

```bash
export BUREAU_ROOT=/absolute/path/to/.company
node dist/index.js
```

> `BUREAU_ROOT` が未設定だと起動時にエラーを返します。

---

## Claude Code への登録

```bash
claude mcp add bureau \
  -e BUREAU_ROOT=/absolute/path/to/.company \
  -- node /absolute/path/to/bureau-mcp/dist/index.js
```

登録後、Claude に対して例えば:

> 「今日の bureau 全体の状況を見て、どの部署から手をつけるべきか提案して」

と頼むと、`bureau_get_today` → `bureau_list_todos` → `bureau_read_note` の順に Claude がツールを使い分けます。

---

## テスト / 動作確認

```bash
pnpm test          # 21 件の単体テスト（parsers / schema / queries / search）
pnpm typecheck     # 型チェックのみ
pnpm dev           # tsx で開発実行
pnpm inspect       # MCP Inspector で対話的に検査
```

テストは tmpdir に小さな bureau をでっち上げて、`buildSchema` → `listTodos` → `searchNotes` を統合的に検査しています。

---

## 今後の予定

- Phase 2: write 系ツール（`bureau_add_todo` / `bureau_complete_todo` / `bureau_append_to_today`）
- Phase 3: 部署提案（「リサーチが続いたから research 部門を作る？」のような パターン検出）
- Phase 4: スキーマを汎用化（CLAUDE.md 以外の schema source、例えば `bureau.config.json` への対応）
- 検索を ripgrep にスイッチするオプション

---

## このリポジトリについて

個人開発の作品の1つです。`.company/` のような **フォルダベースで部署 / TODO / ノートを運用する個人ワークフロー** を 1.5 ヶ月続けてきた中で、Claude に読ませる橋渡しが欲しくなって書きました。

姉妹リポジトリ:
- [URA-H/threefortune-mcp](https://github.com/URA-H/threefortune-mcp) — 東洋占術 3 種を MCP として公開（direct import 型）
- [URA-H/stocklens-mcp](https://github.com/URA-H/stocklens-mcp) — StockLens FastAPI を Claude から呼べる MCP（HTTP proxy 型）
- [URA-H/trending-lens](https://github.com/URA-H/trending-lens) — GitHub Trending を Claude が要約する静的ダッシュボード

## ライセンス・注意事項

- 本プロジェクトは学習・個人開発目的のものです
- read-only 設計のため、Claude がユーザーのファイルを書き換えることはありません（Phase 1 時点）
- `BUREAU_ROOT` の中身は **ローカルにとどまります**。MCP サーバーがネットワーク経由でどこかに送ることはありません
