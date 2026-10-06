import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
      <Link href="/" className="w-fit font-medium text-brand underline-offset-4 hover:underline">
        Back to the start
      </Link>
    </div>
  );
}
