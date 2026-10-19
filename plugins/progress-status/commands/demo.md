---
description: Preview the status line colors with sample values (toggle, or pass on/off)
argument-hint: "[on|off]"
allowed-tools: Bash(node:*)
---

Run this command and report its output to the user in one or two short lines:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" demo $ARGUMENTS
```

When demo mode is turned on, tell the user to send a few short messages (for example "next") and watch the bar at the bottom: it goes from green (25%) to yellow (60%) to red (85%, then 95%) while the task bar fills 1/4 → 4/4. Remind them that `/progress-status:demo off` returns to real data.
