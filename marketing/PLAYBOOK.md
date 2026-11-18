# Marketing playbook

## Audiences

1. **Owners of busy local places** (barbers, salons, clinics, labs, gyms, car washes): run on
   walk-ins and phone calls, lose money to no-shows, waiting rooms overflow on peak days. They trust
   peers and what they can see working. Message: a calmer front desk, fewer no-shows, free to start.
2. **Front-desk staff and clinic receptionists:** juggle a register, a phone and a crowd. Message:
   one list that stays right, check-in by code.
3. **People who book:** waiting in lines (OPD, passport and ID offices, banks, barbers on Sundays),
   calling to ask "how long?". Message: book a time or take your place in line from your phone.
4. **Partners and press** (LinkedIn): the story of fixing waiting in everyday life.

## Content pillars (rotate)

1. **The problem, recognised:** the moments everyone knows (the plastic chair, the token number,
   "come back after Asr"). Builds attention and relatability.
2. **How BUKU works:** one feature at a time, shown on the real screens (from the site).
3. **For businesses:** practical tips (cutting no-shows, handling the Eid rush, running a walk-in
   line) with BUKU as one part of the answer. Builds trust and reciprocity.
4. **Behind the build:** the founder's why, honest progress, principles (only real reviews, no fake
   scarcity). Builds familiarity.
5. **Join early:** clear invitations to the early-access list, for people and for businesses.

Ratio: about 40% problem and tips, 30% how it works, 15% behind the build, 15% direct invitations.

## Platforms and sizes

| Platform                                                                              | Formats                                | Sizes (px)                                                          | Notes                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Instagram                                                                             | Feed, carousel, Reels, Stories         | Feed 1080x1350 (4:5); Reels/Stories 1080x1920                       | Hook in the first line and first second; 3 to 8 relevant hashtags |
| Facebook                                                                              | Posts, Reels                           | 1080x1350 or 1200x630 links; cover 1640x624 (shows 820x312)         | Local groups matter; Roman Urdu works                             |
| LinkedIn                                                                              | Text, document carousels (PDF), images | 1200x1200 or 1080x1350; company cover 1128x191                      | Founder voice; business owners and partners                       |
| TikTok                                                                                | Short videos                           | 1080x1920, 15 to 45 s                                               | Trends with licensed sounds; captions on screen                   |
| X                                                                                     | Short posts, threads                   | 1600x900 images; header 1500x500                                    | Product updates, replies, press                                   |
| YouTube                                                                               | Shorts, how-to videos                  | Shorts 1080x1920; video 1920x1080; banner 2560x1440 (safe 1546x423) | How-tos rank in Google                                            |
| Profile pictures: 1080x1080 (shown as a circle: keep the mark inside the middle 70%). |

## Cadence (until launch)

Instagram 4 posts and 3 Stories a week, Reels 2; Facebook mirrors Instagram plus local groups;
LinkedIn 2 to 3 posts; TikTok 3; X 3; YouTube Shorts 1 to 2. Quality over volume: fewer, better.

## A post file (`content/YYYY-MM-DD-<platform>-<slug>.md`)

```
---
platform: instagram
format: carousel (5 slides)
pillar: problem
audience: people who book
language: English + Roman Urdu caption
link: https://onbuku.com/early-access?as=customer&source=instagram&utm_campaign=waiting-rooms
status: draft | approved | scheduled | posted
---
Hook (first line):
Caption:
Hashtags:
Alt text (each image):
Slides / shot list:
Why this should work (the human reason, one line):
```

## Images

Templates in `templates/*.html` (brand fonts and colours built in). Render a template to PNG:
`node marketing/scripts/render.ts templates/<name>.html brand/exports/<name>.png <width> <height>`
(run from the worktree root, after `pnpm install`). Check every image at small size on a phone.

## Measurement

- The early-access list records each signup's `source` and `utm_campaign`: the owner can share the
  counts by source (D1). That is the number that matters, not likes.
- Weekly report (`reports/YYYY-WW.md`): top 3 posts by saves, shares and link clicks; signups by
  source; one thing to stop, one to try.

## Calendar moments

Ramadan (iftar timing, late-night salons and clinics), Chand Raat and Eid (salons, henna, tailors,
barbers), wedding season (November to February: bridal makeup, photographers, halls), exam season
(tutors, test prep), summer (AC service, swimming), back to school, Independence Day (14 August),
cricket matches (timing posts around them, never using team logos).

## The weekly routine

Monday: report on last week; plan this week (one file per post, status draft). The owner approves
or edits; you revise. The owner schedules approved posts (Meta Business Suite for Instagram and
Facebook; LinkedIn, X, TikTok and YouTube Studio natively). Every Friday: three ideas for next week
from what people asked or reacted to.
