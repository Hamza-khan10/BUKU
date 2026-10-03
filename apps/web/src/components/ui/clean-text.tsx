'use client';

import {
  KIND_HINTS,
  normalizeText,
  removeDisallowed,
  TEXT_PROBLEM_MESSAGES,
  textProblem,
  type TextKind,
} from '@buku/validation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type CompositionEvent,
  type FocusEvent,
} from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { controlStyles } from './input';

/**
 * Text inputs that keep BUKU's data clean (WEB_PLAN §6, D-083) — the same
 * rules the API enforces, applied while typing:
 *
 *  • what this kind of text never accepts (emoji, invisible characters; digits
 *    in a name…) is removed as it arrives — typed, pasted, dropped or picked
 *    from an emoji keyboard — with a short, polite note saying why;
 *  • the cursor stays where it was;
 *  • while an input method is composing (Urdu, Chinese…) nothing is touched
 *    until the character is finished;
 *  • on leaving the field the text is normalised (spaces, styled letters), so
 *    people see exactly what will be saved.
 *
 * Works with React Hook Form's register() and with controlled values.
 */

type Control = HTMLInputElement | HTMLTextAreaElement;

/** Set a value the way typing does, so React (and form libraries) see the change. */
function setNativeValue(el: Control, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function noticeFor(raw: string, kind: TextKind): string {
  const problem = textProblem(raw, kind);
  if (problem === 'emoji') return TEXT_PROBLEM_MESSAGES.emoji;
  if (problem === 'invisible' || problem === 'control') return TEXT_PROBLEM_MESSAGES.invisible;
  if (kind === 'personName' || kind === 'title') return KIND_HINTS[kind];
  return TEXT_PROBLEM_MESSAGES.characters;
}

function useCleanText(kind: TextKind) {
  const [notice, setNotice] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const composingRef = useRef(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const tell = (message: string) => {
    setNotice(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(''), 5000);
  };

  /** Remove what isn't allowed; returns true if anything changed. */
  const clean = (el: Control, viaEvent: boolean): boolean => {
    const raw = el.value;
    const cleaned = removeDisallowed(raw, kind);
    if (cleaned === raw) return false;
    const caret = removeDisallowed(raw.slice(0, el.selectionStart ?? raw.length), kind).length;
    tell(noticeFor(raw, kind));
    if (viaEvent) el.value = cleaned;
    else setNativeValue(el, cleaned);
    if (document.activeElement === el) el.setSelectionRange(caret, caret);
    return true;
  };

  return { notice, composingRef, clean };
}

interface CleanProps {
  /** Which rules apply: personName, title, line or text. */
  kind: TextKind;
}

function useHandlers<E extends Control>(
  kind: TextKind,
  props: {
    onChange?: ((e: ChangeEvent<E>) => void) | undefined;
    onBlur?: ((e: FocusEvent<E>) => void) | undefined;
    onCompositionStart?: ((e: CompositionEvent<E>) => void) | undefined;
    onCompositionEnd?: ((e: CompositionEvent<E>) => void) | undefined;
  },
) {
  const { notice, composingRef, clean } = useCleanText(kind);
  return {
    notice,
    handlers: {
      onChange: (e: ChangeEvent<E>) => {
        if (!composingRef.current) clean(e.currentTarget, true);
        props.onChange?.(e);
      },
      onCompositionStart: (e: CompositionEvent<E>) => {
        composingRef.current = true;
        props.onCompositionStart?.(e);
      },
      onCompositionEnd: (e: CompositionEvent<E>) => {
        composingRef.current = false;
        clean(e.currentTarget, false);
        props.onCompositionEnd?.(e);
      },
      onBlur: (e: FocusEvent<E>) => {
        const el = e.currentTarget;
        const normal = normalizeText(el.value, kind);
        if (normal !== el.value) setNativeValue(el, normal);
        props.onBlur?.(e);
      },
    },
  };
}

function Notice({ id, children }: { id: string; children: string }) {
  // Always rendered, so screen readers are listening before a note appears.
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className={cn('text-sm text-wait-ink', !children && 'sr-only')}
    >
      {children}
    </p>
  );
}

export function CleanTextInput({ kind, className, ...props }: ComponentProps<'input'> & CleanProps) {
  const ownNotice = useId();
  const { noticeId, ...field } = useFieldControl(props);
  const { notice, handlers } = useHandlers<HTMLInputElement>(kind, props);
  return (
    <>
      <input
        {...props}
        {...field}
        {...handlers}
        aria-describedby={noticeId ? field['aria-describedby'] : ownNotice}
        className={cn(controlStyles, 'h-11', className)}
      />
      <Notice id={noticeId ?? ownNotice}>{notice}</Notice>
    </>
  );
}

export function CleanTextarea({ kind, className, ...props }: ComponentProps<'textarea'> & CleanProps) {
  const ownNotice = useId();
  const { noticeId, ...field } = useFieldControl(props);
  const { notice, handlers } = useHandlers<HTMLTextAreaElement>(kind, props);
  return (
    <>
      <textarea
        {...props}
        {...field}
        {...handlers}
        aria-describedby={noticeId ? field['aria-describedby'] : ownNotice}
        className={cn(controlStyles, 'min-h-28 py-2.5 leading-relaxed', className)}
      />
      <Notice id={noticeId ?? ownNotice}>{notice}</Notice>
    </>
  );
}
