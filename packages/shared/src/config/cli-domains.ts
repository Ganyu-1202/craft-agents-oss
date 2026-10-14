export type CliDomainNamespace = 'label' | 'source' | 'skill' | 'automation' | 'permission' | 'theme'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  label: {
    namespace: 'label',
    helpCommand: 'tokenbird label --help',
    workspacePathScopes: ['labels/**'],
    readActions: ['list', 'get', 'auto-rule-list', 'auto-rule-validate'],
    quickExamples: [
      'tokenbird label list',
      'tokenbird label create --name "Bug" --color "accent"',
      'tokenbird label update bug --json \'{"name":"Bug Report"}\'',
    ],
    bashGuardPaths: ['labels/**'],
  },
  source: {
    namespace: 'source',
    helpCommand: 'tokenbird source --help',
    workspacePathScopes: ['sources/**'],
    readActions: ['list', 'get', 'validate', 'test', 'auth-help'],
    quickExamples: [
      'tokenbird source list',
      'tokenbird source get <slug>',
      'tokenbird source update <slug> --json "{...}"',
      'tokenbird source validate <slug>',
    ],
  },
  skill: {
    namespace: 'skill',
    helpCommand: 'tokenbird skill --help',
    workspacePathScopes: ['skills/**'],
    readActions: ['list', 'get', 'validate', 'where'],
    quickExamples: [
      'tokenbird skill list',
      'tokenbird skill get <slug>',
      'tokenbird skill update <slug> --json "{...}"',
      'tokenbird skill validate <slug>',
    ],
  },
  automation: {
    namespace: 'automation',
    helpCommand: 'tokenbird automation --help',
    workspacePathScopes: ['automations.json', 'automations-history.jsonl'],
    readActions: ['list', 'get', 'validate', 'history', 'last-executed', 'test', 'lint'],
    quickExamples: [
      'tokenbird automation list',
      'tokenbird automation create --event UserPromptSubmit --prompt "Summarize this prompt"',
      'tokenbird automation update <id> --json "{\"enabled\":false}"',
      'tokenbird automation history <id> --limit 20',
      'tokenbird automation validate',
    ],
    bashGuardPaths: ['automations.json', 'automations-history.jsonl'],
  },
  permission: {
    namespace: 'permission',
    helpCommand: 'tokenbird permission --help',
    workspacePathScopes: ['permissions.json', 'sources/*/permissions.json'],
    readActions: ['list', 'get', 'validate'],
    quickExamples: [
      'tokenbird permission list',
      'tokenbird permission get --source linear',
      'tokenbird permission add-mcp-pattern "list" --comment "All list ops" --source linear',
      'tokenbird permission validate',
    ],
    bashGuardPaths: ['permissions.json', 'sources/*/permissions.json'],
  },
  theme: {
    namespace: 'theme',
    helpCommand: 'tokenbird theme --help',
    workspacePathScopes: ['config.json', 'theme.json', 'themes/*.json'],
    readActions: ['get', 'validate', 'list-presets', 'get-preset'],
    quickExamples: [
      'tokenbird theme get',
      'tokenbird theme list-presets',
      'tokenbird theme set-color-theme nord',
      'tokenbird theme set-workspace-color-theme default',
      'tokenbird theme set-override --json "{\"accent\":\"#3b82f6\"}"',
    ],
    bashGuardPaths: ['config.json', 'theme.json', 'themes/*.json'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by tokenbird CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const TOKENBIRD_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const TOKENBIRD_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for tokenbird CLI owned paths.
 */
export const TOKENBIRD_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const TOKENBIRD_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only tokenbird bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getTokenBirdAgentReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `^tokenbird\\s+${namespace}\\s+(${actions})\\b`,
      comment: `tokenbird ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: '^tokenbird\\s*$', comment: 'tokenbird bare invocation (prints help)' },
    { pattern: `^tokenbird\\s+(${namespaceAlternation})\\s*$`, comment: 'tokenbird entity help' },
    { pattern: `^tokenbird\\s+(${namespaceAlternation})\\s+--help\\b`, comment: 'tokenbird entity help flags' },
    { pattern: '^tokenbird\\s+--(help|version|discover)\\b', comment: 'tokenbird global flags' },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
