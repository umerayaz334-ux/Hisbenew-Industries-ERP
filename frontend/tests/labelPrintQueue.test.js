import test from "node:test";
import assert from "node:assert/strict";
import { removePrintedCopies, waitForLabelPrintJob } from "../src/utils/labelPrintQueue.js";

test("printing one row removes only its submitted copies", () => {
  const queue = [{ id: "a", quantity: 3 }, { id: "b", quantity: 2 }];
  assert.deepEqual(removePrintedCopies(queue, [queue[0]]), [queue[1]]);
  assert.equal(queue.length, 2);
});

test("printing the entire queue clears the submitted rows", () => {
  const queue = [{ id: "a", quantity: 3 }, { id: "b", quantity: 2 }];
  assert.deepEqual(removePrintedCopies(queue, queue), []);
});

test("new rows and copies added while printing stay queued", () => {
  const submitted = [{ id: "a", quantity: 3 }];
  const current = [{ id: "a", quantity: 5 }, { id: "new", quantity: 1 }];
  assert.deepEqual(removePrintedCopies(current, submitted), [
    { id: "a", quantity: 2 }, { id: "new", quantity: 1 },
  ]);
});

test("a queued job waits for the matching completion", async () => {
  const statuses = [
    { job_id: "other", status: "completed" },
    { job_id: "print-1", status: "pending" },
    { job_id: "print-1", status: "printing" },
    { job_id: "print-1", status: "completed" },
  ];
  let calls = 0;
  const result = await waitForLabelPrintJob("print-1", async () => statuses[calls++], {
    sleep: async () => {},
  });
  assert.equal(calls, 4);
  assert.equal(result.status, "completed");
});

test("failed jobs do not report successful completion", async () => {
  await assert.rejects(waitForLabelPrintJob("print-1", async () => ({
    job_id: "print-1", status: "failed", error_message: "Printer offline",
  })), /Printer offline/);
});

test("missing confirmation times out instead of clearing labels", async () => {
  let elapsed = 0;
  await assert.rejects(waitForLabelPrintJob("print-1", async () => undefined, {
    timeoutMs: 3000,
    pollIntervalMs: 1000,
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
  }), /Print confirmation timed out/);
});
