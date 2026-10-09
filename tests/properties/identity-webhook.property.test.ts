import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyIdentityWebhookEvent,
  type IdentityWebhookEvent,
} from "../../convex/lib/identityWebhook";
import { createIdentityMirrorPortFixture } from "../fixtures/identity-mirror-port";

describe("identity event watermarks", () => {
  it("converges on deletion for every delivery order of a Clerk user lifecycle", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 0, max: 0x7fffffff }),
        async (timestamps, shuffleSeed) => {
          const fixture = createIdentityMirrorPortFixture();
          // A deleted Clerk ID cannot be reused. Generate a valid lifecycle:
          // profile changes followed by one terminal deletion.
          const events: IdentityWebhookEvent[] = [...timestamps]
            .sort((a, b) => a - b)
            .map((eventAt, index): IdentityWebhookEvent =>
              index < timestamps.length - 1
                ? {
                    eventId: `evt_${eventAt}`,
                    eventAt,
                    type: "user.upsert",
                    data: {
                      clerkUserId: "user_shared",
                      displayName: `User ${index}`,
                    },
                  }
                : {
                    eventId: `evt_${eventAt}`,
                    eventAt,
                    type: "user.delete",
                    data: { clerkUserId: "user_shared" },
                  },
            );
          const shuffled = fc.sample(
            fc.shuffledSubarray(events, {
              minLength: events.length,
              maxLength: events.length,
            }),
            { seed: shuffleSeed, numRuns: 1 },
          )[0]!;

          for (const event of shuffled) {
            await applyIdentityWebhookEvent(event, fixture.port);
          }

          const newest = events.reduce((left, right) =>
            left.eventAt > right.eventAt ? left : right,
          );
          expect(fixture.user("user_shared")?.clerkLastEventAt).toBe(
            newest.eventAt,
          );
          expect(fixture.user("user_shared")?.status).toBe(
            newest.type === "user.delete" ? "DEACTIVATED" : "ACTIVE",
          );
        },
      ),
      { seed: 20260803, numRuns: 100 },
    );
  });
});
