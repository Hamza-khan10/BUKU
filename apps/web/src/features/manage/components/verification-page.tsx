'use client';

import { zText, type TextKind } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileText } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { can, fetchManaged, managedKey, MINE_KEY, type ManagedBusiness } from '../api';
import { cleanPhone, E164 } from '../setup';
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABEL,
  DOCUMENT_STATUS,
  DOCUMENT_TYPES,
  documentProblem,
  fileSize,
  IDENTIFIER,
  MAX_DOCUMENTS,
  removable,
  shownDocuments,
  type BusinessDocument,
  type Checklist,
  type DocumentKind,
  type LegalProfile,
  type LegalProfileInput,
} from '../verification';
import {
  checklistKey,
  documentsKey,
  fetchChecklist,
  fetchDocuments,
  fetchLegalProfile,
  legalKey,
  removeDocument,
  saveLegalProfile,
  uploadDocument,
} from '../verification-api';

const problem = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t work. Please try again.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkText(kind: TextKind, value: string, min: number, max: number): string | null {
  const parsed = zText({ kind, min, max }).safeParse(value);
  if (parsed.success) return null;
  if (value.trim().length < min) return min <= 1 ? 'This is needed.' : `At least ${min} characters, please.`;
  return parsed.error.issues[0]?.message ?? `At most ${max} characters, please.`;
}

const focusFirstProblem = () =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

/**
 * /business/[id]/verification (3.5m), for the owner: where BUKU's check stands and what it still
 * needs (the same checklist that blocks BUKU's "verify"), the legal and registration details,
 * and the documents that prove them. Numbers are kept encrypted and shown masked.
 */
export function VerificationPage({ id }: { id: string }) {
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const owner = business.data ? can(business.data.myRole, 'business.legal') : false;
  const checklist = useQuery({
    queryKey: checklistKey(id),
    queryFn: () => fetchChecklist(id),
    enabled: owner,
  });
  const legal = useQuery({ queryKey: legalKey(id), queryFn: () => fetchLegalProfile(id), enabled: owner });
  const documents = useQuery({
    queryKey: documentsKey(id),
    queryFn: () => fetchDocuments(id),
    enabled: owner,
  });

  const failed = business.error ?? checklist.error ?? legal.error ?? documents.error;
  if (failed) {
    const e = failed instanceof ApiError ? failed : null;
    return (
      <ErrorState
        title="We couldn’t load verification"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }
  if (!business.data) return <Skeleton className="h-96 max-w-3xl" />;
  if (!owner)
    return (
      <EmptyState title="Verification is for the owner">
        The legal details and documents are theirs to send.
      </EmptyState>
    );
  if (!checklist.data || legal.data === undefined || !documents.data)
    return <Skeleton className="h-96 max-w-3xl" />;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeading
        compact
        eyebrow={business.data.name}
        title="Verification"
        description="BUKU checks every business before it’s marked verified. Your details and documents are private: only BUKU’s reviewers see them."
      />
      <Standing business={business.data} checklist={checklist.data} />
      <LegalCard id={id} business={business.data} saved={legal.data} />
      <DocumentsCard id={id} documents={documents.data} />
    </div>
  );
}

function Standing({ business, checklist }: { business: ManagedBusiness; checklist: Checklist }) {
  const { title, detail, tone } =
    business.status === 'verified'
      ? { title: 'Verified', detail: `BUKU has checked ${business.name}.`, tone: 'ok' as const }
      : business.status === 'rejected'
        ? {
            title: 'Not approved yet',
            detail: business.rejectionReason
              ? `BUKU said: ${business.rejectionReason} Fix it below and BUKU checks again.`
              : 'Fix the details below and BUKU checks again.',
            tone: 'danger' as const,
          }
        : business.status === 'suspended'
          ? { title: 'Suspended', detail: 'Contact BUKU to find out what’s needed.', tone: 'danger' as const }
          : checklist.ready
            ? {
                title: 'Waiting for BUKU’s check',
                detail: 'Everything BUKU needs is here.',
                tone: 'wait' as const,
              }
            : {
                title: 'Not verified yet',
                detail: 'Customers can already find and book you. Send what’s missing to be verified.',
                tone: 'neutral' as const,
              };
  return (
    <section
      aria-labelledby="standing"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-soft"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="standing" className="text-2xl font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          {tone !== 'neutral' && (
            <Badge tone={tone}>
              {tone === 'ok' ? 'Verified' : tone === 'wait' ? 'In review' : 'Action needed'}
            </Badge>
          )}
        </div>
        <p className="text-ink-2">{detail}</p>
      </div>
      <ul aria-label="What BUKU needs" className="flex flex-col gap-2.5 text-sm">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            {item.met ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
            )}
            <span className={item.met ? 'text-ink' : 'text-ink-2'}>
              {item.label}
              <span className="sr-only">{item.met ? ': done' : ': still needed'}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `verification-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <h2 id={headingId} className="text-base font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

// ── Legal and registration details ───────────────────────────────────────────

type LegalDraft = {
  legalName: string;
  registrationCountry: string;
  registrationType: string;
  registrationNumber: string;
  taxId: string;
  registeredAddress: string;
  personName: string;
  personRole: string;
  personEmail: string;
  personPhone: string;
};

function LegalCard({
  id,
  business,
  saved,
}: {
  id: string;
  business: ManagedBusiness;
  saved: LegalProfile | null;
}) {
  const [editing, setEditing] = useState(saved === null);
  return (
    <Section
      title="Legal details"
      description="Who the business is on paper. Numbers are stored encrypted and shown with only their last digits."
    >
      {editing || !saved ? (
        <LegalForm id={id} business={business} saved={saved} done={() => setEditing(false)} />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail term="Legal name" value={saved.legalName} />
            <Detail term="Registered in" value={saved.registrationCountry} />
            <Detail term="Registration" value={`${saved.registrationType}, ${saved.registrationNumber}`} />
            <Detail term="Tax number" value={saved.taxId ?? 'None given'} />
            <Detail term="Registered address" value={saved.registeredAddress} />
            <Detail
              term="Responsible person"
              value={`${saved.responsiblePerson.name}, ${saved.responsiblePerson.role}`}
            />
          </dl>
          <Button variant="secondary" size="sm" className="w-fit" onClick={() => setEditing(true)}>
            Change the details
          </Button>
        </div>
      )}
    </Section>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-3">{term}</dt>
      <dd className="break-words text-ink">{value}</dd>
    </div>
  );
}

function LegalForm({
  id,
  business,
  saved,
  done,
}: {
  id: string;
  business: ManagedBusiness;
  saved: LegalProfile | null;
  done: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LegalDraft>({
    legalName: saved?.legalName ?? business.name,
    registrationCountry: saved?.registrationCountry ?? business.address.country,
    registrationType: saved?.registrationType ?? '',
    // Saved numbers come back masked: they're asked for again, never sent back masked.
    registrationNumber: '',
    taxId: '',
    registeredAddress: saved?.registeredAddress ?? `${business.address.line}, ${business.address.city}`,
    personName: saved?.responsiblePerson.name ?? '',
    personRole: saved?.responsiblePerson.role ?? '',
    personEmail: saved?.responsiblePerson.email ?? '',
    personPhone: saved?.responsiblePerson.phone ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof LegalDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (key: keyof LegalDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const found: Partial<Record<keyof LegalDraft, string>> = {};
    const text = (key: keyof LegalDraft, kind: TextKind, min: number, max: number) => {
      const p = checkText(kind, draft[key], min, max);
      if (p) found[key] = p;
    };
    text('legalName', 'title', 2, 300);
    text('registrationType', 'title', 2, 100);
    text('registeredAddress', 'line', 5, 500);
    text('personName', 'personName', 2, 200);
    text('personRole', 'title', 2, 100);
    const country = draft.registrationCountry.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) found.registrationCountry = 'The two-letter country code, like PK.';
    const number = draft.registrationNumber.trim();
    if (!IDENTIFIER.test(number))
      found.registrationNumber = 'Letters, digits, spaces, “-”, “.” and “/” only (3 to 64).';
    const tax = draft.taxId.trim();
    if (tax && !IDENTIFIER.test(tax))
      found.taxId = 'Letters, digits, spaces, “-”, “.” and “/” only (3 to 64).';
    const email = draft.personEmail.trim();
    if (email && !EMAIL.test(email)) found.personEmail = 'That doesn’t look like an email address.';
    const phone = draft.personPhone.trim() ? cleanPhone(draft.personPhone) : '';
    if (phone && !E164.test(phone))
      found.personPhone = 'A phone number with its country code, like +92 300 1234567.';
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstProblem();

    const input: LegalProfileInput = {
      legalName: draft.legalName.trim(),
      registrationCountry: country,
      registrationType: draft.registrationType.trim(),
      registrationNumber: number,
      ...(tax && { taxId: tax }),
      registeredAddress: draft.registeredAddress.trim(),
      responsiblePerson: {
        name: draft.personName.trim(),
        role: draft.personRole.trim(),
        ...(email && { email }),
        ...(phone && { phone }),
      },
    };
    setBusy(true);
    try {
      const result = await saveLegalProfile(id, input);
      queryClient.setQueryData(legalKey(id), result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: checklistKey(id) }),
        queryClient.invalidateQueries({ queryKey: managedKey(id) }),
        queryClient.invalidateQueries({ queryKey: MINE_KEY }),
      ]);
      toast.success(result.reverificationRequired ? 'Saved. BUKU will check the business again.' : 'Saved.');
      done();
    } catch (err) {
      setFailure(problem(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof LegalDraft,
    label: string,
    opts: {
      required?: boolean;
      hint?: string;
      maxLength: number;
      autoComplete?: string;
      type?: string;
      className?: string;
    },
  ) => (
    <Field
      label={label}
      hint={opts.hint}
      required={opts.required}
      error={errors[key]}
      className={opts.className}
    >
      <Input
        name={key}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
        maxLength={opts.maxLength}
        autoComplete={opts.autoComplete ?? 'off'}
        type={opts.type ?? 'text'}
        required={opts.required}
      />
    </Field>
  );

  return (
    <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
      {saved && business.status === 'verified' && (
        <Alert tone="wait" title="Changing the legal name, number or country">
          These are what BUKU checked. Changing them sends the business back for review.
        </Alert>
      )}
      {field('legalName', 'Legal name', {
        required: true,
        maxLength: 300,
        hint: 'As registered, like Fade Masters (Private) Limited.',
      })}
      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
        {field('registrationCountry', 'Country', { required: true, maxLength: 2, hint: 'Like PK.' })}
        {field('registrationType', 'Kind of registration', {
          required: true,
          maxLength: 100,
          hint: 'Like SECP company, NTN, Companies House or EIN.',
        })}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {field('registrationNumber', 'Registration number', {
          required: true,
          maxLength: 64,
          hint: saved
            ? `Saved as ${saved.registrationNumber}. Enter it again to keep it or change it.`
            : undefined,
        })}
        {field('taxId', 'Tax number', {
          maxLength: 64,
          hint: saved?.taxId
            ? `Saved as ${saved.taxId}. Enter it again to keep it; left empty, it’s removed.`
            : undefined,
        })}
      </div>
      {field('registeredAddress', 'Registered address', {
        required: true,
        maxLength: 500,
        autoComplete: 'street-address',
      })}
      <fieldset className="flex flex-col gap-4 rounded-md bg-sunken p-4">
        <legend className="sr-only">The person responsible</legend>
        <p className="text-sm font-medium text-ink">The person responsible</p>
        <div className="grid gap-5 sm:grid-cols-2">
          {field('personName', 'Name', { required: true, maxLength: 200, autoComplete: 'name' })}
          {field('personRole', 'Role', { required: true, maxLength: 100, hint: 'Like Owner or Director.' })}
          {field('personEmail', 'Email', { maxLength: 254, type: 'email', autoComplete: 'email' })}
          {field('personPhone', 'Phone', { maxLength: 30, type: 'tel', autoComplete: 'tel' })}
        </div>
      </fieldset>
      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          Save the legal details
        </Button>
        {saved && (
          <Button type="button" variant="secondary" onClick={done}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

function DocumentsCard({ id, documents }: { id: string; documents: BusinessDocument[] }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('business_license');
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = shownDocuments(documents);
  const full = shown.length >= MAX_DOCUMENTS;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: documentsKey(id) }),
      queryClient.invalidateQueries({ queryKey: checklistKey(id) }),
    ]);

  const send = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setFileError('Choose the file to send.');
    const p = documentProblem(file);
    if (p) return setFileError(p);
    setFileError(null);
    setBusy('upload');
    try {
      await uploadDocument(id, kind, file);
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Sent. BUKU will look at it.');
      await refresh();
    } catch (err) {
      setFileError(problem(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (doc: BusinessDocument) => {
    setBusy(doc.id);
    try {
      await removeDocument(id, doc.id);
      toast.success('Document removed.');
      await refresh();
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Documents"
      description="A registration or licence, and the owner’s identity. PDF, JPEG or PNG, up to 25 MB. Kept exactly as sent."
    >
      <div className="flex flex-col gap-6">
        {shown.length > 0 && (
          <ul aria-label="Documents sent" className="flex flex-col divide-y divide-line text-sm">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <span className="flex min-w-0 items-start gap-2.5">
                  <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{DOCUMENT_LABEL[d.type]}</span>
                      {d.status !== 'awaiting_upload' && (
                        <Badge
                          tone={d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'danger' : 'wait'}
                        >
                          {DOCUMENT_STATUS[d.status]}
                        </Badge>
                      )}
                    </span>
                    <span className="text-ink-3">
                      {d.contentType === 'application/pdf'
                        ? 'PDF'
                        : d.contentType === 'image/png'
                          ? 'PNG'
                          : 'JPEG'}
                      , {fileSize(d.sizeBytes)}
                    </span>
                    {d.reviewNote && <span className="text-ink-2">BUKU: {d.reviewNote}</span>}
                  </span>
                </span>
                {removable(d) && (
                  <Button variant="ghost" size="sm" loading={busy === d.id} onClick={() => void remove(d)}>
                    Remove<span className="sr-only"> {DOCUMENT_LABEL[d.type]}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-ink-3">
            That’s 20 documents, the most a business can send. Remove one to add another.
          </p>
        ) : (
          <form
            noValidate
            onSubmit={(e) => void send(e)}
            className={cn('flex flex-col gap-4', shown.length > 0 && 'border-t border-line pt-5')}
          >
            <Field label="What it is" required>
              <Select name="type" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="The file" required error={fileError ?? undefined}>
              <Input
                ref={fileRef}
                name="file"
                type="file"
                accept={DOCUMENT_TYPES.join(',')}
                required
                onChange={() => setFileError(null)}
                className="h-auto py-2"
              />
            </Field>
            <Button type="submit" variant="primary" className="w-fit" loading={busy === 'upload'}>
              Send the document
            </Button>
          </form>
        )}
      </div>
    </Section>
  );
}
