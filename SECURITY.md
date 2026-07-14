# Security Policy — Shinobi Launcher

## Supported Versions

| Version | Supported | Status |
|---------|-----------|--------|
| 3.6.x   | ✅        | Active development |
| 3.5.x   | ✅        | Maintenance |
| < 3.5   | ❌        | End of life |

## Known Security Considerations

### Electron 11.5.0 (EOL)

Electron 11.5.0 is End-of-Life. We use it because it's the **last version with Pepper Flash PPAPI support**. Flash is required by Naruto Online (Oasgames).

**Mitigations:**
- `--no-sandbox` is required for PPAPI injection (documented limitation)
- `--always-authorize-plugins` ensures Flash loads without user interaction
- Network requests are filtered by `network/blocker.js` (tracker blocking)
- CSP headers are injected per-session via `network/cookies.js`
- `contextIsolation: true` and `nodeIntegration: false` on all game windows

**Risk:** Chromium 87 vulnerabilities exist but the launcher only loads `narutowebgame.com` (trusted game domain). No arbitrary browsing is possible.

### Vault Key Derivation (v3.6)

Credentials are encrypted with AES-256-GCM. The key is derived via:
```
key = PBKDF2(machineSeed, salt, 100000, 'sha512', 32)
machineSeed = hostname + username + userDataPath + version
salt = 32 random bytes (persisted in vault.salt, unique per installation)
```

**Before v3.6:** Key was `SHA-256(hostname+username+userDataPath)` — deterministic, no salt. Now uses PBKDF2 with random salt.

### Auto-Login (v3.6)

Credentials are sent via **POST** to `passport.oasgames.com` (not GET). This prevents exposure in:
- Server access logs
- Browser history
- HTTP Referer headers

**Fallback:** If POST fails, MutationObserver injects credentials directly into the DOM form (never exposed in network traffic).

### Telemetry

Crash reports are sanitized before sending:
- Paths are redacted (`/home/user/` → `/home/[user]/`)
- Tokens are redacted (40+ hex chars → `[token-redacted]`)
- Emails are redacted
- No cookies, credentials, or game data are collected

Reports are sent to a Vercel serverless function which creates GitHub issues. The GitHub token is **never** in the client code — it lives only as a Vercel environment variable.

## AI Evolution Branch

The `ai-evolve` branch is used by the autonomous AI cron (`scripts/ai-cron.js`).
- **Never merged to `main` without human review.**
- All changes are atomic (1 fix per commit) with automatic rollback on failure.
- `git checkout -- .` is used if `npm run lint` or `npm test` fails.
- The branch is isolated — no force push to `main` is ever automated.

## Reporting a Vulnerability

Email: security@chrispsz.dev (or open a private security advisory on GitHub)

Response time: 48h
