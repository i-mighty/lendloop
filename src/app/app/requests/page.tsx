"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Ready } from "@/components/AppShell";
import { ActionButton, LoanCard, Section } from "@/components/LoanCard";
import { EmptyState, Loading, PageHeader } from "@/components/ui";

export default function MyRequestsPage() {
  return (
    <Ready>
      <MyRequests />
    </Ready>
  );
}

function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);

  if (loans === undefined) return <Loading />;

  const open = loans.filter((l) => l.status === "pending" || l.status === "approved");
  const past = loans.filter((l) => l.status !== "pending" && l.status !== "approved");

  return (
    <>
      <PageHeader title="My requests" description="Tools you asked to borrow, and where each one stands." />
      {loans.length === 0 && (
        <EmptyState title="No requests yet">Find something in Browse and request it.</EmptyState>
      )}
      {open.length > 0 && (
        <Section title="Open">
          {open.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              perspective="borrower"
              actions={
                loan.status === "pending" && (
                  <ActionButton
                    label="Cancel request"
                    variant="danger"
                    confirm={`Cancel your request for ${loan.toolName}?`}
                    run={() => cancel({ loanId: loan._id })}
                    success="Request cancelled."
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
            <LoanCard key={loan._id} loan={loan} perspective="borrower" />
          ))}
        </Section>
      )}
    </>
  );
}
