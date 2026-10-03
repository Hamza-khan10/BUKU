# Data classification and retention

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly.

## Classes

| Class            | Examples                                                                                            | Handling                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Restricted**   | Secrets and keys; customer emails/phones; WhatsApp numbers; two-step secrets; KYB documents and IDs | Encrypted at field level or kept only in private storage; access logged; never in logs      |
| **Confidential** | Bookings and visit history, reviews' authors, business settings, audit log, reliability figures     | Access by role only; encrypted at rest; exported only to the person or business it concerns |
| **Internal**     | Aggregated analytics, metrics, source code (public repository, but no secrets)                      | Normal care                                                                                 |
| **Public**       | Business profiles, services, prices, opening hours, published reviews                               | May be shown to anyone                                                                      |

Logs never contain Restricted data (redaction in the logger); events between services carry ids,
not personal data.

## Retention

| Data                                       | Kept                                                         | Then                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Account (person)                           | While the account exists                                     | On deletion: 30-day grace, then personal data erased; bookings and ratings kept anonymous |
| Bookings, queue tickets, payments records  | While the business account exists (business and tax records) | Anonymised with the person                                                                |
| Audit log                                  | 24 months                                                    | Whole months dropped (automatic)                                                          |
| Notifications (inbox, delivery records)    | 13 months                                                    | Dropped (automatic)                                                                       |
| Ad events                                  | 13 months                                                    | Dropped (automatic)                                                                       |
| Sessions (refresh tokens)                  | Until 30 days after expiry                                   | Deleted (automatic)                                                                       |
| Processed-event markers / published outbox | 120 days / 7 days                                            | Deleted (automatic)                                                                       |
| KYB documents                              | While the business is active, + 1 year after closing         | Deleted                                                                                   |
| Backups                                    | 7 days point-in-time (provider)                              | Expire                                                                                    |
| Analytics events (ClickHouse)              | 13–25 months by table (TTL)                                  | Expire                                                                                    |

The automatic parts run daily and each run is recorded in the audit log (D-080).
