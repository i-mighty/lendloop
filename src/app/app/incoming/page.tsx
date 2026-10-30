"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Ready } from "@/components/AppShell";
import { ActionButton, LoanCard, Section } from "@/components/LoanCard";
import { EmptyState, Loading, PageHeader } from "@/components/ui";

export default function IncomingRequestsPage() {
  return (
    <Ready>
      <IncomingRequests />
    </Ready>
  );
}

function IncomingRequests() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);

  if (loans === undefined) return <Loading />;

  const pending = loans.filter((l) => l.status === "pending");
  const active = loans.filter((l) => l.status === "approved");
  const past = loans.filter((l) => l.status !== "pending" && l.status !== "approved");

  return (
    <>
      <PageHeader title="Incoming requests" description="Requests to borrow your tools." />
      {loans.length === 0 && (
        <EmptyState title="No requests yet">When a neighbor asks to borrow one of your tools, it shows up here.</EmptyState>
      )}

      {pending.length > 0 && (
        <Section title="Waiting for you">
          {pending.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              perspective="lender"
              actions={
                <>
                  <ActionButton
                    label="Decline"
                    variant="danger"
                    run={() => decline({ loanId: loan._id })}
                    success="Request declined."
                  />
                  <ActionButton
                    label="Approve"
                    variant="primary"
                    run={() => approve({ loanId: loan._id })}
                    success="Approved. The borrower has been notified."
                  />
                </>
              }
            />
          ))}
        </Section>
      )}

      {active.length > 0 && (
        <Section title="Lent out">
          {active.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              perspective="lender"
              actions={
                loan.started && (
                  <ActionButton
                    label="Mark returned"
                    run={() => markReturned({ loanId: loan._id })}
                    success="Marked as returned."
                  />
                )
              }
            />
          ))}
        </Section>
      )}

      {past.length > 0 && (
        <Section title="History">
          {past.map((loan) => (
            <LoanCard key={loan._id} loan={loan} perspective="lender" />
          ))}
        </Section>
      )}
    </>
  );
}
