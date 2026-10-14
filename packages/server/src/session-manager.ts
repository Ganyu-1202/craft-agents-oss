import { SessionManager } from '@tokenbird/server-core/sessions';

/** Named credentials belong to the execution host, including headless servers. */
export function createHeadlessSessionManager(): SessionManager {
  const manager = new SessionManager();
  manager.setLocalCredentialAccessEnabled(true);
  return manager;
}
