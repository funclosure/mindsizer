#!/usr/bin/env bash
# Run a command with this cloud session's Claude Code session/remote env vars removed, so the
# Agent SDK's child `claude` processes don't attach to (or post into) the parent session.
# Auth-related vars (token file, base URL, org/account) are kept.
keep='^(CLAUDE_SESSION_INGRESS_TOKEN_FILE|CLAUDE_CODE_ORGANIZATION_UUID|CLAUDE_CODE_ACCOUNT_UUID|CLAUDE_CODE_USER_EMAIL|ANTHROPIC_.*)$'
unset_args=()
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDE|ANTHROPIC|SESSION_INGRESS)'); do
  [[ "$v" =~ $keep ]] || unset_args+=("-u" "$v")
done
exec env "${unset_args[@]}" "$@"
