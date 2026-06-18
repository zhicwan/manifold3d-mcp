# Security Policy

## Supported versions

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

## Reporting a vulnerability

If you discover a security vulnerability, please report it responsibly:

- **Email**: [imwosz@hotmail.com](mailto:imwosz@hotmail.com)
- **GitHub Security Advisory**: [Create an advisory](https://github.com/zhicwan/manifold3d-mcp/security/advisories/new)

We will acknowledge your report within **72 hours** and aim to provide a fix
or mitigation plan within **14 days**.

Please do **not** open a public issue for security vulnerabilities.

## Security model

manifold3d-mcp is an MCP server that executes LLM-generated TypeScript snippets.
The following describes the security boundaries and assumptions.

### Snippet execution

Snippets executed by `execute_script` and `validate_script` are **untrusted
code**. The isolation mechanisms are defense-in-depth, not a hardened sandbox:

- Each snippet runs in a dedicated `worker_threads` Worker.
- A **5-second timeout** kills the worker if exceeded.
- A **512 MB hard heap limit** (`maxOldGenerationSizeMb`) triggers
  `OUT_OF_MEMORY` termination.
- Static lint catches common API mistakes but is **not** a security boundary.

### File access

- `MANIFOLD_MCP_SCRIPT_ROOTS` restricts which directories `filePath`-based
  scripts may be loaded from. Default: CWD + `samples/`.
- **Never** grant the server access to directories containing credentials,
  secrets, or sensitive data.

### Network and telemetry

- The live preview server binds to **loopback (localhost) only**.
- No telemetry, analytics, or outbound network calls are made.
