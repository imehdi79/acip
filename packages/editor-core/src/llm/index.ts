/**
 * LLM-facing projections (Layer 3): the command registry as an agent tool
 * catalog, and the document as an LLM-legible digest. Agent packages consume
 * these through the SDK barrel — core never talks to a model itself.
 */
export type { ToolDefinition } from './tool-defs.js';
export { toolDefinitions, toolNameFromCommand, commandNameFromTool } from './tool-defs.js';
export type { DescribeDocumentOptions } from './doc-context.js';
export { describeDocument } from './doc-context.js';
