# Compliance

BUKU's security and privacy programme, written for the people who run it and the auditors who
check it. Start with the [SOC 2 readiness report](SOC2-readiness.md).

| Document                                                                           | What it is                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [SOC 2 readiness report](SOC2-readiness.md)                                        | Every criterion: controls, evidence, status, remaining work                         |
| [Risk register](risk-register.md)                                                  | Risks, scores and treatments (reviewed twice a year)                                |
| [Runbooks](runbooks.md)                                                            | What to do for each alert; access reviews, restore drills, leavers, secret rotation |
| [Sub-processors](sub-processors.md)                                                | Who processes personal data for BUKU                                                |
| [Privacy notice (draft)](privacy-notice-draft.md)                                  | Plain-language notice, pending legal review                                         |
| **Policies**                                                                       |                                                                                     |
| [Information security](policies/information-security.md)                           | The umbrella policy and roles                                                       |
| [Acceptable use](policies/acceptable-use.md)                                       | Devices, accounts, customer data, secrets                                           |
| [Access control](policies/access-control.md)                                       | Least privilege, admin access, reviews, leavers                                     |
| [Change management](policies/change-management.md)                                 | Pull requests, required checks, working alone, emergencies                          |
| [Incident response](policies/incident-response.md)                                 | Severity, steps, breach notification                                                |
| [Business continuity](policies/business-continuity.md)                             | Recovery objectives, backups, drills                                                |
| [Data classification and retention](policies/data-classification-and-retention.md) | Data classes and how long each kind is kept                                         |
| [Vendor management](policies/vendor-management.md)                                 | Choosing and reviewing vendors and dependencies                                     |

Technical controls live in the code and are described in [SECURITY.md](../SECURITY.md) and
[DECISIONS.md](../DECISIONS.md) (D-079 to D-082 come from this review). Evidence (access
reviews, drills, incident notes) is kept outside this public repository.
