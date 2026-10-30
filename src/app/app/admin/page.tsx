"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Ready, useMe } from "@/components/AppShell";
import { ActionButton, Section } from "@/components/LoanCard";
import { LoanStatusBadge } from "@/components/LoanBits";
import { Badge, Card, EmptyState, Loading, PageHeader } from "@/components/ui";
import { CATEGORY_LABELS, formatRange, timeAgo } from "@/lib/format";

export default function AdminPage() {
  return (
    <Ready>
      <AdminGate />
    </Ready>
  );
}

function AdminGate() {
  const me = useMe();
  // The UI hides this page from non-admins, but the queries below are what
  // actually enforce it: each one calls requireAdmin on the server.
  if (me.role !== "admin") return <EmptyState title="Admins only" />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const health = useQuery(api.admin.automationHealth);
  const loans = useQuery(api.admin.allLoans);
  const lenders = useQuery(api.admin.lenders);
  const listings = useQuery(api.admin.listings);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const removeTool = useMutation(api.tools.remove);

  return (
    <>
      <PageHeader title="Admin" description="Automation health, every loan, lenders and listings." />

      <Section title="Automation health">
        {health === undefined ? (
          <Loading />
        ) : (
          <Card>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone={health.failedNotifications.length ? "red" : "green"}>
                {health.failedNotifications.length} failed notifications
              </Badge>
              <Badge tone={health.retrying ? "amber" : "green"}>{health.retrying} retrying</Badge>
              <Badge tone={health.workflowErrors.length ? "red" : "green"}>
                {health.workflowErrors.length} n8n workflow errors
              </Badge>
            </div>
            {health.failedNotifications.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {health.failedNotifications.map((n) => (
                  <li key={n._id} className="text-red-700">
                    {n.type} {n.status} after {n.attempts} attempt(s): {n.lastError}{" "}
                    <span className="text-stone-400">· {timeAgo(n.at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {health.workflowErrors.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {health.workflowErrors.map((e) => (
                  <li key={e._id} className="text-red-700">
                    {e.workflowName}
                    {e.node ? ` › ${e.node}` : ""}: {e.message}{" "}
                    <span className="text-stone-400">
                      · execution {e.executionId} · {timeAgo(e.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {health.recentReminders.length > 0 && (
              <p className="mt-4 text-sm text-stone-500">
                Last overdue reminder {health.recentReminders[0].status}{" "}
                {timeAgo(health.recentReminders[0].at)}.
              </p>
            )}
          </Card>
        )}
      </Section>

      <Section title="All loans">
        {loans === undefined ? (
          <Loading />
        ) : loans.length === 0 ? (
          <EmptyState title="No loans yet" />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Tool</th>
                  <th className="px-4 py-2 font-medium">Lender</th>
                  <th className="px-4 py-2 font-medium">Borrower</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan._id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2">{loan.toolName}</td>
                    <td className="px-4 py-2">{loan.lender}</td>
                    <td className="px-4 py-2">{loan.borrower}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatRange(loan.startDate, loan.endDate)}</td>
                    <td className="px-4 py-2">
                      <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      <Section title="Lenders">
        {lenders === undefined ? (
          <Loading />
        ) : lenders.length === 0 ? (
          <EmptyState title="Nobody has listed a tool yet" />
        ) : (
          lenders.map((lender) => (
            <Card key={lender._id} className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {lender.firstName}
                  {lender.trustedLender && <Badge tone="blue">Trusted Lender</Badge>}
                </p>
                <p className="text-sm text-stone-500">
                  {lender.email} · {lender.listings} listing(s)
                </p>
              </div>
              <ActionButton
                label={lender.trustedLender ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
                variant={lender.trustedLender ? "secondary" : "primary"}
                run={() => setTrusted({ userId: lender._id, trusted: !lender.trustedLender })}
                success="Lender updated."
              />
            </Card>
          ))
        )}
      </Section>

      <Section title="Listings">
        {listings === undefined ? (
          <Loading />
        ) : listings.length === 0 ? (
          <EmptyState title="No listings" />
        ) : (
          listings.map((tool) => (
            <Card key={tool._id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{tool.name}</p>
                <p className="text-sm text-stone-500">
                  {CATEGORY_LABELS[tool.category]} · listed by {tool.owner}
                </p>
              </div>
              <ActionButton
                label="Remove listing"
                variant="danger"
                confirm={`Remove ${tool.name}? Pending requests for it will be declined.`}
                run={() => removeTool({ toolId: tool._id })}
                success="Listing removed."
              />
            </Card>
          ))
        )}
      </Section>
    </>
  );
}
