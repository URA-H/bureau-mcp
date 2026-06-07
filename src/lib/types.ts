/**
 * Bureau MCP — Type definitions
 *
 * The "bureau" abstraction maps a folder-based personal organisation
 * (departments, notes, todos) to a typed schema that MCP tools can query.
 */

/** A department is a top-level folder under the bureau root */
export interface Department {
  /** Folder name relative to bureau root, e.g. "secretary" */
  folder: string;
  /** Short description of the department's role, if discoverable */
  role: string | null;
  /** Subfolders the department uses, if discoverable */
  subfolders: string[];
}

/** Naming conventions inferred from CLAUDE.md / secretary CLAUDE.md */
export interface FileConventions {
  /** Daily file pattern e.g. "YYYY-MM-DD.md" */
  daily: string;
  /** Topic file pattern e.g. "kebab-case.md" */
  topic: string;
  /** Decisions log pattern e.g. "YYYY-MM-DD-decisions.md" */
  decisions: string;
  /** Learnings log pattern e.g. "YYYY-MM-DD-learnings.md" */
  learnings: string;
}

/** The full bureau schema, built once at server startup */
export interface BureauSchema {
  /** Absolute path to the bureau root */
  root: string;
  /** Departments discovered under root */
  departments: Department[];
  /** Naming conventions */
  fileConventions: FileConventions;
}

/** A TODO item parsed from a daily todos file */
export interface TodoItem {
  /** The department this todo belongs to, e.g. "secretary" */
  department: string;
  /** The date the todo file is from, YYYY-MM-DD */
  date: string;
  /** The line (1-indexed) in the source file */
  line: number;
  /** Raw markdown of the TODO line */
  raw: string;
  /** Cleaned text of the TODO */
  text: string;
  /** Done status */
  done: boolean;
  /** Priority hint, if "優先度: " is present */
  priority: string | null;
  /** Due date, if "期限: YYYY-MM-DD" is present */
  due: string | null;
}

/** A note metadata entry for search results */
export interface NoteMatch {
  /** Department the note belongs to */
  department: string;
  /** Relative path from the bureau root */
  path: string;
  /** Snippet showing context around the match */
  snippet: string;
  /** Line number of the match (1-indexed) */
  line: number;
}

/** Per-department breakdown for the daily digest */
export interface DepartmentDigest {
  department: string;
  todoPath: string | null;
  todoCounts: { open: number; done: number };
  inboxEntries: number;
  decisionsExist: boolean;
  learningsExist: boolean;
}

/** Summary of "today" across departments */
export interface TodayDigest {
  /** Today's date, YYYY-MM-DD */
  date: string;
  /** Per-department breakdown */
  departments: DepartmentDigest[];
}
