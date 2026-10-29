# Multi-tenant cockpit: scoped agents, per-scope OS isolation, scoped secrets

Status: **Draft for review** — 2026-10-29. Written from a brainstorming
conversation; to be reviewed the next day. Points settled in that conversation
are marked **[DECIDED]**; points deliberately left open are marked **[OPEN]**.
Nothing here is built yet; this document is the thing to approve before a plan.

Updated the same evening after a **builder review** (a reviewer agent read the
doc and listed where a builder would have to guess). Its minor calls are folded
in and marked; its **four questions that only the owner can answer** are in
*Open decisions*, ranked — the first is a viability blocker the first draft
missed.

## Intent and why

Turn shadok from a single shared cockpit into the cockpit of a **hybrid company**
— humans and agents running a company or a project together. Concretely, the
driver is two use cases the current model cannot express:

- **Agents private to one person**, visible to them alone.
- **Agents scoped to a team** (COMEX / RH / TECH / SALES / MARKETING), visible
  only to members of that team.

The mental model the user reached for is **Slack channels**: you see your own
things and the things of the groups you belong to, and nothing else. Agents must
still be able to **collaborate across those boundaries** — a dev agent in one
team hands work to a release agent in another — without that collaboration
punching a hole in the isolation.

This is explicitly **not** a Fortune-500 product. The target is a company of **up
to ~50 people**. That scale shapes every trade-off below.

## Threat model (read this before judging any mechanism)

The design defends against the **realistic** threats for a trusted-insider
company:

- **Accidental exposure** — an agent helpfully surfacing one team's data to a
  member of another (the most likely real incident).
- **Honest-but-curious access** — someone could look at another team's agents or
  secrets because the system lets them, without being an attacker.

It explicitly does **not** try to defend against:

- A **determined insider with a shell on the host**, or **host root**. If someone
  has that, it is game over regardless, and it belongs to a different trust
  domain (machine access, HR, contracts) — not something the cockpit can or
  should solve. Chasing it would force containerization and hardening the scale
  does not warrant.

Design rule that follows: close the **realistic** holes (cross-team reads via a
shared OS user, unfiltered agent/secret visibility) with real OS-level
boundaries, and stop there.

## Core model: two orthogonal dimensions

An agent is described by **two independent things**:

1. **Profile = the ROLE** — what the agent may *do*: its system prompt, its
   permission guardrails (`deny`/`allow`), its model, and the **names** of the
   secrets it needs. A profile is reusable across teams: COMEX has a `dev`,
   SALES has a `dev`, it is the *same* role. (This is today's `src/profiles.ts`,
   unchanged in spirit.)

2. **Scope = WHERE it runs and WHO sees it** — exactly one of:
   - `owner` — private to one person;
   - `group` — shared within one team;
   - `instance` — shared across the whole cockpit.

An agent **belongs to one scope** and **wears one profile**. The two never merge:
isolating by profile would wrongly pool every team's `dev` together; isolation is
a property of the scope, not the role.

**The isolation tier maps 1:1 onto the scope** — this is the spine of the design:

| Scope | OS identity | HOME | Secret slice | Who sees / drives |
|-------|-------------|------|--------------|-------------------|
| `owner` | per-person OS user (`u_<person>`) | per-person | personal | the owner only |
| `group` | per-team OS user (`g_<team>`) | per-team | team | members of the team |
| `instance` | shared instance user | shared | instance-wide | everyone authenticated |

Because the three secret scopes land on the same three OS identities, there is
**one uniform model**, and a personal agent is as tightly walled as a team agent
— including from other members of its owner's own teams.

## Users and groups

- Accounts gain a **group** concept (new): a group has **members** (people).
- **[CALL, builder review]** Real per-person accounts become **mandatory** in a
  multi-tenant cockpit — the whole ACL rests on "which person is calling", so the
  password-optional / dormant single-admin mode (`SHADOK_GUI_PASSWORD`, "with no
  password everything is dormant") cannot coexist with teams. It survives only as
  the **degenerate single-tenant case** (no teams → everything `instance` scope →
  behaves exactly as today). An instance that defines a team must have accounts
  on.
- **[CALL, builder review]** OS users + HOMEs are **admin-provisioned** at
  onboarding (an admin with the root orchestrator creates `u_<person>` /
  `g_<team>`), not self-service signup, for v1. A web account can exist before its
  OS user does; it simply cannot own/run an agent until provisioned.
- **[DECIDED]** Membership is **many-to-many** — a person can be in several
  groups (e.g. COMEX *and* TECH).
- A person's **visibility** is the **union** of: their own `owner` agents ∪ every
  group they are a member of ∪ the `instance` scope.
- When creating an agent, the creator picks its scope among **{ me } ∪ { groups I
  belong to }**; that choice fixes the OS user the agent runs under for its whole
  life.

### Terminology warning (do not conflate)

shadok **already** has a thing called a "group": the **cosmetic tab grouping** in
the left column (`channel.group`, `/groups` — id, name, collapsed, order). It is
client-owned, purely organisational, visible to everyone, and has **no members
and no rights**. The **access group / team** introduced here is a different,
richer concept. **[OPEN]** Naming + relationship: either rename the new concept
("team" / "space") and keep the cosmetic tab-group as-is, or enrich the existing
group to carry membership + visibility. Recommendation: introduce **"team"** as
the access/isolation unit and leave the cosmetic tab-group untouched, to avoid
overloading one word with two jobs.

## Visibility / access control (the Slack-channel layer)

This is the layer that delivers the two use cases, and it does **not** by itself
require the OS isolation below — it is pure authorization metadata.

- Each agent (channel) carries: an **`owner`** (person), a **`scope`**
  (`owner`/`group`/`instance`), and, when `group`, the **team id**.
- **Server-side filtering, everywhere a channel list leaves the server**:
  `GET /channels`, every WebSocket broadcast that names channels, and the Telegram
  listings. The caller sees only what their identity entitles them to. Today
  `GET /channels` ignores the caller entirely (`_req`) and returns everything —
  that is the core thing that changes.
- **Server-side action gating**: resume / prompt / drive / stop / set-parent /
  set-profile are all checked against the same ACL. **Never** trust the client;
  the browser filtering is cosmetic only.
- **[DECIDED, revisit]** A personal (`owner`) agent is **fully private**:
  invisible **and** non-pilotable **even to an admin**. No break-glass in v1.
  Flagged for re-examination the next day.

## Execution isolation (the light form — no containers)

- **[DECIDED]** Per-scope **OS user**, **no containers**. The global toolchain
  (node, git, `claude`, tmux) is installed **once** for the machine and shared by
  every user; there is no per-tenant image and no duplicated 223 MB `claude`
  binary.
- The shadok server becomes a **privileged orchestrator**: it runs as root (or
  with the needed sudo rights) and **drops to the target OS user** when it spawns
  each agent. It also manages the **lifecycle** of OS users and HOMEs — create the
  user + HOME when a person or team is onboarded.
- Each person/team gets its own **HOME**, holding `~/.claude` (skills seeded per
  HOME at boot), config, transcripts, and that scope's **vault slice**. The
  `claude` native binary stays **global** and is never duplicated per HOME.
- This **closes the current vault-read leak for free**: today every agent shares
  the server's OS user, so it can `cat ~/.shadok-ai/secrets.json` and read the
  whole vault (the `600` mode does nothing between same-user processes). Under
  per-scope users, the vault file (`600`, owned by the server/root or the scope
  user) is unreadable from a different OS user; the server injects only the due
  secrets as env.

### Cost, stated honestly

- More OS users and HOMEs: roughly `#teams + #people` (~55 for a 50-person
  company). Linux handles this easily, but the orchestrator must provision and
  tear them down.
- A personal agent therefore **does** get its own HOME → a modest **per-person**
  cost (seeded skills + config + transcripts + that person's worktrees). Never the
  binary.
- The "no container, shared binaries" benefit holds throughout — this is *more
  users*, not *more installs*.

## Collaboration across boundaries

Isolation must not break the collaboration shadok already relies on. It does not,
because shadok routes collaboration through two channels that are **not** the
shared filesystem:

- **pilotctl** goes through the central server over the WebSocket. Agents in
  different OS users / HOMEs (or even different machines) can still spawn, prompt,
  and drive each other. Unaffected by isolation. (And already denied the Claude
  Code cross-session `SendMessage`/`ListAgents` tools — see PR #317 — so the
  server is the one sanctioned path.)
- **git**: the meeting point is the **remote (origin)**, not a shared local
  directory. A dev agent **commits locally** and **pushes a feature branch**; a
  push/merge-privileged agent (e.g. a release role) reviews and brings it to
  `main`. **Branch protection on the remote** — not a fragile tool `deny` — is
  what enforces "only certain roles merge".

**Consequence to design around:** there is no shared-filesystem handoff of
**uncommitted** work across an isolation boundary. The pattern "a git-less lead
edits files, then asks a third party to reach into its worktree and push" **stops
working** under isolation (the third party cannot see the worktree). It must be
replaced by either (a) the lead delegating the coding to an agent that owns its
branch end-to-end, or (b) giving the authoring agent enough git to commit + push a
feature branch (never merge to `main`). This is a cleaner flow regardless.

## Secrets model evolution

The single flat per-instance vault (one file, global names, any profile may
reference any name) does not survive teams. It becomes **scoped**:

- **Each secret has a scope**: `owner` / `group` / `instance`.
- **Resolution — profile names it, scope supplies the value.** A profile
  references a secret *name* (e.g. `OPENAI_API_KEY`); at spawn, the agent's scope
  supplies the value. The same role used by COMEX resolves `OPENAI_API_KEY` to
  COMEX's key; used by SALES, to SALES's key. **Names are unique per scope, not
  globally.** Lookup precedence: the agent's own scope first (owner for a personal
  agent, team for a team agent), then `instance` as fallback.
- **Isolation**: the server is the **only reader**; it injects only the agent's
  scope's secrets as env; the OS-user wall means an agent cannot read another
  scope's vault file. Physically splitting the vault into per-scope files is
  optional belt-and-braces — scoping can live as **server-side policy** over a
  single server-owned file, since the OS wall + env-injection already isolate.
- **Scoped management API**: `GET /secrets` lists only the names in the caller's
  scope; creating/overwriting a team secret requires membership (or admin) of that
  team; a personal secret, only its owner. When an **agent** stores a secret it
  obtained (the `shadok-secrets` skill `set`, which has no `get`), the value lands
  in **that agent's scope**, stamped **server-side** from its session (like
  `SHADOK_SESSION_KEY`), never from anything the client claims.
- **Migration**: today's flat vault becomes the **`instance`** scope. Teams and
  people add their own on top. No big-bang; a single-user instance with no teams
  behaves exactly as today.

## Disk / footprint

- The disk driver is the **worktree** (+ project dependencies), not the
  scope distinction. `git worktree` shares the repo's `.git` object store (history
  is not duplicated); only the working tree + index cost. `node_modules` is where
  it balloons — mitigate with a **shared symlink / cache per repo** (as shadok
  already does for its own dev). Transcripts (`.jsonl`) are small per unit but
  accumulate.
- Per-person and per-team HOMEs are modest (skills + config + transcripts + their
  worktrees); never the binary.
- Watch item: **worktree proliferation** with many ephemeral personal agents.
  Amortized by shadok's existing empty-worktree pruning (invariant 5) and the
  shared dependency cache. **[OPEN]** Per-person disk **quota** — not present
  today, not required; add later only as a deliberate choice.

## Goals / non-goals / anti-goals

**Goals**
- Slack-like per-person and per-team visibility of agents.
- Real, OS-level confidentiality of secrets and files **between** scopes.
- Cross-scope collaboration preserved via pilotctl + git.
- No containers; shared toolchain.

**Non-goals (v1)**
- Defending against host root / a determined insider with a host shell.
- Containerization and Fortune-500 hardening.
- Per-person disk quotas.

**Anti-goals (a design that does any of these has failed, even if it "works")**
- Silently letting one scope read another's secrets or files.
- Breaking pilotctl or git collaboration across scopes.
- Conflating the cosmetic tab-group with the access team.
- A personal agent that an admin can quietly see or drive (v1 decision).

## Constraints

- No containers (toolchain shared once).
- The server must run **privileged** to setuid per spawn.
- **All** enforcement is server-side (visibility filtering, action gating, secret
  scoping); the client is never trusted — in the spirit of the existing
  server-owned / same-origin invariants.
- **Backward-compatible migration**: an existing single-user instance, with no
  teams defined, must keep behaving exactly as today (everything is `instance`
  scope).
- **[CALL, builder review] Restart-survival is preserved, not traded away.**
  Agents run in detached tmux sessions that outlive the server and are re-adopted
  on boot (`reconcileOnBoot`, invariants 7/23). Under per-user spawns this
  property **must still hold**: the root orchestrator has to enumerate, reattach
  to, and tail panes **across** OS users after a restart, and tail each agent's
  transcript from **its own HOME** (a different uid). This is a product invariant,
  not a mechanism detail — the setuid mechanics are the builder's, but dropping
  restart-survival is out of bounds.
- **[CALL, builder review] The loopback auth must survive the uid change.** An
  agent authenticates back to the server with `SHADOK_SESSION_KEY` /
  `SHADOK_AUTH` from its child env (invariant 33). Those must keep working when
  the child runs as a different OS user and reads from a different HOME — the
  credentials are env-carried, so the change is the spawn uid, not the auth model;
  the plan must verify this end-to-end, not assume it.
- **[CALL, builder review] `instance` scope runs as a dedicated, non-privileged
  "instance" OS user** — not the root orchestrator user. So even an
  `instance`-scoped agent receives its secrets only by **injection** and cannot
  read the server-owned vault file directly, keeping the "vault leak closed"
  property uniform across all three scopes. (Resolves the draft's open item on
  this.)

## Open decisions to revisit

### Raised by the builder review — only the owner can answer (ranked)

1. **Claude subscription across per-user HOMEs — VIABILITY BLOCKER (the first
   draft missed this).** shadok runs on the *user's Claude subscription*, and
   `claude` signs in through one machine keychain / one `claude auth login`
   (`src/claude-auth.ts`). But the design gives every scope its own HOME with its
   own `~/.claude`. So: do ~55 OS users each sign in **separately** (≈55
   subscriptions / 55 OAuth logins — probably a non-starter), or is **one**
   subscription's credential **shared/copied into every HOME** — and if so, how
   (the keychain is per-OS-user; the OAuth token lives per-HOME)? This decides
   whether the feature is viable at all on one subscription and dictates a
   credential-propagation subsystem that does not exist today. **Nothing else can
   be planned until this is settled.**

2. **Where does this run — bare privileged host vs. one big container?** The
   design says "no containers, server as root, setuid per spawn" = a classic
   Linux multi-user host. Production today is **Docker, one container per
   instance** (pid 1 is the app, root inside). Is multi-tenant meant to (a)
   replace per-container with **one privileged server on a bare host**, or (b)
   run **~55 OS users inside a single container**? This reshapes provisioning,
   the launch-dir lock (`src/lock.ts`), volume layout, the Docker-gated SSH
   identity (`src/ssh.ts`), and whether the VPS recipes survive.

3. **Telegram in v1, or deferred?** The Telegram bridge is built around exactly
   **one DM owner** (`dmGate`, `…-telegram-owner.json`, one bot = one owner,
   `src/telegram.ts`). Per-person/per-team visibility over Telegram is a major
   surface — a bot-per-person, per-DM account mapping, or topics-as-teams — i.e.
   a near-rewrite of the bridge's identity model. Recommendation: **web-only
   multi-tenancy in v1, Telegram stays single-owner / deferred** — confirm.

4. **Is there a lead / home agent per scope?** Today there is exactly one home
   channel ("general") and one lead agent per instance, with hard invariants
   around it (`isHomeChannel`, first-agent, greeting — invariants 18/35). In a
   multi-tenant cockpit: a lead **per person**, **per team**, **one global**, or
   **none**? The onboarding/greeting/first-agent machinery assumes a single home,
   so this ripples through `channels.ts`, `first-agent.ts`, `greeting.ts`.

### Still open from the original draft

- **Naming**: "team" / "space" vs reusing "group"; relationship to the cosmetic
  tab-group.
- **Secret resolution**: confirm the owner→team→instance precedence; whether a
  profile may pin a scope explicitly rather than rely on fallback.
- **Admin break-glass over personal agents** — v1 says *no* (fully private),
  needs settling before the action-gating code is written.
- **Multi-host**: single-host for v1; multiple hosts later.
- **Per-person disk quota**: deferred.

## Left to the builder

- The server orchestration of **setuid spawns**: how privilege is dropped
  (`runuser` / `su` / native setuid) and how tmux/pty sessions are launched under
  a different uid while the server keeps control of the pane.
- **Schema changes**: accounts gain groups/teams + membership; channels gain
  `owner` / `scope` / team id; secrets gain `scope`.
- **Enumerated ACL enforcement points**: `GET`/`PUT /channels`, `/groups`, every
  WS broadcast carrying channels, Telegram listings and command dispatch, each
  action handler (resume/prompt/stop/set-parent/set-profile), and `/secrets`
  (GET/PUT/DELETE).
- **Migration scripts**: flat vault → `instance` scope; existing channels →
  `instance` (or an owner, if derivable).
