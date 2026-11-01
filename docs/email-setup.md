# E-mail setup

Registration depends on e-mail: every new account confirms its address with a
six-digit code. With `MAIL_TRANSPORT=disabled` (the default), registration is
closed (`POST /api/auth/register` answers 503 and creates nothing) and password
recovery is unavailable. Existing accounts keep signing in.

**Status in this repository:** the SMTP transport is implemented and tested
against local SMTP servers: a fake server in the integration tests and a
loopback sink in the end-to-end suite. **No real provider has been configured
or tested.** That is the operator's job, and this guide covers it.

## What Aurovane sends

| Message | When | Contains |
|---|---|---|
| Verification code | registration, resend, address correction | 6-digit code, valid 10 minutes |
| E-mail-change code | a verified player changes address (sent to the **new** address) | 6-digit code |
| Password reset | "Forgot password" | single-use link, valid 30 minutes |
| Address-changed notice | after an e-mail change (sent to the **old** address) | the new address, masked |
| Delivery test | operator action (`/admin/health` or `npm run ops:mail-check`) | nothing sensitive |

Every message has a plain-text part and an HTML part in Aurovane's style
(`src/server/mail/templates.ts`). The HTML loads no images or remote resources,
so nothing is fetched when a message is opened. Every value is HTML-escaped.

## Delivery behaviour

- **Timeouts:** `SMTP_TIMEOUT_SECONDS` per attempt (default 20). The connection
  and greeting timeouts are min(10 s, that value).
- **TLS:** required for every non-loopback server. Use `smtps://…:465`, or
  `smtp://…:587` with STARTTLS; the minimum version is TLS 1.2. Credentials,
  codes and links are never sent in clear text to a remote host.
- **Failure classes** (`classifyMailError`):
  - *Permanent*: a 5xx reply, an authentication failure, a TLS failure, or
    delivery disabled. It is not retried. A verification code refused this
    way is recorded as `REJECTED`, and the player is asked to correct the
    address.
  - *Temporary*: network errors, timeouts, 4xx replies. It is retried twice,
    after 0.5 s and 2 s, within a 20-second budget.
- **Retries are safe:** a retry resends the identical message (same code,
  same link). At worst the player gets two identical e-mails, never two
  different codes.
- **Delivery records:** a failed code is recorded as `FAILED`, and the player
  can ask for a new one at once (the 60-second cooldown does not apply to an
  undelivered code).
- **No queue:** delivery is in-process with no durable queue. If the provider
  is down for longer than the retries, the player requests a new code later.
  The pending account waits, and nothing is lost.
- **Logging:** logs record the purpose, the user id, the error code and the
  SMTP reply code. They never contain the recipient, the subject, the body,
  codes, links or credentials. This is tested in
  `tests/integration/mail.test.ts`.
- **Status and metrics:**
  - `/admin/health → E-mail delivery` shows the transport, the last connection
    check, sent and failed counts, and the last failure with an
    operator-facing reason.
  - Metrics: `casino_mail_sent_total`, `casino_mail_failed_total{kind}`,
    `casino_mail_retries_total`, `casino_mail_transport_up`,
    `casino_mail_last_success_timestamp_seconds`.
- **Start-up check:** with `smtp`, the server connects and authenticates once
  at start-up and logs the result. Start-up is not blocked; alerting covers a
  failure.

## Configure a provider

1. **Choose a transactional e-mail provider.** You need one that offers SMTP
   submission with authentication, and that lets you authenticate your own
   sending domain (SPF and DKIM). Using a personal mailbox account for this
   is a deliverability and security risk.
2. **Use a sending subdomain**, for example `mail.your.domain` or
   `notify.your.domain`. It keeps the reputation of transactional mail
   separate from your people's mailboxes.
3. **Publish DNS records** as the provider instructs:
   - **SPF** (TXT on the sending domain). Authorise only the provider, for
     example `v=spf1 include:<provider-spf-domain> -all`. Keep a single SPF
     record per name.
   - **DKIM**: the CNAME or TXT records the provider gives you (2048-bit keys
     where offered). Do not reuse keys across providers.
   - **DMARC** (TXT at `_dmarc.<your.domain>`). Start with
     `v=DMARC1; p=none; rua=mailto:<reports@your.domain>; adkim=s; aspf=s`.
     Watch the reports. Once SPF and DKIM pass consistently, tighten the
     policy to `p=quarantine`, then `p=reject`.
   - Make sure the `From:` domain (in `MAIL_FROM`) **aligns** with the
     DKIM-signing domain and/or the SPF domain. DMARC passes only with
     alignment.
   - Optional: a **return-path / bounce** domain on your subdomain, if the
     provider supports it. Reverse DNS for any dedicated IP.
4. **Create an SMTP credential** limited to sending: a dedicated user or API
   key with no account-admin rights.
5. **Set the environment** in your secret store; never put these values in the
   repository:

   ```dotenv
   MAIL_TRANSPORT=smtp
   SMTP_URL=smtps://<user>:<url-encoded password>@<smtp host>:465
   MAIL_FROM=Aurovane <no-reply@notify.your.domain>
   MAIL_REPLY_TO=support@your.domain        # optional
   SUPPORT_EMAIL=support@your.domain         # required in production
   ```

   Production refuses to start if `SMTP_URL` or `MAIL_FROM` is missing or
   malformed, or if `MAIL_TRANSPORT=console`.

## Validate before opening registration

Do all of this on the production configuration, from the production network
location:

1. `npm run ops:mail-check` (Compose:
   `docker compose run --rm migrate npm run ops:mail-check`). Expect
   `connection: ok`. If it fails, the reason printed says what to fix
   (authentication, TLS, unreachable host).
2. `npm run ops:mail-check -- --to <a mailbox you control>`. Expect
   `accepted by the mail server`.
3. In that mailbox:
   - the message is in the **inbox**, not spam;
   - the `Authentication-Results` header shows `spf=pass`, `dkim=pass` and
     `dmarc=pass`;
   - the `From:` address is the one you configured;
   - the HTML and plain-text parts both read correctly.
4. Repeat with at least two different large mailbox providers (for example
   one consumer webmail and one business mail service). Use a deliverability
   or "mail tester" service to check content, DNS and blocklists.
5. Register a test account end to end: the code arrives within a minute, it
   works, and the profile step follows. Then test "Forgot password" and an
   e-mail change with the same account.
6. In `/admin/health`, check that **E-mail delivery** shows a successful
   connection check and the sends you just made, with no failures. Wire the
   `AurovaneMailTransportDown` and `AurovaneMailFailures` alerts in
   `deploy/monitoring/alerts.yml` to a person.
7. Only then announce registration publicly.

## Ongoing care

- Watch DMARC aggregate reports and the provider's bounce and complaint
  dashboards. Keep complaints near zero: Aurovane sends no marketing, so
  complaints usually mean someone else registered with your address, or a
  misconfiguration.
- Rotate the SMTP credential at least yearly and whenever staff with access
  leave: update the secret, then restart the app.
- If the provider has an outage, nothing needs repairing afterwards: pending
  registrations simply request a new code. See
  [onboarding.md](onboarding.md#when-a-player-cannot-receive-the-code).
