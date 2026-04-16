import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveIncludedResource } from '../api/types.js';

type ToolResult = { content: Array<{ type: string; text: string }> };

function resolvePersonName(personId: string | undefined, included?: ProductiveIncludedResource[]): string | undefined {
  if (!personId || !included) return undefined;
  const person = included.find(item => item.type === 'people' && item.id === personId);
  if (!person) return undefined;
  const first = person.attributes.first_name || '';
  const last = person.attributes.last_name || '';
  return `${first} ${last}`.trim() || undefined;
}

function truncateBody(body: string, maxLength = 200): string {
  if (body.length <= maxLength) return body;
  return body.substring(0, maxLength) + '...';
}

// ---- Create Comment ----

const createCommentSchema = z.object({
  task_id: z.string().optional(),
  discussion_id: z.string().optional(),
  page_id: z.string().optional(),
  comment: z.string().min(1, 'Comment text is required'),
  draft: z.boolean().optional(),
  hidden: z.boolean().optional(),
}).refine(
  data => Boolean(data.task_id ?? data.discussion_id ?? data.page_id),
  { message: 'At least one of task_id, discussion_id, or page_id is required' }
);

export async function addTaskCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = createCommentSchema.parse(args);

    const relationships: Record<string, { data: { id: string; type: string } }> = {};
    if (params.task_id) relationships['task'] = { data: { id: params.task_id, type: 'tasks' } };
    if (params.discussion_id) relationships['discussion'] = { data: { id: params.discussion_id, type: 'discussions' } };
    if (params.page_id) relationships['page'] = { data: { id: params.page_id, type: 'pages' } };

    const attributes: { body: string; draft?: boolean; hidden?: boolean } = { body: params.comment };
    if (params.draft !== undefined) attributes.draft = params.draft;
    if (params.hidden !== undefined) attributes.hidden = params.hidden;

    const response = await client.createComment({
      data: {
        type: 'comments',
        attributes,
        relationships,
      },
    });

    const attrs = response.data.attributes;
    let text = `Comment created successfully!\n`;
    text += `Comment ID: ${response.data.id}\n`;
    if (params.task_id) text += `Task ID: ${params.task_id}\n`;
    if (params.discussion_id) text += `Discussion ID: ${params.discussion_id}\n`;
    if (params.page_id) text += `Page ID: ${params.page_id}\n`;
    text += `Body: ${attrs.body}`;
    if (attrs.draft) text += `\nDraft: true`;
    if (attrs.hidden) text += `\nHidden: true`;
    if (attrs.created_at) text += `\nCreated at: ${attrs.created_at}`;

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const addTaskCommentDefinition = {
  name: 'create_comment',
  description: 'Create a comment on a task, discussion, or page in Productive.io. Supports HTML formatting, drafts, and hidden comments.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to comment on',
      },
      discussion_id: {
        type: 'string',
        description: 'ID of the discussion to comment on',
      },
      page_id: {
        type: 'string',
        description: 'ID of the page to comment on',
      },
      comment: {
        type: 'string',
        description: 'Comment content (required). Supports HTML formatting with tags like <div>, <p>, <strong>, <em>, <ul>, <li>, <a href="">.',
      },
      draft: {
        type: 'boolean',
        description: 'Save comment as a draft (not yet published)',
      },
      hidden: {
        type: 'boolean',
        description: 'Create the comment as hidden',
      },
    },
    required: ['comment'],
  },
};

// ---- List Comments ----

const listCommentsSchema = z.object({
  task_id: z.string().optional(),
  project_id: z.string().optional(),
  discussion_id: z.string().optional(),
  page_id: z.string().optional(),
  limit: z.number().optional(),
  page: z.number().optional(),
});

export async function listCommentsTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = listCommentsSchema.parse(args);

    const response = await client.listComments({
      task_id: params.task_id,
      project_id: params.project_id,
      discussion_id: params.discussion_id,
      page_id: params.page_id,
      limit: params.limit,
      page: params.page,
    });

    if (!response.data || response.data.length === 0) {
      return {
        content: [{ type: 'text', text: 'No comments found.' }],
      };
    }

    const commentsText = response.data.map(comment => {
      const creatorId = comment.relationships?.creator?.data?.id;
      const creatorName = resolvePersonName(creatorId, response.included) || `Person ${creatorId || 'unknown'}`;
      const pinned = comment.attributes.pinned_at ? ' [PINNED]' : '';
      const body = truncateBody(comment.attributes.body);

      return `- Comment ID: ${comment.id}${pinned}\n  By: ${creatorName}\n  Date: ${comment.attributes.created_at}\n  Body: ${body}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Comments (${response.data.length}):\n\n${commentsText}` }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const listCommentsDefinition = {
  name: 'list_comments',
  description: 'List comments in Productive.io, optionally filtered by task, project, discussion, or page.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Filter comments by task ID',
      },
      project_id: {
        type: 'string',
        description: 'Filter comments by project ID',
      },
      discussion_id: {
        type: 'string',
        description: 'Filter comments by discussion ID',
      },
      page_id: {
        type: 'string',
        description: 'Filter comments by page ID',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of comments to return',
      },
      page: {
        type: 'number',
        description: 'Page number for pagination',
      },
    },
  },
};

// ---- Get Comment ----

const getCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function getCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = getCommentSchema.parse(args);

    const response = await client.getComment(params.comment_id);
    const comment = response.data;
    const attrs = comment.attributes;

    const creatorId = comment.relationships?.creator?.data?.id;
    const included = (response as unknown as { included?: ProductiveIncludedResource[] }).included;
    const creatorName = resolvePersonName(creatorId, included) || `Person ${creatorId || 'unknown'}`;

    let text = `Comment ID: ${comment.id}\n`;
    text += `Body: ${attrs.body}\n`;
    text += `Commentable Type: ${attrs.commentable_type}\n`;
    text += `Creator: ${creatorName}\n`;
    text += `Created: ${attrs.created_at}\n`;
    text += `Updated: ${attrs.updated_at}\n`;
    if (attrs.edited_at) text += `Edited: ${attrs.edited_at}\n`;
    if (attrs.deleted_at) text += `Deleted: ${attrs.deleted_at}\n`;
    text += `Draft: ${attrs.draft ?? false}\n`;
    text += `Hidden: ${attrs.hidden ?? false}\n`;
    text += `Pinned: ${attrs.pinned_at ? `Yes (${attrs.pinned_at})` : 'No'}\n`;
    if (attrs.reactions) text += `Reactions: ${JSON.stringify(attrs.reactions)}\n`;
    if (attrs.version_number !== undefined) text += `Version: ${attrs.version_number}\n`;

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const getCommentDefinition = {
  name: 'get_comment',
  description: 'Get a single comment by ID from Productive.io with all attributes.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to retrieve (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Update Comment ----

const updateCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  hidden: z.boolean().optional(),
}).refine(
  data => data.body !== undefined || data.draft !== undefined || data.hidden !== undefined,
  { message: 'At least one of body, draft, or hidden must be provided' }
);

export async function updateCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = updateCommentSchema.parse(args);

    const attributes: { body?: string; draft?: boolean; hidden?: boolean } = {};
    if (params.body !== undefined) attributes.body = params.body;
    if (params.draft !== undefined) attributes.draft = params.draft;
    if (params.hidden !== undefined) attributes.hidden = params.hidden;

    const response = await client.updateComment(params.comment_id, {
      data: {
        type: 'comments',
        id: params.comment_id,
        attributes,
      },
    });

    const attrs = response.data.attributes;
    let text = `Comment ${params.comment_id} updated successfully.\n`;
    text += `Body: ${attrs.body}`;
    if (attrs.draft !== undefined) text += `\nDraft: ${attrs.draft}`;
    if (attrs.hidden !== undefined) text += `\nHidden: ${attrs.hidden}`;

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const updateCommentDefinition = {
  name: 'update_comment',
  description: 'Update an existing comment in Productive.io. At least one of body, draft, or hidden must be provided.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to update (required)',
      },
      body: {
        type: 'string',
        description: 'The new comment body content. Supports HTML formatting.',
      },
      draft: {
        type: 'boolean',
        description: 'Set draft status of the comment',
      },
      hidden: {
        type: 'boolean',
        description: 'Set hidden status of the comment',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Delete Comment ----

const deleteCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function deleteCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = deleteCommentSchema.parse(args);

    await client.deleteComment(params.comment_id);

    return {
      content: [{
        type: 'text',
        text: `Comment ${params.comment_id} deleted successfully.`,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const deleteCommentDefinition = {
  name: 'delete_comment',
  description: 'Delete a comment by ID from Productive.io.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to delete (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Pin Comment ----

const pinCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function pinCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = pinCommentSchema.parse(args);

    await client.pinComment(params.comment_id);

    return {
      content: [{
        type: 'text',
        text: `Comment ${params.comment_id} pinned successfully.`,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const pinCommentDefinition = {
  name: 'pin_comment',
  description: 'Pin a comment in Productive.io so it appears prominently.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to pin (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Unpin Comment ----

const unpinCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function unpinCommentTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = unpinCommentSchema.parse(args);

    await client.unpinComment(params.comment_id);

    return {
      content: [{
        type: 'text',
        text: `Comment ${params.comment_id} unpinned successfully.`,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const unpinCommentDefinition = {
  name: 'unpin_comment',
  description: 'Unpin a previously pinned comment in Productive.io.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to unpin (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Add Comment Reaction ----

const addCommentReactionSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
  reaction: z.string().min(1, 'Reaction is required'),
});

export async function addCommentReactionTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = addCommentReactionSchema.parse(args);

    await client.addCommentReaction(params.comment_id, params.reaction);

    return {
      content: [{
        type: 'text',
        text: `Reaction "${params.reaction}" added to comment ${params.comment_id} successfully.`,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const addCommentReactionDefinition = {
  name: 'add_comment_reaction',
  description: 'Add a reaction (e.g. "like") to a comment in Productive.io.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to react to (required)',
      },
      reaction: {
        type: 'string',
        description: 'The reaction to add (e.g. "like", "heart", "thumbsup") (required)',
      },
    },
    required: ['comment_id', 'reaction'],
  },
};

// ---- Remove Comment Reaction ----

const removeCommentReactionSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
  reaction: z.string().min(1, 'Reaction is required'),
});

export async function removeCommentReactionTool(
  client: ProductiveAPIClient,
  args: unknown
): Promise<ToolResult> {
  try {
    const params = removeCommentReactionSchema.parse(args);

    await client.removeCommentReaction(params.comment_id, params.reaction);

    return {
      content: [{
        type: 'text',
        text: `Reaction "${params.reaction}" removed from comment ${params.comment_id} successfully.`,
      }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

export const removeCommentReactionDefinition = {
  name: 'remove_comment_reaction',
  description: 'Remove a reaction from a comment in Productive.io.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to remove the reaction from (required)',
      },
      reaction: {
        type: 'string',
        description: 'The reaction to remove (e.g. "like", "heart", "thumbsup") (required)',
      },
    },
    required: ['comment_id', 'reaction'],
  },
};