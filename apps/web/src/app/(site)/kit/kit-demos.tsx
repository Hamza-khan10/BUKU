'use client';

import { CalendarX, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Switch } from '@/components/ui/choice';
import { CleanTextarea, CleanTextInput } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LiveDot } from '@/components/ui/live-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Ticket } from '@/components/ui/ticket';
import { TimePill, TimePills } from '@/components/ui/time-pill';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="border-b border-line pb-2 font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

const SWATCHES = [
  ['canvas', 'Page'],
  ['surface', 'Surface'],
  ['sunken', 'Sunken'],
  ['ink', 'Text'],
  ['ink-2', 'Secondary text'],
  ['ink-3', 'Muted text'],
  ['brand', 'Coral — the next step'],
  ['ok', 'Mint — confirmed, open'],
  ['wait', 'Amber — almost your turn'],
  ['focus', 'Focus'],
  ['danger', 'Errors only'],
] as const;

const TIMES = ['09:30', '10:00', '10:30', '11:15', '13:00', '13:45', '15:30'];

export function KitDemos() {
  const [time, setTime] = useState('10:30');
  const [name, setName] = useState('');

  return (
    <div className="flex flex-col gap-14">
      <Section title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map(([token, label]) => (
            <div key={token} className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
              <span
                className="size-10 shrink-0 rounded-md border border-line"
                style={{ background: `var(--${token})` }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{label}</span>
                <span className="font-mono text-xs text-ink-3">{token}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          <p className="font-display text-5xl font-bold tracking-tight">Know exactly when.</p>
          <p className="font-display text-2xl font-semibold">Headings: Bricolage Grotesque</p>
          <p className="max-w-2xl text-lg text-ink-2">
            Text: Inter — legible at every size. Names in other scripts fall back to the device’s fonts: عائشہ
            خان · देवनागरी · 李雷.
          </p>
          <p className="font-mono text-xl tabular">BK-7KQ2MX · A-023 · 10:30</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Book this time</Button>
          <Button>Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Cancel booking</Button>
          <Button variant="link">A link</Button>
          <Button variant="primary" loading>
            Booking…
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="icon" aria-label="Add">
            <Plus aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
        </div>
      </Section>

      <Section title="Badges and live">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">Confirmed</Badge>
          <Badge tone="wait">Pending approval</Badge>
          <Badge tone="brand">New</Badge>
          <Badge tone="danger">Cancelled</Badge>
          <Badge>Completed</Badge>
          <Badge tone="outline">Not verified</Badge>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ok">
            <LiveDot label="Live" /> Open now
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-wait-ink">
            <LiveDot tone="wait" label="Live" /> 3 ahead of you
          </span>
        </div>
      </Section>

      <Section title="Forms (clean text)">
        <p className="max-w-2xl text-sm text-ink-2">
          Try typing or pasting an emoji, or a digit into the name: it’s removed as it arrives, with a note
          saying why. Leaving a field tidies its spaces and turns styled letters into ordinary ones.
        </p>
        <div className="grid max-w-2xl gap-5">
          <Field label="Your name" required hint="As the business should call you.">
            <CleanTextInput
              kind="personName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field label="Business name" required>
            <CleanTextInput kind="title" defaultValue="Salt & Pepper Barbers (DHA) #2" />
          </Field>
          <Field label="Email" required error="Please enter an email address like name@example.com.">
            <Input type="email" defaultValue="not-an-email" autoComplete="email" />
          </Field>
          <Field label="A note for the business" hint="Up to two blank lines between paragraphs.">
            <CleanTextarea kind="text" rows={3} />
          </Field>
          <Checkbox
            label="Text me reminders on WhatsApp"
            description="Only about your bookings and queue tickets. You can turn this off at any time."
          />
          <Switch label="Booking reminders" description="A day before and two hours before." defaultChecked />
        </div>
      </Section>

      <Section title="Messages">
        <div className="grid max-w-2xl gap-3">
          <Alert tone="ok" title="You’re booked">
            Haircut with Ali, Thursday 10:30. (Example)
          </Alert>
          <Alert tone="wait" title="Cancelling now counts as a late cancellation">
            The business asks for 2 hours’ notice. (Example)
          </Alert>
          <Alert tone="danger" title="That time was just taken">
            Here are the next free times. (Example)
          </Alert>
          <Alert title="Payment is at the venue" />
          <div>
            <Button onClick={() => toast.success('Saved')}>Show a toast</Button>
          </div>
        </div>
      </Section>

      <Section title="Time pills">
        <TimePills label="Free times on Thursday (example)" value={time} onValueChange={setTime}>
          {TIMES.map((t) => (
            <TimePill key={t} value={t}>
              {t}
            </TimePill>
          ))}
        </TimePills>
      </Section>

      <Section title="Tickets">
        <div className="flex flex-col gap-6">
          <Ticket
            fresh
            qr
            title="Haircut with Ali"
            place="Example Barbers · Gulberg"
            when="Thu 9 Oct · 10:30–11:00"
            details={
              <>
                <span>Rs 800 · pay at the venue</span>
                <span>Show this code at the front desk.</span>
              </>
            }
            code="BK-7KQ2MX"
            codeLabel="Booking code"
            status={{ label: 'Confirmed', tone: 'ok' }}
          />
          <Ticket
            title="Walk-in queue"
            place="Example Clinic"
            when="3 people ahead of you · about 20 min"
            code="A-023"
            codeLabel="Your ticket"
            status={{ label: 'In the queue — updates live', tone: 'wait', live: true }}
          />
        </div>
      </Section>

      <Section title="Cards, avatars, tooltips, tabs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Example Barbers</CardTitle>
              <CardDescription>Barbershop · Gulberg, Lahore</CardDescription>
            </CardHeader>
            <CardBody className="flex items-center gap-3">
              <Avatar name="Ali Raza" />
              <Avatar name="عائشہ خان" />
              <Avatar name="Sara" size={32} />
              <Tooltip content="Shows up for 96% of bookings (example)">
                <Button size="sm" variant="quiet">
                  Reliability
                </Button>
              </Tooltip>
            </CardBody>
            <CardFooter>
              <Button variant="primary" size="sm">
                Book
              </Button>
              <Button size="sm">Join queue</Button>
            </CardFooter>
          </Card>
          <Card>
            <CardBody>
              <Tabs defaultValue="upcoming">
                <TabsList>
                  <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                  <TabsTrigger value="past">Past</TabsTrigger>
                </TabsList>
                <TabsContent value="upcoming" className="text-sm text-ink-2">
                  Your next visits appear here.
                </TabsContent>
                <TabsContent value="past" className="text-sm text-ink-2">
                  Visits you’ve had appear here.
                </TabsContent>
              </Tabs>
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Loading, empty and error">
        <div className="grid gap-4 sm:grid-cols-3">
          <div aria-busy className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <span className="sr-only">Loading…</span>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="mt-2 h-11 w-32 rounded-full" />
          </div>
          <EmptyState
            icon={CalendarX}
            title="No upcoming visits"
            action={<Button variant="primary">Find a place</Button>}
          >
            When you book, your visit shows up here with its code.
          </EmptyState>
          <ErrorState
            message="We couldn’t load your visits. Check your connection and try again."
            reference="2f6c1d0e-example"
            action={<Button>Try again</Button>}
          />
        </div>
      </Section>

      <Section title="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Cancel a booking…</Button>
          </DialogTrigger>
          <DialogContent
            title="Cancel this booking?"
            description="Haircut with Ali, Thursday 10:30. (Example)"
          >
            <div className="flex flex-col gap-4">
              <Field label="Reason" hint="The business sees this.">
                <CleanTextarea kind="text" rows={2} />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <DialogClose asChild>
                  <Button>Keep booking</Button>
                </DialogClose>
                <Button variant="danger">Cancel booking</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </Section>
    </div>
  );
}
