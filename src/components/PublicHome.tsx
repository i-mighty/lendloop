"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { CATEGORY_LABELS } from "@/lib/format";
import { Button, buttonClass, EmptyState } from "./ui";

export function HeroActions({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/app">
          <Button variant={compact ? "secondary" : "primary"} className={compact ? "" : "px-5 py-2.5"}>
            Sign in to lend or borrow
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/app"
          className={buttonClass(compact ? "secondary" : "primary", compact ? "" : "px-5 py-2.5")}
        >
          Open LendLoop
        </Link>
      </Show>
    </>
  );
}

export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) {
    return (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="h-[68px] animate-pulse rounded-xl bg-stone-200/60" />
        ))}
      </ul>
    );
  }
  if (tools.length === 0) {
    return <EmptyState title="Nothing listed yet">Be the first on your street to lend something.</EmptyState>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool, i) => (
        <li key={`${tool.name}-${i}`} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <p className="font-medium">{tool.name}</p>
          <p className="text-sm text-stone-500">{CATEGORY_LABELS[tool.category]}</p>
        </li>
      ))}
    </ul>
  );
}
