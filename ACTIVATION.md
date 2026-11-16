# Activation codes (operator guide)

Creating a workspace in ARMPIT requires a one-time activation code. Only the operator (you) can issue codes. Keep this file
private: it describes how licensing works.

## How it works

- A code looks like `ARMPIT-XXXX-XXXX-XXXX-XXXX` (80 bits of randomness; no look-alike characters).
- You issue codes with the operator endpoint below. The code is shown **once**; the database stores only its SHA-256 hash.
- At sign-up, `create_organization()` (a database function) redeems the code in the same step that creates the workspace.
  A missing, wrong, used or revoked code creates nothing. This check is in the database, not in the web app.
- The `activation_codes` table has row level security with **no policies**: no signed-in user, not even a workspace admin,
  can read or change it. Only the server (service role) can.
- Only someone holding `CRON_SECRET` (set in Vercel, never in the repository) can call the endpoint, so copying the source
  code does not let anyone mint a valid code for your service.

## Issue a code

```bash
export CRON_SECRET='…your secret from Vercel…'      # keep it out of chat, notes and the repo
curl -s -X POST "https://armpit.dpdns.org/api/admin/activation-codes" \
  -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
  -d '{"label":"Acme Co (invoice 1042)","count":1}'
```

Send the code to the customer through a private channel. `count` can be up to 50. `label` is your own note.

## See what has been issued and used (codes themselves are never shown)

```bash
curl -s "https://armpit.dpdns.org/api/admin/activation-codes" -H "Authorization: Bearer $CRON_SECRET"
```

## Revoke a code that has not been used (leaked, or sent to the wrong person)

```bash
curl -s -X PATCH "https://armpit.dpdns.org/api/admin/activation-codes" \
  -H "Authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{"id":"<id from the list>"}'
```

## Rolling this out

1. Deploy the new version **and** run migration `20261114000012_activation_codes.sql` back to back. Between the two, only
   *creating a new workspace* fails; existing workspaces and users are unaffected.
2. Issue yourself a code first (you need one for any new workspace of your own).
3. Existing workspaces keep working and need no code.

## What this does and does not protect

- It protects your **running service**: nobody can create a workspace on your backend without a code you issued.
- It cannot stop someone who has the full source and runs it on **their own** database from simply not installing the
  check: they own that server. Pair it with the licence in `LICENSE` and keep the repository private.
- It is a manual licence gate, not a payment system: you decide when to issue a code (for example after you are paid).
  Automatic payment through Stripe is a separate, not-yet-built feature.
