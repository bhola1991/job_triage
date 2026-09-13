export interface PostingLinkProps {
  /** The saved posting URL. Empty, missing, or the literal "nan" a CSV import writes all count as no link. */
  url?: string;
  title: string;
  company?: string;
  location?: string;
}

/** The link to a job's original posting, or a Google search for it when no link was saved. */
export function PostingLink({ url, title, company, location }: PostingLinkProps) {
  const saved = String(url ?? '').trim();
  const has = saved !== '' && saved.toLowerCase() !== 'nan';
  const href = has
    ? saved
    : `https://www.google.com/search?q=${encodeURIComponent([title, company, location, 'job'].filter(Boolean).join(' '))}`;
  return (
    <a data-palette="v2" className="posting-link" href={href} target="_blank" rel="noopener">
      {has ? 'open the original posting ↗' : 'no link saved — search Google for it ↗'}
    </a>
  );
}
