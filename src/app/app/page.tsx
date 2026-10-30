"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORIES, type Category } from "@convex/lib/validators";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent, type ReactNode } from "react";
import { Ready } from "@/components/AppShell";
import { TrustedBadge } from "@/components/LoanBits";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, EmptyState, Field, inputClass, Loading, PageHeader } from "@/components/ui";
import { CATEGORY_LABELS, CONDITION_LABELS, errorMessage, todayUtc } from "@/lib/format";

export default function BrowsePage() {
  return (
    <Ready>
      <Browse />
    </Ready>
  );
}

function Browse() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.list, { category });

  return (
    <>
      <PageHeader title="Browse tools" description="Everything your neighbors are lending." />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip active={category === undefined} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </FilterChip>
        ))}
      </div>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title="No tools here yet">
          {category ? "Try another category." : "List one from My listings."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} />
          ))}
        </div>
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-sm transition-colors ${
        active ? "bg-emerald-700 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

type Tool = FunctionReturnType<typeof api.tools.list>[number];

function ToolCard({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tool.name}</h2>
          <p className="text-sm text-stone-500">
            {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          </p>
        </div>
        {tool.status === "available" ? <Badge tone="green">Available</Badge> : <Badge tone="amber">On loan</Badge>}
      </div>
      <p className="mt-3 flex-1 text-sm text-stone-700">{tool.description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-stone-500">
          {tool.isMine ? "Your listing" : `Lent by ${tool.owner.firstName}`}
          {!tool.isMine && tool.owner.trustedLender && <TrustedBadge />}
        </p>
        {!tool.isMine &&
          (tool.requestedByMe ? (
            <Badge tone="amber">Request pending</Badge>
          ) : (
            !open && (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Request to borrow
              </Button>
            )
          ))}
      </div>
      {open && <RequestForm toolId={tool._id} onDone={() => setOpen(false)} />}
    </Card>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const toast = useToast();
  const today = todayUtc();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request({ toolId, startDate, endDate, note: note || undefined });
      toast.success("Request sent. The lender has been notified.");
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-stone-100 pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input
            type="date"
            className={inputClass}
            min={today}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
            required
          />
        </Field>
        <Field label="Until">
          <input
            type="date"
            className={inputClass}
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Note for the lender (optional)">
        <input
          className={inputClass}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is it for? When can you pick it up?"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}
