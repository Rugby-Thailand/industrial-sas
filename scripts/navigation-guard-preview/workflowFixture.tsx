"use client";

import { useState } from "react";
import { useNavigationDraft } from "@/components/navigation/NavigationGuardProvider";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";

/** Real guard/workflow hooks; the held write has no backend or fixture data. */
export function WorkflowFixture() {
  const [ticket, setTicket] = useState("");
  const [pending, setPending] = useState(false);
  const step = useWorkflowStep("ticketStep", "navigation-fixture:ticket", true);
  useNavigationDraft({
    dirty: ticket !== "",
    pending,
    workflowScope: "navigation-fixture:ticket",
    discard: () => setTicket(""),
  });
  async function holdWrite() {
    setPending(true);
    try {
      await fetch("/fixture-save", { method: "POST" });
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="Retained workflow">
      <p data-testid="workflow-step">
        {step.active ? "Tickets" : "Location question"}
      </p>
      <label>
        Ticket
        <input
          value={ticket}
          onChange={(event) => setTicket(event.target.value)}
        />
      </label>
      <button onClick={() => step.enter()}>Open tickets</button>
      <button onClick={() => step.back()}>Workflow Back</button>
      <button disabled={pending} onClick={() => void holdWrite()}>
        Hold ticket write
      </button>
      <p data-testid="workflow-write">{pending ? "Pending" : "Idle"}</p>
    </section>
  );
}
