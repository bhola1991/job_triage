# Privacy

**Last updated: 2026-09-09**

Job Triage can run in two modes, and which one you are in determines entirely
what happens to your data.

## Without an account

Nothing leaves your browser. Your CV, your jobs, your notes and your API keys
are held in that browser's local storage. There is no server, no account and
nothing transmitted to us — because there is no "us" in the request path at
all. Clearing your site data erases it permanently.

The exception, in both modes: when you score a job or search for one, the app
calls the API you configured — DeepSeek or Anthropic for scoring, Apify for
search — directly from your browser, using your key. What you send them is
governed by their privacy policies, not this one.

## With an account

If you sign up, the following is stored in a Postgres database hosted by
Supabase:

- your email address, held by the authentication service
- the text of any CV you paste or upload
- the profile derived from it, the career directions, and every job, score,
  note, contact and event you record

**Your API keys are never uploaded.** They stay in the browser they were
entered in, on purpose — sending them to a server would add risk without
adding anything you would want.

Each account can read and write only its own rows. This is enforced by the
database itself through row-level security, not by the application, so a bug
in the app cannot expose one account's data to another.

## Deleting your data

Two options, both immediate:

- **Delete my data** in the app erases every row belonging to your account and
  leaves the account itself intact.
- **Delete my account** removes the account and everything attached to it.

Neither is recoverable and neither requires you to ask anyone.

## Legal basis and contact

The lawful basis for this processing is your consent, given by choosing to
create an account, and withdrawable at any time by deleting it. You have the
right to access, correct, export and erase your data; export is built in as
**Export CSV** and needs no request.

Questions or requests: **<add a contact email here before launch>**
