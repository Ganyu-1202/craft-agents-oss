export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/tokenbird',
    '/Users/demo/projects/tokenbird/apps/electron',
    '/Users/demo/projects/tokenbird/packages/shared',
  ],
  many: [
    '/Users/demo/projects/tokenbird',
    '/Users/demo/projects/tokenbird/apps/electron',
    '/Users/demo/projects/tokenbird/apps/cli',
    '/Users/demo/projects/tokenbird/packages/shared',
    '/Users/demo/projects/tokenbird/packages/server-core',
    '/Users/demo/projects/tokenbird/packages/pi-agent-server',
    '/Users/demo/projects/tokenbird/packages/ui',
    '/Users/demo/projects/tokenbird/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
