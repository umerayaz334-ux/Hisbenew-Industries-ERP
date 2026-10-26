import customerLayout from "../../../backend/app/email_templates/customer.html?raw";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function customerEmail(settings, eventKey, context, heading, preheader, body) {
  const style = settings.style || {};
  const accent = /^#[0-9a-f]{3,8}$/i.test(style.accent_color || "") ? style.accent_color : "#173a57";
  const brand = settings.from_name || "Hisbenew Industries";
  const value = (key, fallback = "—") => escape(context[key] || fallback);
  const tracking = eventKey === "service_taker_tracking";
  const lines = [];
  for (const line of body.split("\n")) {
    if (tracking && line.startsWith("Tracking has been added or updated")) continue;
    if (/^(Package:|Courier:|Tracking number:|Total pending balance:|Total account amount due:)/.test(line)) continue;
    if (line.startsWith("Thank you")) break;
    lines.push(line);
  }
  const shipment = tracking ? `<tr><td style="padding:0 22px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e1e7ed;border-radius:12px;background:#ffffff">
<tr><td style="padding:12px 16px;border-bottom:1px solid #edf0f4"><span style="color:#8a95a3;font-size:10px;letter-spacing:1.4px">ORDER</span><strong style="float:right;color:#263d53;font-size:12px">${value("order_no")}</strong></td></tr>
<tr><td style="padding:14px"><div style="font-size:17px;font-weight:700;color:#20364d">${value("product_name")}</div><p style="margin:6px 0 12px;color:#798597;font-size:12px;line-height:1.7">${value("package_details")}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fa;border-radius:8px"><tr><td style="padding:12px"><div style="font-size:9px;color:#7b8899;letter-spacing:1.4px">TRACKING NUMBER · ${value("courier")}</div><div style="margin-top:8px;font-family:Consolas,monospace;font-size:18px;font-weight:700;color:#1f3b56;word-break:break-all">${value("tracking_number")}</div></td></tr></table>
</td></tr></table></td></tr>` : "";
  const balance = `<tr><td style="padding:0 28px 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f5ee;border:1px solid #ece4d3;border-radius:12px"><tr><td style="padding:14px"><div style="font-size:9px;letter-spacing:1.4px;color:#987d47">TOTAL PENDING BALANCE</div><div style="margin-top:9px;color:#25374a;font-family:Georgia,serif;font-size:30px">${value("currency", "USD")} ${value("account_balance", "0.00")}</div></td></tr></table></td></tr>`;
  const buttonUrl = style.button_url || "";
  const button = /^https?:\/\//.test(buttonUrl) ? `<tr><td style="padding:22px 28px 0"><a href="${escape(buttonUrl)}" style="display:inline-block;padding:13px 22px;background:${accent};border-radius:8px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none">${escape(style.button_label || "Open portal")}</a></td></tr>` : "";
  const fields = { accent, brand: escape(brand), initial: escape(brand.slice(0, 1).toUpperCase()),
    preheader: escape(preheader), heading: escape(heading), message: lines.some((line) => line.trim()) ? `<div style="margin-top:10px;color:#6b7788;font-size:13px;line-height:1.6">${lines.join("\n").trim().split("\n").map(escape).join("<br>")}</div>` : "",
    category: tracking ? "SHIPMENT UPDATE" : "ACCOUNT REMINDER", shipment, balance: tracking ? "" : balance, button,
    footer: escape(style.footer_text || "Sent securely by our customer services team."),
    sender: escape(settings.reply_to || settings.from_email || "") };
  return customerLayout.replace(/%%([a-z]+)%%/g, (_, key) => fields[key] || "");
}

export const emailSampleContext = (eventKey) => ({
  contact_name: "Alex", customer_name: "Alex Trading", company_name: "Hisbenew Industries",
  order_no: "LOCAL-1001", courier: "DHL", tracking_number: "1234567890",
  product_name: "Chef Knife Set", quantity: 24,
  package_details: "24 pieces · Individual boxes · Weight: 8.5 kg",
  packaging: "Individual boxes", shipping_weight_kg: "8.5",
  currency: "USD", account_balance: "250.00",
  worker_name: "Hafiz Umer", task_name: eventKey.startsWith("service_taker_") ? "" : "Polishing",
  batch_no: "PB-1001", due_date: "30 Oct 2026", notes: "Finish edge polishing before packing.",
});

export function renderEmailPreview(settings, eventKey) {
  const context = { ...emailSampleContext(eventKey), company_name: settings.from_name || "Hisbenew Industries" };
  const render = (value) => String(value || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => String(context[key] ?? ""));
  const event = settings.events?.[eventKey] || {};
  const style = settings.style || {};
  const subject = render(event.subject);
  const text = render(event.body);
  if (eventKey.startsWith("service_taker_")) {
    return { subject, text, html: customerEmail(settings, eventKey, context, render(event.heading) || subject, render(event.preheader), text) };
  }
  const accent = /^#[0-9a-f]{3,8}$/i.test(style.accent_color || "") ? style.accent_color : "#173a57";
  const buttonUrl = render(style.button_url);
  const button = /^https?:\/\//i.test(buttonUrl) ? `<p style="margin-top:24px"><a href="${escape(buttonUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:${accent};color:white;text-decoration:none">${escape(render(style.button_label) || "Open portal")}</a></p>` : "";
  return { subject, text, html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#172b3a"><div style="max-width:580px;margin:24px auto;padding:0 16px"><div style="padding:14px 0;font-size:13px;letter-spacing:1px;font-weight:700;color:${accent}">${escape(settings.from_name || "Hisbenew Industries")}</div><div style="background:white;border:1px solid #e1e7ec;border-radius:14px;overflow:hidden"><div style="height:5px;background:${accent}"></div><div style="padding:28px"><h1 style="font-size:24px;line-height:1.3;margin:0 0 22px">${escape(render(event.heading))}</h1><div style="font-size:14px;line-height:1.8;white-space:pre-wrap">${escape(text)}</div>${button}</div><div style="border-top:1px solid #edf0f3;padding:18px 28px;color:#72808d;font-size:12px;line-height:1.6">${escape(render(style.footer_text))}</div></div></div></body></html>` };
}
