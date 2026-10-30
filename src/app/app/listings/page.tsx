"use client";

import { api } from "@convex/_generated/api";
import { CATEGORIES, CONDITIONS, type Category, type Condition } from "@convex/lib/validators";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
import { Ready } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, EmptyState, Field, inputClass, Loading, PageHeader } from "@/components/ui";
import { CATEGORY_LABELS, CONDITION_LABELS, errorMessage } from "@/lib/format";

type Listing = FunctionReturnType<typeof api.tools.mine>[number];
type ListingInput = { name: string; category: Category; condition: Condition; description: string };

const EMPTY: ListingInput = { name: "", category: "power_tools", condition: "good", description: "" };

export default function ListingsPage() {
  return (
    <Ready>
      <Listings />
    </Ready>
  );
}

function Listings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="My listings" description="Tools you are lending to the neighborhood." />
        {!showForm && <Button onClick={() => setShowForm(true)}>List a tool</Button>}
      </div>

      {showForm && (
        <Card className="mb-6">
          <ListingForm
            initial={EMPTY}
            submitLabel="List tool"
            onCancel={() => setShowForm(false)}
            onSubmit={async (input) => {
              await create(input);
              toast.success(`${input.name} is now listed.`);
              setShowForm(false);
            }}
          />
        </Card>
      )}

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        !showForm && <EmptyState title="You are not lending anything yet">List a tool to get started.</EmptyState>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <ListingRow key={tool._id} tool={tool} />
          ))}
        </div>
      )}
    </>
  );
}

function ListingRow({ tool }: { tool: Listing }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <ListingForm
          initial={tool}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            await update({ toolId: tool._id, ...input });
            toast.success("Listing updated.");
            setEditing(false);
          }}
        />
      </Card>
    );
  }

  async function onDelete() {
    const warning =
      tool.pendingRequests > 0
        ? `Delete ${tool.name}? Its ${tool.pendingRequests} pending request(s) will be declined.`
        : `Delete ${tool.name}?`;
    if (!window.confirm(warning)) return;
    try {
      await remove({ toolId: tool._id });
      toast.success("Listing deleted.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{tool.name}</h2>
          {tool.status === "available" ? <Badge tone="green">Available</Badge> : <Badge tone="amber">On loan</Badge>}
          {tool.pendingRequests > 0 && <Badge tone="amber">{tool.pendingRequests} pending</Badge>}
        </div>
        <p className="text-sm text-stone-500">
          {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
        </p>
        <p className="mt-1 text-sm text-stone-700">{tool.description}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

function ListingForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ListingInput;
  submitLabel: string;
  onSubmit: (input: ListingInput) => Promise<void>;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [input, setInput] = useState<ListingInput>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(input);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field label="Name">
            <input
              className={inputClass}
              value={input.name}
              maxLength={80}
              required
              placeholder="Cordless drill"
              onChange={(e) => setInput({ ...input, name: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Category">
          <select
            className={inputClass}
            value={input.category}
            onChange={(e) => setInput({ ...input, category: e.target.value as Category })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select
            className={inputClass}
            value={input.condition}
            onChange={(e) => setInput({ ...input, condition: e.target.value as Condition })}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Short description">
        <textarea
          className={inputClass}
          rows={3}
          maxLength={500}
          required
          placeholder="18V, two batteries and a bit set. Please charge it before returning."
          value={input.description}
          onChange={(e) => setInput({ ...input, description: e.target.value })}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
