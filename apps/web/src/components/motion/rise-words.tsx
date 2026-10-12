import { Fragment, type CSSProperties } from 'react';

/**
 * A headline whose words rise into place one after another as the page opens
 * (pure CSS, so the words are always there even without scripts; still under
 * reduced motion). Screen readers hear the sentence as written.
 */
export function RiseWords({ text, from = 0 }: { text: string; from?: number }) {
  const words = text.split(' ');
  return (
    <>
      {/* The spaces sit between the words: one at the end of an inline block would collapse. */}
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          {i > 0 ? ' ' : null}
          <span className="rise-word" style={{ '--i': from + i } as CSSProperties}>
            {word}
          </span>
        </Fragment>
      ))}
    </>
  );
}
