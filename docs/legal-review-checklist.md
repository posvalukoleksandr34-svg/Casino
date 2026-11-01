# Legal review checklist

These are questions a **qualified lawyer** must answer before Aurovane opens to
the public. They are written by the engineering team as an inventory of what
the software does. This is not legal advice, does not state any legal
requirement as settled, and does not replace professional review. Nothing in
this repository has been legally reviewed or approved.

Record each answer, the reviewer and the date. Where the answer requires a
change, open an issue and link it here.

## 1. Operator identity and jurisdiction

- [ ] Which legal entity operates Aurovane? Its name, registered address,
      registration number and contact belong in the Terms, the Privacy
      Notice and possibly an imprint. They are **not** in the repository
      today. `SUPPORT_EMAIL` is the only contact the software shows.
- [ ] In which jurisdictions will the site be offered? Is any country to be
      excluded? The software has **no** country restrictions; residence is
      self-declared at onboarding.
- [ ] Is an imprint (legal notice) page required for the operator's location
      and audience?

## 2. Social casino classification

Aurovane offers casino-style games and sports predictions with free virtual
chips that cannot be bought, sold, transferred, withdrawn or exchanged, and
there are no prizes.

- [ ] Under the operator's law (for example the **Swiss Federal Act on Money
      Games**, the Geldspielgesetz / LJAr) and in each target market, is this
      outside the scope of gambling regulation? Does that conclusion depend
      on the absence of any purchase, prize or transfer? Engineering keeps
      these absent by design, and any future change must return to this
      review.
- [ ] Are there restrictions on advertising casino-style games, even free
      ones, especially to minors?
- [ ] Do the platform rules of app stores, ad networks or payment-free
      "social casino" categories apply, if they are used later?
- [ ] Are the disclaimers adequate ("not a real-money casino", "no prizes",
      "chips have no value") on the landing page, the help page, the Terms,
      registration and e-mails?

## 3. Age

- [ ] Is the self-declared 18+ age gate (an age-confirmation checkbox plus a
      date of birth checked on the server) sufficient? Or is a third-party
      age-verification provider required for any target market? An interface
      exists for one (`src/server/verification/age.ts`); none is integrated.
- [ ] Is 18 the right minimum everywhere offered, or is a higher age needed
      in some markets?

## 4. Terms of Service (`/terms`)

- [ ] Do the terms need to name the operator, the governing law, a venue,
      liability limits, account termination rules and a change procedure?
- [ ] Is click-wrap acceptance at registration valid? The accepted version
      and time are recorded per account. Existing accounts accepted no
      version: they were created before the record existed.
- [ ] When the terms change substantially, must players re-accept them? The
      software records the version, but there is **no** re-acceptance prompt
      yet.
- [ ] Consumer-protection rules for free online services in the target
      markets.

## 5. Data protection

Assess both the **Swiss Federal Act on Data Protection (revFADP / nDSG, in
force since 1 September 2023)** and whether the **EU GDPR** applies, for
example by offering the service to people in the EU (Art. 3(2)).

- [ ] The controller's identity and contact. Does the operator need an EU
      representative (GDPR Art. 27), or a Swiss representative (revFADP
      Art. 14) for a foreign controller?
- [ ] The legal basis for each processing purpose in the Privacy Notice:
      account and service, e-mail verification, age check, the phone number
      (why it is required at onboarding, and whether it is necessary),
      security logs, and responsible-play features.
- [ ] Data minimisation. Is collecting the legal name, date of birth,
      country and phone number at onboarding necessary and proportionate for
      a free virtual-chip product? Engineering implemented it as specified;
      the lawyer should confirm or narrow it.
- [ ] Is processing a date of birth (and possibly special categories) within
      scope? Is a data-protection impact assessment needed?
- [ ] Records of processing activities (revFADP Art. 12 / GDPR Art. 30).
- [ ] Processors and data processing agreements with the hosting provider,
      the e-mail provider, the SMS provider (if used), the off-site backup
      storage and the monitoring/log providers.
- [ ] International transfers. Where do these providers store data?
      Adequacy decisions, standard contractual clauses, and the Swiss–US Data
      Privacy Framework if relevant.
- [ ] Retention periods. Today:
  - sessions are deleted 30 days after they expire;
  - an unverified registration is reclaimable after 24 hours;
  - the pseudonymised ledger, rounds and audit log are kept indefinitely;
  - backups are kept for 35 days by default.

  Are these acceptable? Is "indefinite" justified for the pseudonymised
  financial-style records of a virtual-chip product?
- [ ] Data-subject rights. Self-service export and deletion exist. Is the
      export format (JSON) complete and adequate? Is the deletion
      (anonymisation that keeps pseudonymised records) sufficient? What is
      the procedure and deadline for requests by e-mail, including identity
      checks?
- [ ] Breach notification duties and the procedure (to the FDPIC "as soon as
      possible" / GDPR 72 hours). Who decides and who notifies?
- [ ] Do the cookies and storage need consent? The software sets two strictly
      necessary HttpOnly cookies and session storage for request recovery,
      with no analytics or advertising. A lawyer should confirm that no
      banner is needed in each market.
- [ ] Children's data. The service is 18+. Is there a procedure for an
      account found to belong to a minor?

## 6. Responsible play

- [ ] Are the existing tools adequate and correctly described? They are
      limits (loss, wager, session), a cool-off, self-exclusion, delayed
      loosening and reality checks.
- [ ] Should help-organisation contacts be shown, and which ones per market?
- [ ] Is there an obligation or a good-practice expectation to act on signs
      of excessive play, even without money?

## 7. Communications

- [ ] Transactional e-mails (codes, resets, security notices) are sent
      without marketing consent. Confirm that this is allowed and that no
      marketing is sent. None is, and there is no marketing consent field.
- [ ] Is any content needed in the e-mail footers, such as the operator's
      identity?

## 8. Intellectual property and content

- [ ] Rights to the name "Aurovane", the logo, fonts (open-source licences
      as listed in `package.json`) and game designs. The games are generic
      casino games implemented independently.
- [ ] Dependency licences. Is a third-party notices page needed?
- [ ] In live sports mode, the provider terms (football-data.org, The Odds
      API) and the rights to show team names and fixtures.

## 9. Staff and records

- [ ] Staff access to personal data. Confidentiality agreements, access
      reviews, and the four-eyes rules for sensitive operations (implemented
      for corrections, large grants, house funding and switching off staff
      MFA).
- [ ] How long must audit logs and staff action records be kept, and may
      they be kept?

## Sign-off

| Area | Reviewer | Date | Outcome / actions |
|---|---|---|---|
| Operator identity and jurisdiction | | | |
| Social casino classification | | | |
| Age | | | |
| Terms of Service | | | |
| Data protection (revFADP / GDPR) | | | |
| Responsible play | | | |
| Communications | | | |
| IP and content | | | |
| Staff and records | | | |
