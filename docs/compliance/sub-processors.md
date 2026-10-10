# Sub-processors

Companies that process personal data on BUKU's behalf. Published to customers and businesses;
updated before a new one starts processing data (30 days' notice to businesses where contracts
require it). Reviewed yearly under the [vendor management policy](policies/vendor-management.md).

| Vendor                       | What for                                                      | Personal data involved                                  | Where                   | Assurance to request          |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- | ----------------------------- |
| DigitalOcean                 | Hosting: servers, PostgreSQL, Valkey, object storage, backups | All data BUKU holds                                     | Region chosen at launch | SOC 2 Type II, ISO 27001, DPA |
| Google (Sign-In)             | Signing in with Google                                        | Name, email, Google account id                          | Global                  | SOC 2 / ISO 27001, DPA        |
| Apple (Sign in with Apple)   | Signing in with Apple                                         | Name, (relay) email, Apple id                           | Global                  | Apple privacy terms           |
| Paddle                       | Payments and subscriptions (merchant of record)               | Name, email, payment details (held by Paddle, not BUKU) | EU/UK/US                | SOC 2, PCI DSS, DPA           |
| Amazon Web Services (SES)    | Sending email                                                 | Email address, message content                          | Region chosen at launch | SOC 2 Type II, DPA            |
| Expo (and Apple/Google push) | Phone notifications                                           | Device push token, message content                      | US                      | Security documentation, DPA   |
| Meta (WhatsApp Business)     | WhatsApp messages (only if the person connects WhatsApp)      | Phone number, message content                           | Global                  | Meta data processing terms    |
| Mapbox                       | Maps and places in the apps                                   | Approximate location of map views                       | US                      | SOC 2, DPA                    |
| Vercel                       | Hosting the web app                                           | Request metadata (IP, browser)                          | Global edge             | SOC 2 Type II, DPA            |
| GitHub                       | Source code and CI (no customer data)                         | None (team members only)                                | US                      | SOC 2 Type II                 |
| Have I Been Pwned            | Checking new passwords against known data breaches            | None (5 characters of a password hash, padded)          | Global (Cloudflare)     | Public k-anonymity API        |

Not sub-processors: the businesses themselves (they are independent controllers of their own
customer relationships within BUKU).
