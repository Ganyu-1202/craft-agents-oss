import { basename, isAbsolute, resolve } from 'node:path';

interface RegisteredWorkspace { id: string; rootPath: string; remoteServer?: unknown }
function sourceAlias(workspace: RegisteredWorkspace): string | null {
  if (workspace.remoteServer || !isAbsolute(workspace.rootPath)) return null;
  const raw = basename(workspace.rootPath);
  const canonical = basename(resolve(workspace.rootPath));
  return raw && raw === canonical ? raw : null;
}

/** Source credentials retain their existing root-basename namespace. */
export function sourceCredentialWorkspaceId(workspaceId: string, workspaces: readonly RegisteredWorkspace[]): string | null {
  const workspace = workspaces.find(item => item.id === workspaceId && !item.remoteServer);
  if (!workspace) return null;
  const alias = sourceAlias(workspace);
  const owners = workspaces.filter(item => sourceAlias(item) === alias);
  return alias && owners.length === 1 ? alias : null;
}

export function workspaceForSourceCredentialId(alias: string, workspaces: readonly RegisteredWorkspace[]): RegisteredWorkspace | undefined {
  const owners = workspaces.filter(item => sourceAlias(item) === alias);
  return owners.length === 1 ? owners[0] : undefined;
}
