/**
 *  ___  ___  ________  ________  ___  ___     
 * |\  \|\  \|\   __  \|\   ____\|\  \|\  \    
 * \ \  \\\  \ \  \|\  \ \  \___|\ \  \\\  \   
 *  \ \  \\\  \ \  \\\  \ \_____  \ \   __  \  
 *   \ \  \\\  \ \  \\\  \|____|\  \ \  \ \  \ 
 *    \ \_______\ \_______\____\_\  \ \__\ \__\
 *     \|_______|\|_______|\_________\|__|\|__|
 *                         \|_________|         
 *
 * @file   src/config/index.ts
 * @module config
 *
 * @description
 * Central configuration module for the productive-mcp server.
 *
 * This module is responsible for:
 *   1. Silencing dotenv stdout output so the MCP protocol clean-stdout
 *      requirement is not violated.
 *   2. Loading environment variables from a .env file (or from the process
 *      environment when running in a container / CI environment).
 *   3. Validating every required and optional variable against a strict Zod
 *      schema so that misconfiguration is caught at startup rather than at
 *      runtime deep inside an API call.
 *   4. Exporting a strongly-typed Config interface and a getConfig()
 *      factory function that the rest of the application can import.
 *
 * ---------------------------------------------------------------------------
 * Environment Variables
 * ---------------------------------------------------------------------------
 *
 * Variable                  | Required | Default
 * --------------------------|----------|-----------------------------------------
 * PRODUCTIVE_API_TOKEN      | Yes      | (none)
 * PRODUCTIVE_ORG_ID         | Yes      | (none)
 * PRODUCTIVE_USER_ID        | No       | (none)
 * PRODUCTIVE_API_BASE_URL   | No       | https://api.productive.io/api/v2/
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *
 *   import { getConfig } from './config/index.js';
 *
 *   const cfg = getConfig();
 *   console.log(cfg.PRODUCTIVE_API_BASE_URL);
 *   // => https://api.productive.io/api/v2/
 *
 * getConfig() throws an Error with a human-readable message if any required
 * variable is missing or fails validation. The raw Zod error is written to
 * stderr so it is visible in server logs without polluting the MCP stdout
 * stream.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Step 1 - Silence dotenv stdout output
// ---------------------------------------------------------------------------
// The MCP (Model Context Protocol) specification requires that the server
// communicates exclusively over stdout using JSON-RPC messages. Any stray
// text written to stdout - including dotenv debug output - will corrupt the
// protocol framing. We therefore temporarily replace process.stdout.write
// with a no-op before calling dotenv, then restore it immediately afterwards.
// ---------------------------------------------------------------------------

const _originalStdoutWrite = process.stdout.write.bind(process.stdout);

// Suppress all stdout writes while dotenv initialises.
(process.stdout.write as unknown) = () => true;

/**
 * Load variables from a .env file into process.env.
 *
 * dotenv is a no-op when a variable is already present in the environment,
 * so this is safe to call in production containers where variables are
 * injected by the orchestrator.
 */
loadDotenv();

// Restore the original stdout.write so the rest of the application can write
// normally (MCP SDK handles its own framing from this point on).
process.stdout.write = _originalStdoutWrite;

// ---------------------------------------------------------------------------
// Step 2 - Define the configuration schema
// ---------------------------------------------------------------------------
// We use Zod to declare every variable the application depends on, together
// with its type constraints, default values, and human-readable error
// messages. Zod's safeParse gives us a discriminated-union result so we can
// report ALL validation errors at once rather than failing on the first
// missing variable.
// ---------------------------------------------------------------------------

/**
 * Zod schema that describes the shape and constraints of the application
 * configuration.
 *
 * - PRODUCTIVE_API_TOKEN    - Must be a non-empty string.
 * - PRODUCTIVE_ORG_ID       - Must be a non-empty string.
 * - PRODUCTIVE_USER_ID      - Optional; may be omitted entirely.
 * - PRODUCTIVE_API_BASE_URL - Must be a valid URL when provided; defaults
 *                             to the public Productive.io v2 API endpoint.
 */
const configSchema = z.object({
  /**
   * Bearer token used to authenticate every HTTP request sent to the
   * Productive.io REST API. Generate or copy this value from your
   * Productive.io account settings under API Tokens.
   */
  PRODUCTIVE_API_TOKEN: z
    .string()
    .min(1, 'PRODUCTIVE_API_TOKEN is required and must not be empty'),

  /**
   * The numeric identifier of your Productive.io organisation. You can find
   * this in the URL when you are logged in: app.productive.io/<org-id>/...
   */
  PRODUCTIVE_ORG_ID: z
    .string()
    .min(1, 'PRODUCTIVE_ORG_ID is required and must not be empty'),

  /**
   * Optional Productive.io user ID. When provided, certain API queries
   * (e.g. listing tasks assigned to the current user) will be automatically
   * scoped to this user without requiring callers to pass it explicitly.
   */
  PRODUCTIVE_USER_ID: z.string().optional(),

  /**
   * Base URL for the Productive.io REST API. The trailing slash is required
   * by the HTTP client when constructing resource paths.
   *
   * Override this in tests or when pointing at a staging environment:
   *   PRODUCTIVE_API_BASE_URL=https://staging-api.productive.io/api/v2/
   */
  PRODUCTIVE_API_BASE_URL: z
    .string()
    .url('PRODUCTIVE_API_BASE_URL must be a valid URL')
    .default('https://api.productive.io/api/v2/'),
});

// ---------------------------------------------------------------------------
// Step 3 - Export the Config type
// ---------------------------------------------------------------------------

/**
 * Strongly-typed configuration object inferred directly from configSchema.
 *
 * Import this type wherever you need to annotate a variable that holds the
 * application configuration:
 *
 *   import type { Config } from './config/index.js';
 *
 *   function buildHeaders(cfg: Config): Record<string, string> {
 *     return {
 *       Authorization: `Bearer ${cfg.PRODUCTIVE_API_TOKEN}`,
 *       'X-Organization-Id': cfg.PRODUCTIVE_ORG_ID,
 *     };
 *   }
 */
export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------------
// Step 4 - Export the getConfig factory
// ---------------------------------------------------------------------------

/**
 * Validates process.env against {@link configSchema} and returns a
 * fully-typed {@link Config} object.
 *
 * @throws {Error} If any required environment variable is missing or fails
 *   its validation constraint. The detailed Zod error report is written to
 *   stderr before the error is thrown so that operators can diagnose the
 *   problem without needing to attach a debugger.
 *
 * @example
 *   import { getConfig } from './config/index.js';
 *
 *   const cfg = getConfig();
 *   // cfg.PRODUCTIVE_API_TOKEN    - guaranteed non-empty string
 *   // cfg.PRODUCTIVE_ORG_ID       - guaranteed non-empty string
 *   // cfg.PRODUCTIVE_USER_ID      - string | undefined
 *   // cfg.PRODUCTIVE_API_BASE_URL - valid URL string with default applied
 *
 * @returns A validated {@link Config} object.
 */
export function getConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    // Write the full Zod error tree to stderr so it appears in server logs
    // without polluting the MCP stdout stream.
    console.error(
      '[productive-mcp] Configuration validation failed:',
      result.error.format(),
    );

    throw new Error(
      'Invalid configuration. Please check your environment variables.\n' +
        'Required: PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID\n' +
        'Optional: PRODUCTIVE_USER_ID, PRODUCTIVE_API_BASE_URL',
    );
  }

  return result.data;
}
