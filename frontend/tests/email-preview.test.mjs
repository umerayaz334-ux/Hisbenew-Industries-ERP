import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const layout = await readFile(new URL("../../backend/app/email_templates/customer.html", import.meta.url), "utf8");
const source = (await readFile(new URL("../src/utils/emailPreview.js", import.meta.url), "utf8"))
  .replace(/^import customerLayout[^\n]+/m, `const customerLayout = ${JSON.stringify(layout)};`);
const { renderEmailPreview } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const settings = {
  from_name: "Hisbenew Industries", from_email: "info@hisbenew.com",
  events: {
    service_taker_tracking: { subject: "Order {{order_no}}", heading: "Your tracking update", body: "Hello {{contact_name}},\n\nTracking for {{product_name}}.\nPackage: {{package_details}}\nCourier: {{courier}}\nTracking number: {{tracking_number}}\nTotal pending balance: {{currency}} {{account_balance}}" },
    service_taker_balance_reminder: { subject: "Balance reminder", heading: "Your account balance", body: "Hello {{contact_name}},\n\nYour pending balance is {{currency}} {{account_balance}}." },
  },
};

test("tracking preview renders the customer design and package, never worker samples", () => {
  const preview = renderEmailPreview(settings, "service_taker_tracking");
  for (const content of ["Chef Knife Set", "Individual boxes", "1234567890", "background:#173a57"]) assert.ok(preview.html.includes(content));
  assert.ok(!preview.html.includes("USD 250.00"));
  assert.ok(!preview.html.includes("Polishing"));
  assert.ok(!preview.html.includes("Order amount due"));
  assert.ok(!preview.html.includes("%%"));
  assert.equal(preview.subject, "Order LOCAL-1001");
});

test("balance reminder uses the same brand layout without shipment details", () => {
  const preview = renderEmailPreview(settings, "service_taker_balance_reminder");
  assert.ok(!preview.html.includes("TRACKING NUMBER"));
  assert.ok(preview.html.includes("TOTAL PENDING BALANCE"));
});

test("preview changes immediately with selected template and escapes body edits", () => {
  const edited = structuredClone(settings);
  edited.events.service_taker_tracking.body = "<script>unsafe</script> {{product_name}}";
  assert.ok(renderEmailPreview(edited, "service_taker_tracking").html.includes("&lt;script&gt;"));
  assert.ok(!renderEmailPreview(edited, "service_taker_tracking").html.includes("<script>"));
});
