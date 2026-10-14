/**
 * @tokenbird/shared
 *
 * Shared business logic for TokenBird.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { TokenBirdAgent } from '@tokenbird/shared/agent';
 *   import { loadStoredConfig } from '@tokenbird/shared/config';
 *   import { getCredentialManager } from '@tokenbird/shared/credentials';
 *   import { TokenBirdMcpClient } from '@tokenbird/shared/mcp';
 *   import { debug } from '@tokenbird/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@tokenbird/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@tokenbird/shared/workspaces';
 *
 * Available modules:
 *   - agent: TokenBirdAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: TokenBird API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
