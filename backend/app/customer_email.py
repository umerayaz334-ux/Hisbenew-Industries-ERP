"""Customer emails share their HTML layout with the portal's instant preview."""
from html import escape
from pathlib import Path
import re

LAYOUT = (Path(__file__).parent / "email_templates" / "customer.html").read_text(encoding="utf-8")


def render_customer_email(settings, event_key, context, heading, preheader, body):
    style = settings.get("style", {})
    accent = style.get("accent_color", "#173a57")
    if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", str(accent)):
        accent = "#173a57"
    brand = settings.get("from_name") or "Hisbenew Industries"
    def value(key, fallback="—"):
        return escape(str(context.get(key) or fallback))

    tracking = event_key == "service_taker_tracking"
    # Details live in structured cards; the full message remains in the text alternative.
    lines = []
    for line in body.splitlines():
        if tracking and line.startswith("Tracking has been added or updated"):
            continue
        if line.startswith(("Package:", "Courier:", "Tracking number:", "Total pending balance:", "Total account amount due:")):
            continue
        if line.startswith("Thank you"):
            break
        lines.append(line)
    message_text = "<br>".join(escape(line) for line in "\n".join(lines).strip().splitlines())
    message = f'<div style="margin-top:10px;color:#6b7788;font-size:13px;line-height:1.6">{message_text}</div>' if message_text else ""
    shipment = ""
    if tracking:
        shipment = f'''<tr><td style="padding:0 22px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e1e7ed;border-radius:12px;background:#ffffff">
<tr><td style="padding:12px 16px;border-bottom:1px solid #edf0f4"><span style="color:#8a95a3;font-size:10px;letter-spacing:1.4px">ORDER</span><strong style="float:right;color:#263d53;font-size:12px">{value('order_no')}</strong></td></tr>
<tr><td style="padding:14px"><div style="font-size:17px;font-weight:700;color:#20364d">{value('product_name')}</div><p style="margin:6px 0 12px;color:#798597;font-size:12px;line-height:1.7">{value('package_details')}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fa;border-radius:8px"><tr><td style="padding:12px"><div style="font-size:9px;color:#7b8899;letter-spacing:1.4px">TRACKING NUMBER · {value('courier')}</div><div style="margin-top:8px;font-family:Consolas,monospace;font-size:18px;font-weight:700;color:#1f3b56;word-break:break-all">{value('tracking_number')}</div></td></tr></table>
</td></tr></table></td></tr>'''
    balance = f'''<tr><td style="padding:0 28px 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f5ee;border:1px solid #ece4d3;border-radius:12px"><tr><td style="padding:14px"><div style="font-size:9px;letter-spacing:1.4px;color:#987d47">TOTAL PENDING BALANCE</div><div style="margin-top:9px;color:#25374a;font-family:Georgia,serif;font-size:30px">{value('currency', 'USD')} {value('account_balance', '0.00')}</div></td></tr></table></td></tr>'''
    button_url = str(style.get("button_url") or "")
    if tracking:
        balance = ""
    button = ""
    if button_url.startswith(("https://", "http://")):
        button = f'<tr><td style="padding:22px 28px 0"><a href="{escape(button_url, quote=True)}" style="display:inline-block;padding:13px 22px;background:{accent};border-radius:8px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none">{escape(style.get("button_label") or "Open portal")}</a></td></tr>'
    fields = {"accent": accent, "brand": escape(brand), "initial": escape(brand[:1].upper()),
              "preheader": escape(preheader), "heading": escape(heading), "message": message,
              "category": "SHIPMENT UPDATE" if tracking else "ACCOUNT REMINDER",
              "shipment": shipment, "balance": balance, "button": button,
              "footer": escape(style.get("footer_text") or "Sent securely by our customer services team."),
              "sender": escape(settings.get("reply_to") or settings.get("from_email") or "")}
    return re.sub(r"%%([a-z]+)%%", lambda match: fields.get(match[1], ""), LAYOUT)
