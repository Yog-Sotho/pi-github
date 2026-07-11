import { z } from 'zod';

const Owner = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .describe('Repository owner (user or organization)');

const Repo = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._-]+$/)
  .describe('Repository name');

const RepoId = z.object({ owner: Owner, repo: Repo });

/** Client-supplied correlation ID echoed on every response frame. */
const RequestId = z.string().min(1).max(128);

const ListReposArgs = z
  .object({
    visibility: z.enum(['all', 'public', 'private']).optional().describe('Repository visibility filter'),
    per_page: z.number().int().min(1).max(100).optional().default(100),
  })
  .optional()
  .default({ per_page: 100 });

const GetRepoArgs = RepoId;

const GetFileContentArgs = RepoId.extend({
  path: z.string().min(1).max(4096).describe('File path within the repository'),
  ref: z.string().optional().default('main').describe('Branch, tag, or commit SHA'),
});

const GetDiffArgs = RepoId.extend({
  base: z.string().min(1).describe('Base branch, tag, or SHA'),
  head: z.string().min(1).describe('Head branch, tag, or SHA'),
});

const CreateBranchArgs = RepoId.extend({
  branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._/-]+$/)
    .describe('Name of the branch to create'),
  source: z.string().optional().default('main').describe('Branch to create from'),
});

const CommitFilesArgs = RepoId.extend({
  message: z.string().min(1).max(256).describe('Commit message'),
  branch: z.string().min(1).describe('Branch to commit to'),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(4096)
          .refine((v) => !v.split('/').includes('..'), { message: 'Path traversal is not allowed' }),
        content: z.string(),
        encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8'),
      }),
    )
    .min(1)
    .describe('Files to write in a single atomic commit'),
});

const CreatePRArgs = RepoId.extend({
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  base: z.string().min(1).describe('Target branch'),
  head: z.string().min(1).describe('Source branch'),
  draft: z.boolean().optional().default(false),
});

const SearchCodeArgs = z.object({
  query: z.string().min(1).max(256).describe('GitHub code search query'),
  per_page: z.number().int().min(1).max(100).optional().default(50),
});

const ListIssuesArgs = RepoId.extend({
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  per_page: z.number().int().min(1).max(100).optional().default(30),
});

interface ToolDef<S extends z.ZodType = z.ZodType> {
  description: string;
  streaming: boolean;
  args: S;
}

export const toolDefs = {
  list_repos: {
    description: "List the authenticated user's repositories.",
    streaming: false,
    args: ListReposArgs,
  },
  get_repo: {
    description: 'Fetch repository metadata (default branch, visibility, clone URLs).',
    streaming: false,
    args: GetRepoArgs,
  },
  get_file_content: {
    description: 'Fetch the decoded content of a file at a given ref.',
    streaming: true,
    args: GetFileContentArgs,
  },
  get_diff: {
    description: 'Generate a unified diff between two refs.',
    streaming: true,
    args: GetDiffArgs,
  },
  create_branch: {
    description: 'Create a new branch from a source branch.',
    streaming: false,
    args: CreateBranchArgs,
  },
  commit_files: {
    description: 'Commit multiple files atomically via the Git Trees API.',
    streaming: false,
    args: CommitFilesArgs,
  },
  create_pr: {
    description: 'Open a pull request.',
    streaming: false,
    args: CreatePRArgs,
  },
  search_code: {
    description: 'Search code across GitHub using GitHub search syntax.',
    streaming: true,
    args: SearchCodeArgs,
  },
  list_issues: {
    description: 'List issues for a repository, filtered by state.',
    streaming: true,
    args: ListIssuesArgs,
  },
} as const satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof toolDefs;

export const toolNames = Object.keys(toolDefs) as ToolName[];

export const ToolRequestSchema = z.discriminatedUnion('tool', [
  z.object({ id: RequestId, tool: z.literal('list_repos'), args: ListReposArgs }),
  z.object({ id: RequestId, tool: z.literal('get_repo'), args: GetRepoArgs }),
  z.object({ id: RequestId, tool: z.literal('get_file_content'), args: GetFileContentArgs }),
  z.object({ id: RequestId, tool: z.literal('get_diff'), args: GetDiffArgs }),
  z.object({ id: RequestId, tool: z.literal('create_branch'), args: CreateBranchArgs }),
  z.object({ id: RequestId, tool: z.literal('commit_files'), args: CommitFilesArgs }),
  z.object({ id: RequestId, tool: z.literal('create_pr'), args: CreatePRArgs }),
  z.object({ id: RequestId, tool: z.literal('search_code'), args: SearchCodeArgs }),
  z.object({ id: RequestId, tool: z.literal('list_issues'), args: ListIssuesArgs }),
]);

export type ToolRequest = z.infer<typeof ToolRequestSchema>;

/** Parsed (output) argument type for a given tool. */
export type ToolArgs<T extends ToolName> = z.output<(typeof toolDefs)[T]['args']>;

export interface ToolManifestEntry {
  name: ToolName;
  description: string;
  streaming: boolean;
  /** JSON Schema for the tool's `args` object. */
  parameters: Record<string, unknown>;
}

/**
 * Machine-readable tool manifest for agent-side discovery (e.g. dynamic tool
 * registration in Pi extensions). Parameters are standard JSON Schema.
 */
export function toolManifest(): ToolManifestEntry[] {
  return toolNames.map((name) => {
    const def: ToolDef = toolDefs[name];
    return {
      name,
      description: def.description,
      streaming: def.streaming,
      parameters: z.toJSONSchema(def.args, { io: 'input' }) as Record<string, unknown>,
    };
  });
}
