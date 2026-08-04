# Dev-server TLS certs (mkcert)

These certs let the Vite dev server run over **HTTPS**, which Safari requires before it will register
a service worker or grant OPFS / `navigator.storage.persist()`. Without them the till loads over
plain HTTP on the LAN, the SW never registers, and "Add to Home Screen" produces a dead shortcut — so
the Sprint 1 on-device storage-durability testing is impossible.

`dev.pem` (certificate) and `dev-key.pem` (private key) are **git-ignored and machine-specific** — they
are signed by *your* local mkcert CA, which no other machine trusts. Regenerate them per machine; never
commit them. This README is the only file in `certs/` that is tracked.

## Regenerate

```bash
brew install mkcert            # once, if not installed
mkcert -install                # once — adds your local CA to the system trust store (needs sudo)

# From the repo root. Re-detect your values:
#   .local host : scutil --get LocalHostName   → append .local
#   LAN IP      : ipconfig getifaddr en0       (or the active interface: route get default)
mkcert -cert-file apps/till/certs/dev.pem -key-file apps/till/certs/dev-key.pem \
  "$(scutil --get LocalHostName).local" localhost 127.0.0.1 "$(ipconfig getifaddr en0)" ::1
```

Then `pnpm --filter @batch/till dev` and open `https://<your-host>.local:5173` or
`https://<lan-ip>:5173`. If the certs are absent, Vite falls back to HTTP with a warning (fine for a
laptop-only run; not for on-device testing).

## Trust the CA — on the Mac AND the iPad

The cert only works where the mkcert **root CA** is installed *and trusted*. Generating the cert is not
enough on its own.

**Mac:** `mkcert -install` (needs your password). If it failed with a sudo/password error, re-run it in
a terminal where you can enter the password.

**iPad (required for on-device testing — do all three):**
1. Find the root CA: `mkcert -CAROOT` → `rootCA.pem` lives there
   (`/Users/evansullivan/Library/Application Support/mkcert/rootCA.pem` on this machine).
2. Get `rootCA.pem` onto the iPad (AirDrop or email it) and open it → **Settings → General → VPN &
   Device Management → install the profile.**
3. **Enable full trust:** Settings → General → About → **Certificate Trust Settings** → toggle the
   mkcert CA **on.** iOS silently distrusts the cert until you do this last step — the most common
   "it still says not secure" cause.

The iPad and Mac must be on the **same Wi-Fi/LAN**, and that network must not use client isolation
(guest networks often do, blocking iPad→Mac connections).
