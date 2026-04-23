/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                                                                           ║
 * ║    ██████╗ ██████╗  ██████╗ ██████╗ ██╗   ██╗ ██████╗████████╗██╗██╗    ║
 * ║    ██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██║   ██║██╔════╝╚══██╔══╝██║██║    ║
 * ║    ██████╔╝██████╔╝██║   ██║██║  ██║██║   ██║██║        ██║   ██║██║    ║
 * ║    ██╔═══╝ ██╔══██╗██║   ██║██║  ██║██║   ██║██║        ██║   ██║╚═╝    ║
 * ║    ██║     ██║  ██║╚██████╔╝██████╔╝╚██████╔╝╚██████╗   ██║   ██║██╗    ║
 * ║    ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝  ╚═════╝  ╚═╝   ╚═╝╚═╝    ║
 * ║                                                                           ║
 * ║                  MCP Server — Configuration Module                        ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @module config
 * @description
 * This module is the single source of truth for all runtime configuration
 * consumed by the Productive MCP server. It is responsible for:
 *
 *   1. Silencing dotenv output so that the MCP stdio transport stays clean.
 *   2. Loading environment variables from a `.env` file (if present).
 *   3. Validating every required and optional variable against a strict Zod
 *      schema, providing clear, actionable error messages on misconfiguration.
 *   4. Exporting a typed `Config` interface and a `getConfig()` factory that
 *      callers can use to obtain a fully-validated configuration object.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ┌──────────────────────────┬──────────┬─────────────────────────────────────┐
 *  │ Variable                 │ Required │ Description                         │
 *  ├──────────────────────────┼──────────┼─────────────────────────────────────┤
 *  │ PRODUCTIVE_API_TOKEN     │   YES    │ Personal API token from Productive.  │
 *  │                          │          │ Found under My Account → API Tokens. │
 *  ├──────────────────────────┼──────────┼─────────────────────────────────────┤
 *  │ PRODUCTIVE_ORG_ID        │   YES    │ Numeric organisation ID.  Visible in │
 *  │                          │          │ the Productive URL after /org/.      │
 *  ├──────────────────────────┼──────────┼─────────────────────────────────────┤
 *  │ PRODUCTIVE_USER_ID       │   no     │ Optional Productive user ID used to  │
 *  │                          │          │ scope requests to a specific person. │
 *  ├──────────────────────────┼──────────┼─────────────────────────────────────┤
 *  │ PRODUCTIVE_API_BASE_URL  │   no     │ Override the default API base URL.   │
 *  │                          │          │ Defaults to the v2 production URL.   │
 *  └──────────────────────────┴──────────┴─────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STDOUT SAFETY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The MCP protocol communicates over stdio, which means any stray bytes written
 * to stdout will corrupt the JSON-RPC framing.  dotenv can write debug output
 * to stdout in certain configurations, so we temporarily replace
 * `process.stdout.write` with a no-op before calling `config()` and restore it
 * immediately afterwards.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// STDOUT GUARD
// ─────────────────────────────────────────────────────────────────────────────
// Temporarily suppress stdout so that dotenv cannot pollute the MCP transport.

const _originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;

// Load .env file variables into process.env (silently, thanks to the guard above).
loadDotenv();

// Restore the original stdout.write so the rest of the application behaves normally.
process.stdout.write = _originalStdoutWrite;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Zod schema that describes every environment variable the application depends
 * on.  Using Zod gives us:
 *
 *  • Runtime type-safety — values are coerced / validated at startup.
 *  • Descriptive error messages — each field carries a human-readable label.
 *  • A free TypeScript type via `z.infer<>` (see `Config` below).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  TIP: Add new environment variables here first, then update the table   │
 * │  in the module-level JSDoc above to keep the docs in sync.              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
const configSchema = z.object({
  /**
   * Personal API token issued by Productive.
   * Must be a non-empty string — the API will reject blank tokens with a 401.
   */
  PRODUCTIVE_API_TOKEN: z
    .string()
    .min(1, 'PRODUCTIVE_API_TOKEN is required and must not be empty'),

  /**
   * Numeric organisation identifier.
   * Every API request is scoped to this organisation, so an incorrect value
   * will result in 404 or 403 responses from the Productive API.
   */
  PRODUCTIVE_ORG_ID: z
    .string()
    .min(1, 'PRODUCTIVE_ORG_ID is required and must not be empty'),

  /**
   * Optional Productive user ID.
   * When provided, certain requests (e.g. "my tasks") are automatically
   * filtered to this user without the caller needing to pass it explicitly.
   */
  PRODUCTIVE_USER_ID: z.string().optional(),

  /**
   * Base URL for the Productive REST API.
   * Defaults to the current v2 production endpoint.  Override this in tests
   * or when pointing at a staging environment.
   *
   * Must be a valid URL (validated by Zod's `.url()` refinement).
   */
  PRODUCTIVE_API_BASE_URL: z
    .string()
    .url('PRODUCTIVE_API_BASE_URL must be a valid URL')
    .default('https://api.productive.io/api/v2/'),
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fully-validated, strongly-typed configuration object.
 *
 * Derived automatically from `configSchema` so that the type and the runtime
 * validation logic can never drift apart.
 *
 * @example
 * ```ts
 * import { getConfig, Config } from './config';
 *
 * const cfg: Config = getConfig();
 * console.log(cfg.PRODUCTIVE_API_BASE_URL); // 'https://api.productive.io/api/v2/'
 * ```
 */
export type Config = z.infer<typeof configSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses and validates the current `process.env` against `configSchema`.
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Call this once at server startup and pass the result down.  ║
 * ║  Avoid calling it in hot paths — validation is not free.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * @returns A fully-validated {@link Config} object ready for use.
 *
 * @throws {Error} If any required environment variable is missing or any value
 *   fails its validation rule.  The error message includes a formatted summary
 *   of every failing field so the operator can fix all issues in one pass.
 *
 * @example
 * ```ts
 * import { getConfig } from './config';
 *
 * const config = getConfig();
 * // config.PRODUCTIVE_API_TOKEN  → validated, non-empty string
 * // config.PRODUCTIVE_ORG_ID     → validated, non-empty string
 * // config.PRODUCTIVE_USER_ID    → string | undefined
 * // config.PRODUCTIVE_API_BASE_URL → valid URL string (with default)
 * ```
 */
export function getConfig(): Config {
  // Use safeParse so we can inspect the error before throwing — this lets us
  // emit a structured, human-readable summary to stderr rather than a raw
  // Zod exception that can be hard to parse at a glance.
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    // Format the Zod error into a nested object for readability, then emit it
    // to stderr (safe to write here — stdout is already restored).
    console.error(
      '[productive-mcp] Configuration validation failed:',
      result.error.format(),
    );

    throw new Error(
      '[productive-mcp] Invalid configuration. ' +
        'Please check your environment variables and refer to the README for setup instructions.',
    );
  }

  return result.data;
}
