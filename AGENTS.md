<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Security review (required for every change)

Tubify holds per-workspace financial data and runs privileged server code. Treat security as part
of every change — features, fixes, refactors, migrations, endpoints and integrations — not as a
separate pass afterwards.

Before a change is considered complete:

1. **Name the boundaries it touches**: authentication, workspace membership, workspace roles
   (owner / manager / setter / editor), platform roles (`profiles.role`), feature access,
   Revenue Visibility, and any use of the service-role client.
2. **Authorize on the server.** Hiding something in the UI is never the control. Every new or
   changed endpoint must authenticate the caller, check their role and feature access, and act
   only on the caller's own workspace. An id that is unknown or belongs to another workspace must
   get the same answer as one that does not exist.
3. **Verify workspace isolation** for every read and write the change adds, including reads made
   with the service role (which bypasses row-level security: filter by the caller's workspace
   explicitly).
4. **Review database changes.** A new table needs row-level security and deliberate grants; a new
   function is executable by `PUBLIC` unless `EXECUTE` is revoked; `SECURITY DEFINER` needs a
   fixed `search_path`. Never apply a migration, grant or revoke to production without the
   owner's explicit approval.
5. **Validate input and protect sensitive data.** Validate every request with a strict schema.
   Money (revenue, deal values, compensation) is read only through the existing server-side
   reader and is never returned to a caller who may not see it — not in totals, sorting, errors,
   exports or logs. Never print or commit secrets.
6. **Treat public write endpoints as abuse surfaces.** Anything callable without a session that
   writes data, sends email or spends quota needs a stated answer for rate limiting and spam.
7. **Add security regression tests** for the rule you relied on: the forbidden cases as well as
   the allowed ones, and that nothing is read or written when a request is refused.
8. **Run the checks**: the affected security tests, the full suite, type checking, lint and build.
9. **Report** the security findings and any remaining uncertainty alongside the functional
   results. A concern that has not been verified is reported as unverified, not as a finding.

For larger or higher-risk changes, review the whole affected data flow rather than only the
edited lines. Where it is available and appropriate, apply the Cloudflare Security Audit Skill
(<https://github.com/cloudflare/security-audit-skill.git>) as the audit framework. Referencing
the skill here does not install or run it: it must be installed in the agent's environment, with
the owner's approval, before it can be used.
