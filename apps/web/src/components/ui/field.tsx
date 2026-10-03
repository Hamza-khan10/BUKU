'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A labelled form field. It wires the label, the hint and the error to the
 * control inside it (id, aria-describedby, aria-invalid), so every input is
 * announced properly without each screen repeating that work.
 */

interface FieldState {
  id: string;
  hintId: string;
  errorId: string;
  noticeId: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldState | null>(null);

/** The attributes a control needs to belong to its field. */
export function useFieldControl(own?: { id?: string | undefined; 'aria-describedby'?: string | undefined }) {
  const field = useContext(FieldContext);
  if (!field) return { id: own?.id, 'aria-describedby': own?.['aria-describedby'], noticeId: undefined };
  const describedBy = [
    field.hintId,
    field.invalid ? field.errorId : null,
    field.noticeId,
    own?.['aria-describedby'],
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id: own?.id ?? field.id,
    'aria-describedby': describedBy,
    'aria-invalid': field.invalid || undefined,
    'aria-required': field.required || undefined,
    noticeId: field.noticeId,
  };
}

export function Field({
  label,
  hint,
  error,
  required,
  optionalLabel = true,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  /** Say "(optional)" next to fields that aren't required, instead of starring required ones. */
  optionalLabel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const base = useId();
  const state: FieldState = {
    id: `${base}-control`,
    hintId: `${base}-hint`,
    errorId: `${base}-error`,
    noticeId: `${base}-notice`,
    invalid: Boolean(error),
    required: Boolean(required),
  };
  return (
    <FieldContext value={state}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={state.id} className="text-sm font-medium text-ink">
          {label}
          {!required && optionalLabel && <span className="font-normal text-ink-3"> (optional)</span>}
        </label>
        {hint && (
          <p id={state.hintId} className="text-sm text-ink-3">
            {hint}
          </p>
        )}
        {children}
        {error && (
          <p id={state.errorId} className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext>
  );
}
