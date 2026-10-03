# Information security policy

**Owner:** founder (security officer) · **Version:** 1.0 (2026-10-04) · **Review:** yearly, and
after any major incident or change in the business.

## Purpose and scope

BUKU holds personal data of customers (names, contact details, bookings, visit history) and of
businesses and their employees. This policy sets how that data and the systems that hold it are
protected. It applies to everyone with access to BUKU systems — today the founder, later
employees and contractors — and to every system: the services, databases, cloud accounts,
source code, laptops and vendor consoles.

## Commitments

1. **Least access.** People and software get only the access their job needs, removed when it
   no longer does ([access control](access-control.md)).
2. **Strong sign-in everywhere.** Two-step sign-in on every account that can reach production
   or customer data: BUKU admin, GitHub, DigitalOcean, domain registrar, Paddle, Google Cloud,
   Meta, Expo, email provider, password manager.
3. **Encrypt.** TLS for everything on the network; encryption at rest for databases, backups
   and object storage; personal contact details encrypted again at field level (D-016).
4. **Change through review.** Every change to code or infrastructure goes through a pull request
   with the required automated checks ([change management](change-management.md)).
5. **Know what happens.** Security-relevant actions are recorded in an append-only audit log;
   alerts reach a person ([incident response](incident-response.md)).
6. **Keep only what's needed.** Data is classified and deleted on a schedule
   ([classification and retention](data-classification-and-retention.md)).
7. **Recover.** Backups are tested by restoring them ([business continuity](business-continuity.md)).
8. **Choose vendors carefully** and know who processes our data ([vendor management](vendor-management.md)).
9. **Assess risk** at least yearly ([risk register](../risk-register.md)).

## Roles

| Role                 | Who (today) | Responsible for                                                           |
| -------------------- | ----------- | ------------------------------------------------------------------------- |
| Security officer     | Founder     | This policy set, risk register, incidents, access reviews, vendor reviews |
| Engineering          | Founder     | Secure development, change management, vulnerability fixes                |
| Everyone with access | —           | Following these policies; reporting anything suspicious at once           |

While BUKU is one person, the controls that would normally rely on a second person (code review,
approval of access) rely on automated checks and written records instead; see
[change management](change-management.md#working-alone). This is revisited when the second
person joins.

## Acknowledgement and exceptions

Everyone with access reads and acknowledges these policies when they join and yearly. Any
exception is written down (what, why, until when, who approved) in the risk register.
