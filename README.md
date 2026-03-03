# Arelis AI Governance SDK Plugin for Claude Code

A Claude Code plugin that provides AI governance capabilities through the [Arelis AI Governance SDK](https://api.arelis.digital). Supports both TypeScript (`@arelis-ai/ai-governance-sdk`) and Python (`ai-governance-sdk`).

## What's included

- **AI Governance SDK Skill** — Claude automatically assists with governed AI orchestration: `createArelis`/`create_arelis`, `governedInvoke`/`governed_invoke`, `agents.run`, governance gates, PII management, policy engines, audit events, risk scoring, compliance proofs, and more.
- **Arelis MCP Server** — Connects Claude to the Arelis Platform API for live governance operations (policy management, event creation, risk evaluation, proofs, replays).

## Prerequisites

- [Claude Code](https://claude.com/claude-code) v1.0.33 or later
- An Arelis Platform API key (get one at [api.arelis.digital](https://api.arelis.digital))

## Installation

### From a marketplace

```bash
claude plugin install arelis-sdk@<marketplace-name>
```

### Local development

```bash
claude --plugin-dir /path/to/ai-governance-plugin
```

## Configuration

Set your Arelis API key as an environment variable before launching Claude Code:

```bash
export ARELIS_API_KEY=ak_your_api_key_here
```

The plugin's MCP server reads `ARELIS_API_KEY` from the environment. The platform base URL defaults to `https://api.arelis.digital`.

## Usage

Once installed, the plugin activates automatically when Claude detects:

- Imports from `@arelis-ai/ai-governance-sdk` or `from arelis import ...`
- References to `createArelis`, `create_arelis`, `governedInvoke`, `governed_invoke`, `withGovernanceGate`, `with_governance_gate`, or `GovernanceContext`
- Questions about the AI Governance SDK

### Skill namespace

All skills are namespaced under `arelis-sdk`:

```
/arelis-sdk:ai-governance-sdk
```

### MCP tools

The Arelis MCP server provides tools for:

- AI system registration and management
- Governance policy CRUD and evaluation
- Platform event creation and querying
- Risk evaluation and simulation
- Compliance proof generation and verification
- Causal graph operations
- Quota management

## SDK coverage

| Feature | TypeScript | Python |
|---------|-----------|--------|
| `createArelis` / `create_arelis` | Yes | Yes |
| `governedInvoke` / `governed_invoke` | Yes | Yes |
| `agents.run` (governed agent loop) | Yes | Yes |
| Governance gates | Yes | Yes |
| PII scanning and managed config | Yes | Yes |
| Platform events and risk | Yes | Yes |
| Policy engine (local + platform) | Yes | Platform only |
| Causal graphs and proofs | Yes | Yes |
| MCP, RAG, memory, quotas | Yes | Yes |

## Project structure

```
ai-governance-plugin/
├── .claude-plugin/
│   └── plugin.json            # Plugin manifest
├── skills/
│   └── ai-governance-sdk/
│       ├── SKILL.md            # Skill definition
│       ├── references/         # SDK documentation
│       │   ├── typescript/     # TS patterns, API refs, examples
│       │   ├── python/         # Python patterns, API refs, examples
│       │   └── shared/         # Platform API, policies, concepts
│       └── scripts/            # Validation scripts
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE) for details.
