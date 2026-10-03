# Vendor management policy

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly, and before adding any
vendor that will process personal data.

1. **Before using a vendor that touches personal data or production:** check its security
   (a current SOC 2 Type II or ISO 27001 report, or a security questionnaire), its data processing
   agreement (GDPR Article 28 terms) and where data is stored. Record the decision.
2. **List them:** every such vendor is in the [sub-processors list](../sub-processors.md), which is
   published for customers and businesses.
3. **Review yearly:** fresh reports, any incidents, still needed? Remove unused vendors and their
   access and keys.
4. **Least access:** API keys scoped to what BUKU uses, stored in the secret store, rotated
   when people leave or keys may have leaked.
5. **Software dependencies:** pinned versions, a 24-hour minimum age for new releases, weekly
   Dependabot updates, `pnpm audit` and dependency review in CI, scanned images (D-082).
