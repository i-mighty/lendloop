"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { formatRange, errorMessage } from "@/lib/format";
import { ActivityList, LoanStatusBadge, TrustedBadge } from "./LoanBits";
import { useToast } from "./Toast";
import { Button, Card } from "./ui";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanCard({
  loan,
  perspective,
  actions,
}: {
  loan: LoanView;
  perspective: "borrower" | "lender";
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{loan.toolName}</h2>
            <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            {formatRange(loan.startDate, loan.endDate)} ·{" "}
            {perspective === "borrower"
              ? `from ${loan.counterpart.firstName}`
              : `requested by ${loan.counterpart.firstName}`}
            {loan.counterpart.trustedLender && <TrustedBadge />}
          </p>
          {loan.note && <p className="mt-2 text-sm text-stone-700">&ldquo;{loan.note}&rdquo;</p>}
          {loan.closedReason && <p className="mt-2 text-sm text-stone-500">{loan.closedReason}.</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      <ActivityList items={loan.activity} />
    </Card>
  );
}

// Runs a mutation with a busy state and a toast for the result.
export function ActionButton({
  label,
  run,
  success,
  variant = "secondary",
  confirm,
}: {
  label: string;
  run: () => Promise<unknown>;
  success: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      disabled={busy}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          await run();
          toast.success(success);
        } catch (error) {
          toast.error(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
