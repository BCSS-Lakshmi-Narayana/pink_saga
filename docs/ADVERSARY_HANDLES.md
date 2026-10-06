# Adversary handles — accounts posting against BRS

Companion to `backend/src/data/state_adversary_handles.json`.

## What the roster is, and what it is not

Every handle in the roster was fetched live from `api.fxtwitter.com` on 2026-09-30 and its bio read before being recorded. That establishes **identity**: this handle exists, and this is who it belongs to.

It does **not** establish **behaviour**. A profile fetch cannot show you what an account posted last week. So the roster records *why* an account is expected to be adversarial — it is a rival party organ, or it is named in reporting as running a campaign against us — and says so in the `hostility` field. No field in that file claims a post was observed.

Two things follow:

1. **The organised accounts were being counted as the public.** `classifyVoice` in `cmDashboardController.js` falls through to `organic` for any handle it does not recognise, and the handle registry holds roughly one account per party. The Congress campaign apparatus — the Youth Congress account, the TPCC social-media chairman, ministers' personal handles — was therefore landing in the organic bucket. For an opposition client that is the worst available misread: the rival's posting schedule becomes our "public sentiment" trend. Fixed by folding this roster into the opposition set.

2. **The gap that remains is anonymous accounts**, and closing it is what the prompt below is for. Not one could be verified from a profile, and a wrongly-listed anonymous handle is worse than an absent one — it attributes a stranger's posts to a coordinated campaign.

## The trap the roster exists to catch

In September 2026 the Chief Minister cited **@SandhyaRaoBRS** in the Assembly — an account presenting itself as a BRS "international general secretary", a post the party does not have, held by a person the party does not have. BRS called it a Congress IT-cell fabrication, asked cybercrime police to trace its operator, and filed a breach-of-privilege notice. The account was deleted shortly after, and a probe on 2026-09-30 confirms it is gone.

The handle ends in `BRS` and was used **against** BRS.

Any rule that reads alignment out of a handle string would have filed its output as our own voice — inflating our apparent publishing volume *and* removing the attack from the adversary column, in a single step. The account is dead; the pattern is not. `test_adversary_handles.js` asserts that an invented `…BRS` handle still does not read as ours.

## Verify the roster and extend it — the Grok prompt

Run this on Grok, which has live X access. It is written to be self-contained; paste it as-is.

```text
You are auditing social media accounts for a political monitoring platform.
The subject party is the Bharat Rashtra Samithi (BRS) of Telangana, India —
party president K. Chandrashekar Rao (KCR), working president K. T. Rama Rao
(KTR), senior leader T. Harish Rao. BRS is IN OPPOSITION. Telangana is
governed by the Indian National Congress under Chief Minister A. Revanth Reddy.

TASK. Using live X data, identify accounts that ACTIVELY AND REPEATEDLY POST
CONTENT ATTACKING BRS or its leaders, over the LAST 90 DAYS.

EVIDENCE RULES — these matter more than completeness:
- Report only accounts you can currently see on X. If you cannot open the
  profile, omit it.
- "Actively posting against" means you can point to specific posts. For each
  account give at least 2 example posts from the last 90 days: the date and
  either the post URL or a short verbatim quote.
- Do NOT guess or reconstruct handles from a person's name. If you know the
  person but not the handle, list them under "known_person_handle_unknown"
  instead of inventing one.
- Do NOT include an account merely because it belongs to a rival party. I
  already have the official party and ministerial accounts. I want accounts
  that demonstrably post attack content.
- If you find fewer accounts than expected, say so. A short honest list is
  worth more than a long speculative one.

PRIORITISE, in this order:
1. ANONYMOUS / PSEUDONYMOUS / MEME / "news page" accounts that post anti-BRS
   content. These are the gap I cannot fill from profile data — weight your
   effort here.
2. IMPERSONATION accounts: handles containing "BRS", "KCR", "KTR", "TRS" or a
   BRS leader's name that actually post AGAINST BRS, or that claim party posts
   which do not exist. (Precedent: @SandhyaRaoBRS, now deleted, which claimed
   to be a BRS "international general secretary".)
3. Congress-aligned campaign accounts below the official party level —
   district units, Youth Congress district handles, individual "social media
   coordinators" and "social media warriors" of the TPCC social media wing.
4. BJP-aligned accounts attacking BRS specifically, as distinct from
   attacking the Congress government.
5. Accounts aligned with Telangana Rakshana Sena (K. Kavitha's party, founded
   25 Apr 2026 after her suspension from BRS) that attack the BRS leadership.

LANGUAGE. Telugu-script and romanised-Telugu ("Telgish") accounts matter as
much as English ones — much of this discourse is not in English. Include Urdu
accounts where relevant (Old City / AIMIM sphere). For each non-English
account, give an English gloss of one example post.

FOR EACH ACCOUNT, RETURN:
  handle                (without @)
  display_name
  followers             (current)
  total_posts           (current)
  account_created       (month and year if visible)
  anonymous             (true if no real identity is stated or discoverable)
  camp                  (inc | bjp | trs-k | aimim | unaligned | unknown)
  attack_targets        (which BRS figures: kcr, ktr, harish-rao, party)
  themes                (e.g. Kaleshwaram, Dharani, family rule, corruption)
  cadence               (roughly how many anti-BRS posts per week)
  example_posts         (>= 2: date + URL or verbatim quote)
  coordination_signals  (identical wording with other accounts, burst timing,
                         reply-brigading, near-simultaneous posting — say
                         "none observed" if you see none)

ALSO RETURN, as separate sections:
  - known_person_handle_unknown: people you believe are involved but whose
    handle you could not confirm.
  - could_not_verify: accounts you saw referenced but could not open.

Output as JSON. End with a plain-English note on how confident you are and
what you could not check.
```

### A second prompt, to confirm what is already in the roster

```text
For each X handle below, using live X data, tell me:
  (a) is the account currently active — date of most recent post;
  (b) in the last 90 days, roughly what share of its posts attack or
      criticise the Bharat Rashtra Samithi (BRS) or its leaders KCR, KTR or
      Harish Rao — give a rough percentage and 2 dated examples;
  (c) if it posts little or nothing about BRS, say so plainly.

TelanganaCMO, revanth_anumula, Bhatti_Mallu, UttamINC, Min_SridharBabu,
INCTelangana, IYCTelangana, SatishManneINC, JakkidiShivaIYC, INCIndia,
INCSandesh, BJP4Telangana, bandisanjay_bjp, kishanreddybjp, Eatala_Rajender,
TigerRajaSingh, RaoKavitha, aimim_national, asadowaisi, AkbarOwaisi_MIM

Do not guess. If you cannot open a profile, say "could not verify" for it.
I am specifically testing whether accounts I have assumed are hostile
actually post against BRS, so a "no, this account rarely mentions BRS"
answer is as useful to me as a yes.
```

### A third, for the handles that could not be found

These office-bearers are real; their handles could not be established from here. Probed 2026-09-30 and found to be non-existent or low-follower namesakes: `@ponnamprabhakar`, `@komatireddy`, `@seethakka`, `@PongulettiSR`, `@JupallyKrishnaRao`, `@BommaMaheshKumarGoud`, `@DKArunaBJP`, `@RamchanderRaoBJP`, `@TPCCOfficial`.

```text
Give me the current official X handles, if they exist, for these Telangana
politicians. For each, give the handle, follower count, and the exact bio text
you used to confirm it is really them. If you cannot confirm an account is the
real person, say "not found" — do NOT return a namesake or a fan account.

Ponnam Prabhakar (Telangana Transport & BC Welfare Minister)
Komatireddy Venkat Reddy (Telangana Roads & Buildings Minister)
Danasari Anasuya "Seethakka" (Telangana Panchayat Raj & Rural Development Minister)
Ponguleti Srinivasa Reddy (Telangana Revenue & Housing Minister)
Jupally Krishna Rao (Telangana Tourism Minister)
Damodar Raja Narasimha (Telangana Health Minister)
Bomma Mahesh Kumar Goud (TPCC President)
D. K. Aruna (BJP, MP Mahabubnagar)
N. Ramchander Rao (BJP Telangana State President)
```

## Folding an answer back in

Grok's output is **a lead, not a fact**. Before anything enters the roster:

1. Confirm the handle resolves: `curl -s https://api.fxtwitter.com/<handle>` returns `"code":200`. This is what rejected `@NRamchanderRao` (2 followers, bio "sining") during the original handle research.
2. Read the bio yourself and put what it says in `evidence`.
3. Set `hostility` honestly — `reported` only where there is published reporting, `structural` only where the institutional role makes it so.
4. Set `verified_on` to the date you checked.
5. Re-run `node backend/scripts/test_adversary_handles.js`.

Anonymous accounts need a field the current schema does not have. Add `anonymous: true` and keep `camp: "unknown"` unless coordination evidence establishes otherwise — alleging an affiliation you cannot show is the one claim in this file that could rebound on the client.

## Running the tests

```bash
node backend/scripts/test_adversary_handles.js
```

129 assertions, no database required.
