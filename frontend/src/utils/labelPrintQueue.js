const copies = (item) => Math.max(1, Math.min(1000, Number(item.quantity) || 1));

export function removePrintedCopies(queue, printedItems) {
  const printedCounts = new Map(printedItems.map((item) => [item.id, copies(item)]));
  return queue.flatMap((item) => {
    if (!printedCounts.has(item.id)) return [item];
    const remaining = copies(item) - printedCounts.get(item.id);
    return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
  });
}

export async function waitForLabelPrintJob(jobId, fetchJob, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90000;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const job = await fetchJob(jobId);
    if (job?.job_id === jobId) {
      if (job.status === "completed") return job;
      if (job.status === "failed") throw new Error(job.error_message || "Printing failed on agent.");
    }
    await sleep(pollIntervalMs);
  }
  throw new Error("Print confirmation timed out. Check the printer before trying again.");
}
