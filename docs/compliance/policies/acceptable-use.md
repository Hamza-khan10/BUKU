# Acceptable use policy

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly.

For anyone with access to BUKU systems or data.

- **Devices.** Work only from devices with full-disk encryption, a screen lock (5 minutes),
  automatic security updates and a supported operating system. No production access from
  shared or public computers.
- **Accounts.** Use your own accounts, never shared ones. A password manager for every password;
  two-step sign-in wherever offered. Never reuse BUKU passwords elsewhere.
- **Customer data.** Look at customer data only to do your job (support, fixing a problem), never
  out of curiosity. Never copy it to personal storage, chat apps or AI tools. Production data is
  never used for development or testing — use the seed data.
- **Secrets.** Keys, tokens and passwords live only in the secret store and `.env` files that are
  never committed (secret scanning blocks commits that contain them). If a secret leaks, rotate it
  immediately ([runbooks](../runbooks.md#secret-rotation)) and report it.
- **Software.** Install only what you need from official sources; keep it updated.
- **Report** lost devices, phishing, suspicious messages or anything odd at once — reporting a
  mistake quickly is always right.

Breaking this policy can lead to access being removed.
