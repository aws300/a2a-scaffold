---
name: example-skill
description: A sample skill demonstrating the AgentSkills.io directory format.
---

# Example Skill

This is an example skill for the A2A Scaffold. Replace this with your own skills.

## How to Create a Skill

1. Create a directory under `agent-config/skills/` with your skill name (kebab-case):
   ```
   agent-config/skills/my-skill/
   ```

2. Add a `SKILL.md` file with YAML frontmatter:
   ```markdown
   ---
   name: my-skill
   description: What this skill does
   ---

   Instructions for the AI agent...
   ```

3. Optionally add resource directories:
   ```
   my-skill/
   ├── SKILL.md
   ├── scripts/        ← Helper scripts the agent can execute
   ├── references/     ← Reference documents the agent can read
   └── templates/      ← Template files the agent can use
   ```

4. The skill will be auto-detected on next startup.
