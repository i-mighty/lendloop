import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full border-[3px] border-emerald-700"
        aria-hidden
      >
        <span className="h-2 w-2 rounded-full bg-emerald-700" />
      </span>
      LendLoop
    </Link>
  );
}
