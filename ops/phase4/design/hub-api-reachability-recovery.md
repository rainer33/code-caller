# Hub API Reachability Recovery - 2026-08-17

## Context

The highest-priority incomplete non-screen backlog item is deployed Hub API
reachability recovery. The 2026-08-16 QA cycle reported that
`http://172.30.1.83:3000/servers` timed out from the Mac and
`http://100.92.64.11:3000/servers` refused the connection.

## Findings

- The Hub host is reachable over Tailscale as `100.92.64.11`.
- The Hub process is active and listening on `*:3000` on the Ubuntu host.
- From the Ubuntu host, `http://127.0.0.1:3000/servers` returns HTTP 401.
- From the Mac, `http://100.92.64.11:3000/servers` returns HTTP 401.
- From the Mac, `http://172.30.1.83:3000/servers` still times out.
- The Mac is currently on `192.168.0.101`, and its route to `172.30.1.83`
  goes through the Tailscale interface rather than a direct `172.30.1.0/24`
  LAN interface.

## Decision

Keep `172.30.1.83` as the primary Hub URL for environments where that LAN path
works, and add `100.92.64.11` as a fallback deployment URL for REST and
Socket.io. This recovers the live Hub path without changing the backend service
or requiring router/Tailscale subnet-route policy changes from a headless run.

## Implementation

- Mobile app stores an active Hub base URL and uses it for REST requests.
- Network failures on the primary URL retry the same request on the fallback
  URL before surfacing an error.
- Login, refresh, authenticated API requests, logout, and Socket.io use the
  active base URL.
- Android release cleartext config allows both deployment IPs.

## Verification

- `curl --max-time 5 http://100.92.64.11:3000/servers` returns HTTP 401.
- Remote SSH check confirms `hub-api` is active and listening on `*:3000`.
- Remote local curl to `127.0.0.1:3000/servers` returns HTTP 401.
- `curl --max-time 5 http://172.30.1.83:3000/servers` still times out from the
  current Mac network route and remains documented as LAN/subnet-route specific.
- Mobile TypeScript and Android release build must pass before completion.
