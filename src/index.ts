#!/usr/bin/env node
/**
 * @file index.ts
 * @description Entry point for the productive-mcp MCP (Model Context Protocol) server.
 *
 * This file is intentionally minimal. Its sole responsibility is to bootstrap the
 * application by calling `createServer()` and handling any top-level errors that
 * occur during startup. All server logic — tool registration, prompt registration,
 * API client initialisation, and request handling — lives in `./server.ts`.
 *
 * ## How it fits into the project
 *
 * The project follows a layered architecture:
 *
 *   index.ts          ← You are here. Process entry point & error boundary.
 *   └── server.ts     ← MCP Server setup: registers tools, prompts, and handlers.
 *       ├── api/      ← ProductiveAPIClient — thin wrapper around the Productive.io REST API.
 *       ├── config/   ← Reads environment variables (API key, org ID, user ID, etc.).
 *       ├── tools/    ← One file per resource group (tasks, projects, boards, …).
 *       │              Each file exports a tool *definition* (JSON Schema) and a tool
 *       │              *handler* function that calls the API client and formats the result.
 *       └── prompts/  ← Reusable prompt templates (e.g. timesheet helpers).
 *
 * ## Startup sequence
 *
 *   1. Node.js executes this file (shebang line makes it directly executable as a CLI).
 *   2. `main()` is called immediately via the trailing `.catch()` guard.
 *   3. `createServer()` (server.ts) is awaited:
 *      a. Reads config from environment variables.
 *      b. Instantiates the MCP `Server` with capability declarations.
 *      c. Instantiates `ProductiveAPIClient` with the resolved config.
 *      d. Registers `ListTools`, `CallTool`, `ListPrompts`, and `GetPrompt` request handlers.
 *      e. Connects the server to a `StdioServerTransport` so that an MCP host
 *         (e.g. Claude Desktop) can communicate with it over stdin/stdout.
 * 4. Once connected, the process stays alive and responds to JSON-RPC messages
 *    from the host until the host closes the connection.
 *
 * ## Error handling
 *
 * Two layers of error handling are in place:
 *
 *   - The `try/catch` inside `main()` catches errors thrown synchronously or via
 *     rejected promises during server initialisation (e.g. missing API key, failed
 *     transport connection). These are logged to stderr and the process exits with
 *     code 1 so the host knows the server failed to start.
 *
 *   - The `.catch()` on the `main()` call is a safety net for any unhandled
 *     promise rejection that somehow escapes the inner try/catch. It performs the
 *     same stderr log + exit(1) behaviour.
 *
 * Note: After `server.connect(transport)` returns, stdout is exclusively owned by
 * the MCP protocol (newline-delimited JSON-RPC). Writing anything else to stdout
 * after that point would corrupt the protocol stream, which is why all diagnostic
 * output uses `console.error` (stderr).
 */
import { createServer } from './server.js';

/**
 * main - Asynchronous bootstrap function.
 *
 * Calls `createServer()` and awaits its completion. If anything goes wrong during
 * initialisation an error is printed to stderr and the process terminates with a
 * non-zero exit code so that process supervisors and MCP hosts can detect the
 * failure.
 */
async function main() {
  try {
    // Delegate all server construction and connection logic to server.ts.
    // `createServer()` resolves once the MCP server is connected to the stdio
    // transport and ready to accept requests from the host.
    await createServer();
  } catch (error) {
    // Log to stderr — stdout must remain clean for the MCP JSON-RPC protocol.
    console.error('Failed to start server:', error);
    // Exit with a non-zero code so the host / process manager knows startup failed.
    process.exit(1);
  }
}

// Invoke main() and attach a top-level rejection handler as a final safety net.
// This catches any unhandled promise rejections that escape the try/catch above
// (e.g. an async operation that rejects after `createServer()` has resolved but
// before the process has fully settled).
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
