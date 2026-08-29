# YouTube authentication reliability testing

Tubify includes a reliability suite for the YouTube authentication lifecycle. The suite is safe by default: deterministic token tests use injected mock provider behavior, and authenticated HTTP tests run only when an explicit test base URL and session cookie are supplied.

## Run deterministic checks only

```bash
npm run test:youtube-auth
```

Without environment variables, the suite runs the token lifecycle tests and skips browser-session HTTP checks. The deterministic checks cover:

- Reusing an access token that remains safely valid.
- Refreshing an expired access token.
- Persisting the refreshed ciphertext and expiry timestamp.
- Marking a channel `reauth_required` when Google rejects the refresh token.
- Classifying Google 400/401 refresh failures as reauthentication failures.

## Run authenticated HTTP checks

Use a disposable test account or an approved non-production session. Do not commit these values or place them in `.env.example`.

```bash
YRO_E2E_BASE_URL=http://localhost:5173 \
YRO_E2E_SESSION_COOKIE='sb-...=...' \
YRO_E2E_CHANNEL_IDS='channel-row-uuid-1,channel-row-uuid-2' \
npm run test:youtube-auth
```

The HTTP checks cover:

- Unauthenticated channel requests return HTTP 401.
- Authenticated channel inventory returns safe public fields only and never token ciphertext or client secrets.
- Authenticated requests scoped to a channel return that requested owned channel.
- Two connected channels can be selected independently without cross-channel responses.
- OAuth start requires a session and redirects to Google when configuration is present.
- OAuth callback rejects a missing or mismatched state without exchanging the authorization code.
- Disconnect rejects malformed IDs before any database mutation.

The suite intentionally does not delete a real channel, modify YouTube metadata, or exchange a real OAuth code. A successful HTTP test confirms request/session behavior, not that a disposable Google grant can be revoked and renewed automatically.

## Live-account limitations

A complete live OAuth test requires a dedicated test Google account or explicit approval to use a production account. The suite does not automate destructive production operations. Manual verification should cover connecting a channel, returning through the callback, refreshing after expiry, receiving the reconnect state after revocation, switching between at least two owned channels, and disconnecting a disposable channel.

The `YRO_E2E_CHANNEL_IDS` values are Tubify database channel-row UUIDs, not public YouTube channel IDs. The server still validates ownership through Supabase RLS for every request.
