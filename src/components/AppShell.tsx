"use client";

import { UserButton } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { errorMessage } from "@/lib/format";
import { Logo } from "./Logo";
import { TrustedBadge } from "./LoanBits";
import { Loading } from "./ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;
const SessionContext = createContext<{ me: Me | undefined; setupError: string | null }>({
  me: undefined,
  setupError: null,
});
const MeContext = createContext<Me | null>(null);

// Renders its children once the signed-in user's row exists. Each page wraps its
// content in this, so the page segment itself always renders.
export function Ready({ children }: { children: ReactNode }) {
  const { me, setupError } = useContext(SessionContext);
  if (setupError) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{setupError}</p>;
  if (!me) return <Loading />;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (me === null) throw new Error("useMe must be used inside <Ready>");
  return me;
}

const NAV = [
  { href: "/app", label: "Browse" },
  { href: "/app/listings", label: "My listings" },
  { href: "/app/requests", label: "My requests" },
  { href: "/app/incoming", label: "Incoming requests" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [setupError, setSetupError] = useState<string | null>(null);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const pathname = usePathname();

  // Create or refresh our own user row once Convex has a verified token.
  useEffect(() => {
    if (!isAuthenticated) return;
    ensure().catch((error) => setSetupError(errorMessage(error)));
  }, [isAuthenticated, ensure]);

  const nav = me?.role === "admin" ? [...NAV, { href: "/app/admin", label: "Admin" }] : NAV;

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Logo href="/app" />
          <div className="flex items-center gap-3">
            {me?.trustedLender && <TrustedBadge />}
            {me && <span className="hidden text-sm text-stone-500 sm:inline">Hi, {me.firstName}</span>}
            <Suspense fallback={<span className="h-7 w-7 rounded-full bg-stone-200" />}>
              <UserButton />
            </Suspense>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {nav.map((item) => {
            const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <SessionContext.Provider value={{ me: me ?? undefined, setupError }}>
          {children}
        </SessionContext.Provider>
      </main>
    </div>
  );
}
