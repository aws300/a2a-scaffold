"""
Built-in connector skills — injected into agent system prompt when
an APP connector (GitHub, GitLab) is selected.

These are hidden skills that tell the Agent how to use get_connector_token()
and how to interact with the connected service.
"""

GITHUB_CONNECTOR_SKILL = {
    "id": "github-connector",
    "name": "GitHub Connector",
    "description": "Use GitHub API and git operations via the connected GitHub account",
    "content": """# GitHub Connector

You have access to GitHub through the user's connected GitHub account.

## Getting Authentication

Call `get_connector_token(connector_id="{connector_id}")` to get the current user's GitHub Personal Access Token.

The function returns a dict:
- `token`: GitHub PAT (ghp_xxx or github_pat_xxx)
- `username`: GitHub username
- `status`: "connected" or error info

## Git Operations

For HTTPS git clone/push/pull, embed the token in the URL:
```bash
git clone https://x-access-token:$TOKEN@github.com/OWNER/REPO.git
```

Or set environment variables before git operations:
```bash
export GITHUB_TOKEN=$TOKEN
export GH_TOKEN=$TOKEN
```

## GitHub REST API

Use `http_request` tool with:
```
GET https://api.github.com/repos/OWNER/REPO
Authorization: Bearer $TOKEN
Accept: application/vnd.github+json
```

Common API endpoints:
- `GET /user` — current user info
- `GET /repos/{owner}/{repo}` — repo details
- `GET /repos/{owner}/{repo}/issues` — list issues
- `POST /repos/{owner}/{repo}/issues` — create issue
- `GET /repos/{owner}/{repo}/pulls` — list pull requests

## Important Rules
- NEVER print, log, or include the token in your response text
- Get the token fresh each time you need it (don't cache it)
- Use the `shell` tool to run git commands
- Always use HTTPS URLs, never SSH
""",
}

GITLAB_CONNECTOR_SKILL = {
    "id": "gitlab-connector",
    "name": "GitLab Connector",
    "description": "Use GitLab API and git operations via the connected GitLab account",
    "content": """# GitLab Connector

You have access to GitLab through the user's connected GitLab account.
This works with both gitlab.com and self-hosted GitLab instances.

## Getting Authentication

Call `get_connector_token(connector_id="{connector_id}")` to get the current user's GitLab credentials.

The function returns a dict:
- `token`: GitLab PAT (glpat-xxx)
- `base_url`: GitLab instance URL (e.g. "https://gitlab.com" or "https://gitlab.company.com")
- `username`: GitLab username
- `status`: "connected" or error info

## CRITICAL: Always Use base_url

The `base_url` may be a self-hosted GitLab instance. ALWAYS use it for:
- Git clone URLs: `https://oauth2:$TOKEN@{base_url_host}/group/project.git`
- API calls: `{base_url}/api/v4/...`

## Git Operations

```bash
# Extract host from base_url
# e.g. base_url = "https://gitlab.company.com" → host = "gitlab.company.com"
git clone https://oauth2:$TOKEN@$HOST/NAMESPACE/PROJECT.git
```

## GitLab REST API

Use `http_request` tool with:
```
GET {base_url}/api/v4/projects
PRIVATE-TOKEN: $TOKEN
```

Common API endpoints:
- `GET /api/v4/user` — current user
- `GET /api/v4/projects?membership=true` — user's projects
- `GET /api/v4/projects/:id/merge_requests` — list MRs
- `POST /api/v4/projects/:id/issues` — create issue
- `GET /api/v4/projects/:id/repository/tree` — list files

## Important Rules
- NEVER print, log, or include the token in your response text
- ALWAYS use `base_url` from get_connector_token — do NOT hardcode gitlab.com
- Get the token fresh each time (don't cache)
- Use `shell` tool for git commands
- Use HTTPS URLs, never SSH
""",
}

# Map: app_type → skill template
CONNECTOR_SKILLS = {
    "github": GITHUB_CONNECTOR_SKILL,
    "gitlab": GITLAB_CONNECTOR_SKILL,
}


def get_connector_skill(app_type: str, connector_id: str) -> dict | None:
    """Get the built-in skill for a connector, with connector_id templated in.

    Args:
        app_type: "github" or "gitlab"
        connector_id: The actual connector ID (e.g. "connector-github")

    Returns:
        Skill dict {id, name, description, content} or None
    """
    template = CONNECTOR_SKILLS.get(app_type)
    if not template:
        return None

    skill = dict(template)
    # Template the connector_id into the skill content
    skill["content"] = skill["content"].replace("{connector_id}", connector_id)
    return skill
