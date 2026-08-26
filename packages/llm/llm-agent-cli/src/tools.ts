/**
 * Harness tool schemas presented to the vendor CLI as one in-process MCP
 * server, and the name mapping that presentation forces.
 *
 * @module @centurionarx/cxh-llm-agent-cli/tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolSchema } from '@centurionarx/cxh-llm'

/**
 * Server name the CLI uses to namespace these tools. It is part of every name
 * the model sees, so changing it changes model-visible text.
 */
export const MCP_SERVER_NAME = 'cxh'

const ALIAS_PREFIX = `mcp__${MCP_SERVER_NAME}__`

/**
 * Render one harness tool name as the CLI presents it to the model.
 * @param name - tool name as the harness registered it.
 * @returns the namespaced name the model will emit in a tool call.
 */
export function toolAlias(name: string): string {
  return `${ALIAS_PREFIX}${name}`
}

/**
 * Recover the harness tool name from what the model emitted. A name without
 * the prefix is returned unchanged: the CLI's own built-ins are refused by
 * name elsewhere, and silently rewriting an unexpected name would hide which
 * tool the model actually asked for.
 * @param alias - tool name as it arrived from the model.
 * @returns the harness tool name.
 */
export function harnessToolName(alias: string): string {
  return alias.startsWith(ALIAS_PREFIX) ? alias.slice(ALIAS_PREFIX.length) : alias
}

/**
 * Serve the request's tool schemas over MCP, verbatim.
 *
 * The schemas are JSON Schema because that is what the model sees everywhere
 * else in this harness. The SDK's own `tool()` helper takes a Zod shape and
 * would force a lossy translation of every tool the harness registers, so
 * this answers `tools/list` from the low-level server instead.
 * @param tools - tool schemas assembled for this request.
 * @returns an MCP server instance the SDK can mount in-process.
 */
export function createToolServer(tools: readonly ToolSchema[]): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as { type: 'object' },
      // Without this the CLI defers MCP tools behind its own tool-search tool,
      // so the model spends its turn searching for a tool the harness already
      // put in the request. The harness assembles the whole tool list itself;
      // there is nothing here to discover.
      _meta: { 'anthropic/alwaysLoad': true },
    })),
  }))
  // The harness executes every tool itself, so a call reaching this server
  // means permission refusal did not hold. Failing states that; answering
  // would let the CLI run a turn the harness never saw.
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    throw new Error(
      `llm-agent-cli: the CLI tried to execute ${request.params.name}; this adapter never executes tools`,
    )
  })
  return server
}
