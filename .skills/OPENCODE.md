## OpenCode Documentation Reference

We use [OpenCode](https://opencode.ai) as our AI coding agent. If asked about an OpenCode feature, do a webfetch and lookup the information from the docs.

Here are the key documentation links:

**Getting Started**

- [Intro / Overview](https://opencode.ai/docs) – Getting started guide
- [Config](https://opencode.ai/docs/config) – JSON config reference
- [Providers](https://opencode.ai/docs/providers) – LLM provider setup
- [Network](https://opencode.ai/docs/network) – Network configuration
- [Enterprise](https://opencode.ai/docs/enterprise) – Enterprise features
- [Troubleshooting](https://opencode.ai/docs/troubleshooting) – Common issues
- [Migrating to 1.0](https://opencode.ai/docs/1-0) – Migration guide

**Usage Modes**

- [TUI](https://opencode.ai/docs/tui) – Terminal user interface
- [CLI](https://opencode.ai/docs/cli) – Command-line interface
- [IDE](https://opencode.ai/docs/ide) – IDE extension support
- [Zen](https://opencode.ai/docs/zen) – Curated model selection
- [Share](https://opencode.ai/docs/share) – Sharing conversations
- [GitHub](https://opencode.ai/docs/github) – GitHub integration
- [GitLab](https://opencode.ai/docs/gitlab) – GitLab integration

**Configuration**

- [Tools](https://opencode.ai/docs/tools) – Built-in tools (bash, edit, write, read, grep, glob, list, patch, etc.)
- [Rules](https://opencode.ai/docs/rules) – Custom rules
- [Agents](https://opencode.ai/docs/agents) – Agent configuration
- [Models](https://opencode.ai/docs/models) – Model configuration
- [Themes](https://opencode.ai/docs/themes) – UI themes
- [Keybinds](https://opencode.ai/docs/keybinds) – Keyboard shortcuts
- [Commands](https://opencode.ai/docs/commands) – Custom commands
- [Formatters](https://opencode.ai/docs/formatters) – Code formatters
- [Permissions](https://opencode.ai/docs/permissions) – Permission settings
- [LSP Servers](https://opencode.ai/docs/lsp) – Language Server Protocol
- [MCP servers](https://opencode.ai/docs/mcp-servers) – Model Context Protocol servers
- [ACP Support](https://opencode.ai/docs/acp) – Agent Context Protocol
- [Agent Skills](https://opencode.ai/docs/skills) – Skill definitions
- [Custom Tools](https://opencode.ai/docs/custom-tools) – Creating custom tools

**Development & API**

- [SDK](https://opencode.ai/docs/sdk) – TypeScript SDK
- [Server](https://opencode.ai/docs/server) – HTTP server API (OpenAPI 3.1 spec at `/doc`)
- [Plugins](https://opencode.ai/docs/plugins) – Plugin development
- [Ecosystem](https://opencode.ai/docs/ecosystem) – Third-party integrations

**File Locations**

Config:

- Global: `~/.config/opencode/config.json`
- Per-project: `.opencode/config.json`
- Schema: `https://opencode.ai/config.json`

Agents (markdown files, filename = agent name):

- Global: `~/.config/opencode/agent/`
- Per-project: `.opencode/agent/`

Custom Tools (JS/TS files, filename = tool name):

- Global: `~/.config/opencode/tool/`
- Per-project: `.opencode/tool/`
