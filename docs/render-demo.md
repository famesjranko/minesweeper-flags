# Render demo

Play at [minesweeper-flags-demo.onrender.com](https://minesweeper-flags-demo.onrender.com/).
No account is needed to play. Create a room and invite a friend, or join from a
second browser session.

## Deployment

The demo runs three resources on a Hobby workspace. It uses hosted-server mode;
direct matches and the signaling service are not deployed. The root
[`render.yaml`](../render.yaml) is a reusable example with placeholder URLs.
The live demo is managed separately through Render service settings.

| Resource | Purpose | Hosting |
| --- | --- | --- |
| `minesweeper-flags-demo` | React frontend | Free static site |
| `minesweeper-flags-api` | Node WebSocket game server | Free web service, Frankfurt |
| `minesweeper-flags-state` | Redis-compatible room, match, chat, and session state | Free Key Value, Frankfurt |

Last verified on 21 October 2026:

| Service | Deployed commit | Deployment date |
| --- | --- | --- |
| Frontend | [`62a0d94`](https://github.com/famesjranko/minesweeper-flags/commit/62a0d94ccd3c94f369903bf2a397aa27868eb20a) | 21 October 2026 |
| Game server | [`64101fa`](https://github.com/famesjranko/minesweeper-flags/commit/64101fad54b1848ad400903fca51ec9baea15b34) | 21 October 2026 |

The frontend update changed only the UI; server code and the shared protocol are
identical at these commits. Both services track `main`, with auto-deploys and
previews disabled. The original Blueprint was disconnected on 21 October 2026;
its resources and settings were retained. Public template changes cannot sync
into these services. GitHub Actions runs checks and image builds; it does not
deploy to Render.

## Demo limits

- At most four rooms can exist at once. A finished match still occupies its room
  so the players can chat or rematch. When both players disconnect, the server
  allows 30 seconds for a reload or reconnect before removing the abandoned room.
- Refreshing or reopening an invite can restore a seat in the same browser while
  its saved session and room remain valid. Clearing browser storage or using a
  different browser does not transfer that seat.
- Room and chat storage is temporary. A Key Value restart erases all games and
  sessions; players must create new rooms. There are no durable match records.
- The server runs as one instance. Cross-instance fanout is not implemented.
  This setup is a portfolio demo with limited availability and capacity.

## Cost and platform limits

The configured resources have no base hosting charge. On 21 October 2026, the
workspace's included monthly allowances were:

| Shared allowance | Monthly limit |
| --- | --- |
| Free web-service runtime | 750 hours |
| Outbound bandwidth | 5 GB |
| Build pipeline | 500 minutes |

These allowances cover the whole workspace. Staying within them keeps this setup
at $0. Check Billing in the [Render dashboard](https://dashboard.render.com/)
before a release; pricing and allowances can change.

The server sleeps after 15 idle minutes and takes about a minute to wake. The
client retries automatically. Render may restart free instances at any time.
Free Key Value has 25 MB of memory, 50 connections, and no disk persistence. Its
`noeviction` policy rejects writes when memory is full.

Exhausting free runtime hours suspends free web services until the next month.
Without a payment method, bandwidth overages suspend free services and exhausted
build minutes block new builds. Existing builds remain available when only the
build allowance is exhausted. With a payment method, bandwidth and build overages
can incur charges. Avoid keep-alive jobs, paid resources, and extra preview
instances when operating this as a free demo.

See [Render's free-tier limits](https://render.com/docs/free) and
[pricing](https://render.com/pricing) for current terms.

## Forking and deploying your own copy

Forking copies the repository files. It does not provision Render resources or
give the fork access to this demo's Render workspace, credentials, or billing.
GitHub disables workflows in forks by default. If the fork owner enables them,
this repository's workflow runs checks and image builds, with no deployment job.
A pull request back to this repository can run its CI checks, subject to workflow
approval rules. See [GitHub's fork workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories).

To host a fork, create a Blueprint in your own Render workspace from your fork's
repository. The Blueprint omits `repo`, so each application builds from the
repository containing that Blueprint. The Key Value service reference resolves
within your workspace. Review the proposed resources before deploying, especially
if your workspace already contains services with the same names. Resources you
create count against your workspace's allowances and billing. See
[Render's Blueprint setup](https://render.com/docs/infrastructure-as-code#setup)
and [service references](https://render.com/docs/blueprint-spec#referencing-service-properties).

The checked-in template uses `frontend.invalid` and `api.invalid`. Its frontend
build stops until you replace them. An unchanged fork has no route to the
original demo API. The validator also rejects the original demo hostnames if
they are copied back into the template. This prevents accidental configuration;
it does not restrict deliberate access to a public API. Origin checks are not
authentication.

## First deployment of your own copy

1. Create a Blueprint from your fork's `main` branch using `render.yaml`.
   Keep the workspace on Hobby. Check that the server and Key Value plans say
   Free. The first frontend build will fail while placeholder URLs remain.
2. Set Blueprint **Auto Sync** to **No**. Service auto-deploys and previews are
   already disabled by the template. Record the assigned frontend and API URLs;
   Render can add suffixes when names are taken.
3. Replace these settings in your fork's `render.yaml`:

   | Setting | Value for your deployment |
   | --- | --- |
   | Server `WEBSOCKET_ALLOWED_ORIGINS` | Your frontend's HTTPS origin |
   | Frontend `VITE_SOCKET_URL` | Your server's `wss://` URL ending in `/ws` |
   | Frontend `/api/health` rewrite destination | Your server's HTTPS URL ending in `/health` |
   | Frontend CSP `connect-src` | `'self'` and your server's HTTPS and `wss://` origins |

4. Run `npm ci` and `node scripts/deploy/template.mjs`. Commit the configured
   template to your fork. If you rename services, update `fromService.name` too.
5. Use **Manual sync**, review the proposed changes, and approve them. Deploy
   both applications after the settings are applied. The frontend build runs
   the same URL validator. `make deploy-template-check` only checks the example's
   structure and permits placeholders; it is not a deployment readiness check.
6. Check the server's `/ready` and frontend's `/api/health`. Use two browser
   sessions to test joining, moves, chat, rematches, and refresh recovery.

Render injects the Key Value connection URL through its service reference.
External Key Value access is disabled. Keep connection strings, hooks, API keys,
and player session tokens out of Git, issues, and screenshots.

## Local release controls

Use Node 22, Git, Make, authenticated `gh`, and the
[Render CLI](https://render.com/docs/cli) (tested with v2.30.0).
Install the CLI from Render's official instructions. The scripts find `render`
on `PATH`, or an executable at `.deploy/bin/render`. `RENDER_CLI` can select
another executable.

Create private settings from the public example:

```bash
umask 077
mkdir -p .deploy
cp deploy/render/config.example.json .deploy/config.json
chmod 700 .deploy
chmod 600 .deploy/config.json
```

Edit `.deploy/config.json` with your workspace ID, repository, two service IDs,
and public HTTPS origins, without trailing slashes. These settings select
existing resources; the commands do not provision resources. The whole
`.deploy/` directory is ignored by Git. Keep its contents out of PR attachments.
For a separate private directory, set `DEPLOY_DIR` to its absolute path.

```bash
make deploy-login                 # browser login, then select the configured workspace
make build                        # compile all workspaces locally
make deploy-status                # inspect releases and health; can wake a sleeping server
make deploy-plan TARGET=all        # resolve origin/main and show the selected services
make deploy TARGET=all             # deploy server, verify it, then deploy frontend
```

Login data stays in `.deploy/auth/cli.yaml`; the commands pin both CLI config
path settings so inherited overrides cannot redirect that file.
CLI login expires after seven days.
Run `make deploy-login` again to renew it. Do not commit credentials or create
permanent deploy hooks for these commands. See
[Render CLI authentication](https://render.com/docs/cli#authenticate).

`make deploy` requires a clean checkout, a commit merged into `origin/main`,
and successful GitHub Actions `check` and `images` checks for that exact commit.
It verifies the configured workspace, repository, service types, URLs, free
server plan, disabled previews, and disabled auto-deploys before deploying.
The script does not check workspace billing allowances or Key Value pricing;
check those in Render before each release.

`TARGET=frontend` and `TARGET=server` select one application. The command rejects
single-service releases if shared code or root dependencies differ from the
other live service. Frontend-only releases also require unchanged server code.
Use `TARGET=all` when this check requests a coordinated release. The comparison
cannot prove compatibility of every application change; review the diff too.
Set `COMMIT=<full-sha>` to select an older merged release. Render builds the Git
commit itself; local build output is not uploaded.

Server releases query `/health` directly on the selected API and require zero
rooms. The frontend's health rewrite does not decide occupancy. This is a preflight
check, not a lock: a room can be created after it runs. Schedule releases while
the demo is quiet. Each deployment waits for Render, checks health, and verifies
its live commit before proceeding. A failure stops the sequence and returns a
nonzero exit code; there is no automatic rollback.

## Managing the live demo

Live configuration stays in Render. Before disconnecting the Blueprint, the
operator saved local private copies of its YAML, service settings, and release
records. Ignored files are not backed up by Git; keep a separate private backup
if they are needed for recovery. Credentials must remain separate from public
documentation and examples.

The live static site's build command uses its configured `VITE_SOCKET_URL`:

```bash
npm ci && npm run build -w @minesweeper-flags/game-engine -w @minesweeper-flags/shared -w @minesweeper-flags/client
```

It omits the public template validator because the live service uses dashboard
settings while the repository contains placeholders. Keep that distinction
when editing the live build command. Do not reconnect or sync the public example
into the live demo. Configure origins, environment values, the health rewrite,
and headers directly in the service dashboard. Do not copy secrets into YAML.

Before a release, run `make check`, confirm CI for the selected commit, and
check workspace usage in Billing. Use `make deploy-plan` to inspect the target,
then `make deploy`. The dashboard's **Manual Deploy → Deploy a specific commit**
is also available, but bypasses the local safeguards.

After a release, use two browser sessions to check joining, moves, chat,
refresh recovery, reopening the invite, and rematches. Inspect desktop, tablet,
and mobile layouts. Close test sessions and update the release record above.
After header changes, redeploy the frontend to clear cached response headers.

To roll back, restore a recorded compatible pair of commits. A frontend-only
rollback can leave an unchanged server running. The CLI commands accept an older
merged `COMMIT` if its checks still pass, subject to the same compatibility and
empty-lobby safeguards. The dashboard rollback action retains only the two most
recent previous deploys for a free web service. Recheck a two-player game after
rollback. Disconnecting a Blueprint keeps resources running; see
[Render's resource lifecycle documentation](https://render.com/docs/infrastructure-as-code#deleting-resources).
