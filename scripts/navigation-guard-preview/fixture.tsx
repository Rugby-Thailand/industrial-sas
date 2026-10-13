"use client";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";

import { useFloorWorkspaceView } from "@/components/storageLayouts/useFloorWorkspaceView";
import { useNavigationDraft } from "@/components/navigation/NavigationGuardProvider";
import { useHrListCriteria } from "@/features/hr/HrListCriteria";
import { Link, useRouter } from "@/i18n/navigation";
import { updateBrowserQuery } from "@/lib/browser/history";
import { StorageFixture } from "./storageFixture";

export function Fixture({ screen }: { readonly screen: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { view, setView, workspaceRef } = useFloorWorkspaceView();
  const [criteria, setCriteria] = useHrListCriteria(
    { q: "", site: "" },
    "navigation-fixture",
  );
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pendingA, setPendingA] = useState(false);
  const [pendingB, setPendingB] = useState(false);
  const [draftB, setDraftB] = useState("");
  const [mode, setMode] = useState("single");
  const [saves, setSaves] = useState(0);
  const [discards, setDiscards] = useState(0);
  const saveStarted = useRef(false);
  const guard = useNavigationDraft({
    dirty,
    pending: pendingA,
    discard: () => {
      setDirty(false);
      setDraft("");
      setDiscards((value) => value + 1);
    },
    save: async () => {
      if (saveStarted.current) throw new Error("duplicate save");
      saveStarted.current = true;
      setSaves((value) => value + 1);
      setPendingA(true);
      if (mode === "pending") {
        setDraftB("Pending B contents");
        setPendingB(true);
      }
      // Browser tests hold this request, then release it after observing the prompt.
      // Floor reports clean through React, without an explicit settle().
      try {
        await fetch("/fixture-save", { method: "POST" });
        setDirty(false);
        return true;
      } finally {
        setPendingA(false);
      }
    },
  });
  useNavigationDraft({
    dirty: draftB !== "",
    pending: pendingB,
    discard: () => {
      setDraftB("");
      setDiscards((value) => value + 1);
    },
  });
  function depart() {
    sessionStorage.setItem(
      "navigation-executions",
      String(Number(sessionStorage.getItem("navigation-executions") ?? 0) + 1),
    );
    router.push("/target?kept=1#arrival");
  }
  function finishAWithQueuedB(queryMode?: "push" | "replace") {
    setDirty(false);
    guard.settle(depart);
    // B registers after native Back was queued, in this same JavaScript task.
    flushSync(() => {
      setDraftB("Queued B contents");
      setPendingB(true);
    });
    if (queryMode)
      updateBrowserQuery((query) => query.set("panel", "list"), {
        mode: queryMode,
      });
  }
  return (
    <main>
      <h1>{screen}</h1>
      <nav>
        <Link href="/storage?floor=1&view=storage&kept=yes#map">
          Open storage workspace
        </Link>
        <Link href="/editor?floor=1&view=storage&q=initial#section">
          Open editor
        </Link>
        <Link href="/previous">Previous page</Link>
      </nav>
      <div ref={workspaceRef}>
        <p data-testid="floor-view">{view}</p>
      </div>
      <p data-testid="hr-query">{criteria.q}</p>
      <p data-testid="next-query">{params.toString()}</p>
      <p data-testid="saves">{saves}</p>
      <p data-testid="discards">{discards}</p>
      <p data-testid="draft-b">{draftB}</p>
      {screen === "storage" ? <StorageFixture /> : null}
      {screen === "editor" ? (
        <>
          <label>
            Save scenario
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="single">Single draft</option>
              <option value="pending">B becomes pending</option>
            </select>
          </label>
          <label>
            Draft A
            <input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <button onClick={() => guard.requestTransition(depart)}>
            Leave editor
          </button>
          <button onClick={() => setPendingB(false)}>Finish B write</button>
          <button onClick={() => finishAWithQueuedB()}>
            Finish A with queued B
          </button>
          <button onClick={() => finishAWithQueuedB("push")}>
            Finish A with queued B and push
          </button>
          <button onClick={() => finishAWithQueuedB("replace")}>
            Finish A with queued B and replace
          </button>
          <button onClick={() => setView("list")}>Floor list view</button>
          <button onClick={() => setCriteria({ q: "updated" })}>
            HR query push
          </button>
        </>
      ) : null}
      <div id="arrival">Destination contents</div>
    </main>
  );
}
