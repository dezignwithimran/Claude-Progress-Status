---
description: Turn on the task-progress and context-token status line
allowed-tools: Bash(node:*)
---

Run this command and report its output to the user in one or two short lines:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" install
```

If it saved a previous statusLine, mention that `/progress-status:remove` will restore it. Tell the user they can change bar width, colors and which parts appear in `~/.claude/progress-status/config.json`.
