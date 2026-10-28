# Two-factor v2 — recovery levels, two-admin approvals, email notices — design

Follows `2026-10-21-passkey-2fa-design.md` (shipped as #280). That version made
a stolen password useless on its own. This one closes what is left around it:
the **recovery** paths, which are now the easiest way in, and the fact that the
person concerned is never told.

## Intent

The flow the requester validated on 2026-10-28 (ledger `[41eb]`), and how each
point is read:

| Decided | Reading |
|---|---|
| Synced passkeys accepted | Unchanged from v1: any passkey with user verification. iCloud / Google sync is the normal case, not an exception. |
| Email is a notification channel with a "this wasn't me" button, **not a factor** | An address on each account; every sensitive event mails the person concerned. A mail never grants access by itself: a link in it only does what an admin already decided, or blocks. |
| An admin never sets a password | Already true (invitation links). Kept, and extended to every reset. |
| A fresh passkey for every admin action | Today only reset, enrollment codes, passkey deletion and the 2FA switch ask for one. Inviting, deleting an account and changing a role do not. All of them will. |
| 2 admins to promote/demote an admin and for the bypass | A second admin approves, with their own passkey. "The bypass" = the immediate full reset (below). |
| Lost password → a link sent by 1 admin | Level 1. Passkeys are kept. |
| Lost passkey, password known → 2 admins approve, then a link | Level 2. |
| Lost everything → full reset effective after 24 h, or at once if a 2nd admin approves | Level 3. Cancellable from the mail during the 24 h. |
| No mandatory second passkey | Unchanged. |
| No emergency procedure | Unchanged: shell on the machine ("we call Gnarco"), v1 § 8. |

Plus two gaps found while reading the code, both in the same spirit:

- **A reset does not end the sessions already open.** The cookie carries no
  version of the account, so a session stolen before the reset stays valid
  after it, and a lost phone that was signed in stays signed in.
- **Invitations last 7 days.** Down to 48 h: with email they no longer need to
  survive a slow hand-over by another channel.

Success:
- a lost password is fixed by one admin, and the person keeps their passkeys;
- one admin alone (or someone riding their session) can no longer strip
  anyone's second factor, nor make anyone admin;
- every reset, new device, invitation and promotion reaches the person's
  mailbox, and "this wasn't me" stops it;
- after any reset, every session opened before it is dead;
- with no mail configured, everything still works as today, links handed over
  by the admin.

## Threat model

Same boundary as v1: anything running as the machine's OS user is out of scope
(soft isolation, invariant 26). What v2 adds against:

- **one compromised admin** (password + their phone, or a ridden session) —
  can no longer reset someone's passkeys, promote an accomplice or demote a
  defender without a second admin;
- **a recovery request made behind the user's back** — the user is mailed and
  can block it;
- **a stolen session** — dies at the next reset or block.

Not addressed: a compromised mailbox. It can press "this wasn't me" (a denial
of service an admin undoes) and read a level-1 link — which still needs the
passkey the attacker does not have, since level 1 keeps it. That is the
point of email not being a factor.

## Design

### 1. Storage

On `Account`:

```ts
email?: string;               // normalised lower-case; unique per instance
sessionsAfter?: number;       // a session cookie issued before this is refused
locked?: { at: number; by: "self" | string };  // "this wasn't me", or an admin
```

Pending two-admin requests, beside the accounts
(`~/.shadok-ai/users/<key>.requests.json`, 600):

```ts
interface AdminRequest {
  id: string;                                     // random, 16 bytes base64url
  kind: "passkey-reset" | "full-reset" | "promote" | "demote";
  target: string;
  by: string;                                     // the admin who asked
  createdAt: number;
  approvedBy?: string;                            // the second admin
  effectiveAt?: number;                           // full-reset: createdAt + 24 h
  cancelToken: string;                            // the mail's "this wasn't me"
  done?: number;
}
```

At most one open request per (target, kind); a new one replaces it. An
unapproved request expires after 48 h. Done/expired rows are pruned on write.

Mail settings, per instance like `cockpitTitle`: `mail?: Record<cwd, { from:
string; publicUrl: string }>` in `config.json`, and the SMTP URL in the vault
as `SHADOK_SMTP_URL` (`smtps://user:pass@host:465`), read by the server, never
handed to an agent's env unless a profile attaches it. `publicUrl` is needed
because a mail link must work from outside: the request's `Host` behind a
proxy is not reliably the public name.

### 2. Sessions die with a reset

`readSessionFull` returns `{user, mfa}` today; it also returns `issuedAt`.
`currentAccount` and `cookieAccount` then refuse a cookie whose `issuedAt` is earlier
than the account's `sessionsAfter`, or any cookie of a `locked` account. Set
`sessionsAfter = now` on: every reset level when it takes effect, a block, a
demotion, and the deletion of a passkey (the lost device's session goes with
it). The same check covers a WebSocket upgrade, which is authenticated by the
same cookie.

Bootstrap admin and the Telegram bridge's internal cookie have no account row
and are unaffected.

### 3. Fresh passkey on every admin write

`stepUpOk` (v1) is added to `POST /users` (invite), `DELETE /users`,
`POST /users/role` and every route below. With 2FA **off** nobody has to own a
passkey, so the step-up applies only while 2FA is on — the same condition
under which v1's existing step-ups are meaningful.

### 4. The three recovery levels

All three start from the target's row in the Users panel (**Recover access…**,
which asks which case it is) and are refused on oneself (v1 rule).

**Level 1 — lost password, passkeys kept.** One admin, fresh passkey. The
password hash is removed, a reset link `/invite/<token>` (48 h) is issued and
mailed; the passkeys stay. Redeeming sets a new password — and, with 2FA on,
the redeemer must then pass a **passkey assertion** with one of the kept
passkeys before the session is issued. A link that only sets a password would
otherwise be a way around the second factor for whoever reads the mail.
`sessionsAfter = now` at issue.

**Level 2 — lost passkey, password known.** Admin A asks (fresh passkey) →
request `passkey-reset`, the target is mailed ("an admin asked to let you
register a new device") with "this wasn't me". Admin B ≠ A, ≠ target approves
(fresh passkey). On approval: an enrollment code is minted (v1 § 4, but 48 h
since it travels by mail) and mailed; the existing passkeys are kept (the user
deletes the lost one from their list once in, or an admin does);
`sessionsAfter = now`. Password + code → register → session `mfa=1`, the v1
enroll path unchanged.

**Level 3 — lost everything.** Admin A asks (fresh passkey) → request
`full-reset`, `effectiveAt = now + 24 h`, target mailed with the date and
"this wasn't me — cancel". Until then nothing changes on the account. Then:

- admin B approves (fresh passkey) → effective at once (the "bypass");
- or `effectiveAt` passes → effective on the next action that reads it.

No timer: the request is *applied* when an admin opens the Users panel or
asks for the link (`GET /users` applies due requests), so a restart loses
nothing and there is no scheduler to keep alive. Applying = password and
passkeys removed, `sessionsAfter = now`, a reset link issued (48 h), mailed and
shown to admin A to hand over if the mailbox is lost too. Redeeming it asks for
a password then registers a passkey (the v1 invitation path with 2FA on).

### 5. Promote / demote an admin

With 2FA **on**: admin A asks (fresh passkey) → request `promote`/`demote`;
admin B approves (fresh passkey) → applied, target mailed. `keepsTwoAdmins`
(v1) still refuses a demotion that would leave fewer than 2 admins with a
passkey — checked at approval, on the state at that moment.

With 2FA **off**: one admin, as today. Requiring two would deadlock the very
step that creates the second admin, and 2FA cannot be switched on before two
exist anyway (v1 § 6), so the two-admin rule is in force exactly when it can be
satisfied.

### 6. Email

**Events** (to the target unless stated): invitation (with the link), each
recovery level asked / approved / effective / cancelled, a new passkey
registered (label + time), a passkey deleted, promoted / demoted, account
blocked (to the user **and** every admin), own email changed (to the **old**
address).

**"This wasn't me"** — every mail but the invitation carries
`<publicUrl>/alert/<cancelToken-or-account-token>`. Reachable without a
session, like `/invite`. One click shows what it will do; confirming:

- cancels the open request it came from;
- sets `locked` and `sessionsAfter = now` on the account;
- mails every admin.

A locked account cannot sign in. An admin unlocks it (fresh passkey); the user
is mailed. Single-use token, 7 days, refused with one wording whatever is wrong
(like `redeemVerdict`).

**Addresses.** Set by the admin at invitation; afterwards changed only by the
user themself, with a fresh passkey, the old address notified. An admin cannot
change someone else's address: it is where that person's alarms go, and
redirecting it would be the first move of a compromised admin.

**Transport.** `nodemailer` over the SMTP URL. A send never blocks the action:
a failure is logged by event type and recipient domain (never the link) and
the panel shows "mail not sent — hand this link over yourself", which is
exactly today's behaviour. No mail configured = that message every time, and
no "this wasn't me" (nothing to click). The panel says mail is off.

### 7. Invitations

`INVITE_TTL_MS` → 48 h. An invitation can carry an address; with mail on, it
is sent; the link is still shown to the admin.

### 8. Pure rules (tested)

In `src/twofactor.ts`, beside v1's verdicts:

- `requestVerdict({ actor, kind, target, accounts, twoFactor })` — who may ask;
- `approveVerdict({ request, approver, now })` — admin, ≠ asker, ≠ target, not
  already approved, not expired;
- `requestDue(request, now)` — level 3's clock;
- `sessionAlive({ issuedAt }, account)` — the `sessionsAfter` / `locked` rule;
- `alertVerdict(token, rows, now)` — the "this wasn't me" link.

The mail transport is injected (`sendMail` function), so the routes are tested
with a recording fake; end-to-end uses nodemailer's `jsonTransport` selected by
`SHADOK_MAIL_TRANSPORT=json`, writing the mails to a directory the test reads —
no network, no real SMTP.

## Rollout

Nothing changes for an instance until it configures mail **and** turns 2FA on,
except: the 48 h invitations, the step-ups on invite/delete/role (2FA on only),
and `sessionsAfter` on resets — all three strictly tighter. Accounts with no
address keep working; the panel nags admins to add one at the next invitation
and lets each user add their own.

Verification before merge: Chromium with a CDP virtual authenticator (as v1),
three admins, each level run to completion and once cancelled from the mail;
a session opened before a reset proved dead after it; mail off proved to
behave like today.

## Out of scope

Email as a factor or a magic-link sign-in; SMS; recovery codes; a mandatory
second passkey; per-event mail preferences; an emergency path beyond the shell
on the machine.

## Open questions

1. **Mail provider.** The design takes any SMTP URL. Which account sends
   (Google Workspace, a transactional service)? Needs a sender address the
   recipients' filters accept.
2. **Who gets level-3 notices besides the target** — every admin, or only the
   two involved? The design says the target, plus every admin on a block.
