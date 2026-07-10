import { z } from 'zod';

const RepoId = z.object({
  owner: z.string().min(1).max(39).regex(/^[a-zA-Z0-9_-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
});

export const ToolRequestSchema = z.discriminatedUnion('tool', [
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('list_repos'), 
    args: z.object({ visibility: z.enum(['all', 'public', 'private']).optional() }).optional().default({}) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('get_repo'), 
    args: RepoId 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('get_file_content'), 
    args: RepoId.extend({ 
      path: z.string().min(1).max(4096), 
      ref: z.string().optional().default('main') 
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('get_diff'), 
    args: RepoId.extend({ 
      base: z.string(), 
      head: z.string() 
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('create_branch'), 
    args: RepoId.extend({ 
      branch: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._/-]+$/), 
      source: z.string().optional().default('main') 
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('commit_files'), 
    args: RepoId.extend({ 
      message: z.string().min(1).max(256), 
      branch: z.string(),
      files: z.array(z.object({
        path: z.string().min(1).max(4096).refine(v => !v.includes('..')),
        content: z.string(),
        encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8')
      })).min(1)
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('create_pr'), 
    args: RepoId.extend({ 
      title: z.string().min(1).max(256), 
      body: z.string().optional(),
      base: z.string(), 
      head: z.string(), 
      draft: z.boolean().optional().default(false) 
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('search_code'), 
    args: z.object({ 
      query: z.string().min(1).max(256) 
    }) 
  }),
  z.object({ 
    id: z.string().uuid(),
    tool: z.literal('list_issues'), 
    args: RepoId.extend({ 
      state: z.enum(['open', 'closed', 'all']).optional().default('open'),
      per_page: z.number().int().min(1).max(100).optional().default(30)
    }) 
  }),
]);

export type ToolRequest = z.infer<typeof ToolRequestSchema>;