# What goes to the owner first (and how fast)

Draft nothing to the person until the owner has seen these; tell the owner in one line what it is.

| Kind | Examples | Owner sees it | Person hears back |
| --- | --- | --- | --- |
| **Security** | "I found a bug that shows other people's data", suspicious login, phishing using BUKU's name | At once | Within 24 hours: thanks, we're looking, don't share details publicly |
| **Data requests** | Remove me from the list, delete my account, what data do you hold, correct my details | Same day | Confirm receipt within 24 hours; done within 30 days (sooner where possible) |
| **Legal** | Complaints from authorities, lawyers, threats, copyright or trademark claims | At once | Only what the owner approves |
| **Safety** | Harassment, threats, someone in danger | At once | Only what the owner approves; urgent danger: local emergency services |
| **Payments** | Charges, refunds, invoices (once billing is on) | Same day | Within 24 hours |
| **Press and partners** | Journalists, investors, partnership offers | Same day | The owner replies |

Removing someone from the early-access list (the owner runs it; never in a shared place):
`pnpm --filter @buku/web exec wrangler d1 execute buku-early-access --remote --command "DELETE FROM waitlist WHERE email = '<their email, lowercase>'"`
then confirm to them.
