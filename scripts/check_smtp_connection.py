"""Diagnose SMTP from the ERP machine without printing mailbox credentials."""
import concurrent.futures
import json
from pathlib import Path
import smtplib
import socket
import ssl
import sys
import time
from email.message import EmailMessage


def probe(port, settings=None, send_test=False):
    stage = "connect/TLS" if port == 465 else "connect/greeting"
    start = time.monotonic()
    try:
        if port == 465:
            server = smtplib.SMTP_SSL("s11.hosterpk.com", port, timeout=15,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP("s11.hosterpk.com", port, timeout=15)
        with server:
            stage = "EHLO"
            server.ehlo()
            if port == 587:
                stage = "STARTTLS"
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            stage = "authentication"
            if settings:
                server.login(settings["username"], settings["password"])
            if settings and send_test:
                stage = "send test"
                message = EmailMessage()
                message["From"] = "Hisbenew ERP <info@hisbenew.com>"
                message["To"] = "hafizumerayaz@gmail.com"
                message["Subject"] = "Hisbenew ERP SMTP connection verified"
                message.set_content("This test confirms the live ERP can authenticate and send email using its corrected secure SMTP connection.")
                refused = server.send_message(message)
                if refused:
                    raise RuntimeError("Recipient refused")
            return {"port": port, "ok": True, "authenticated": bool(settings)}
    except Exception as error:
        # Do not log exception text: providers can echo authentication data.
        return {"port": port, "ok": False, "stage": stage,
                "error": type(error).__name__, "smtp_code": getattr(error, "smtp_code", None),
                "seconds": round(time.monotonic() - start, 1)}


if __name__ == "__main__":
    root = Path(sys.argv[1])
    print("SMTP address:", socket.gethostbyname("s11.hosterpk.com"), flush=True)
    matches = []
    for path in root.glob("email_settings*.json"):
        settings = json.loads(path.read_text(encoding="utf-8-sig"))
        smtp = settings.get("smtp", {})
        if smtp.get("username", "").lower().strip() == "info@hisbenew.com":
            if "--enable-connection" in sys.argv and path.name == "email_settings_tenant_1.json":
                settings["enabled"] = True
                path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
                print("Enabled verified email connection for tenant 1; credentials preserved.", flush=True)
                raise SystemExit(0)
            print("Saved connection:", path.name, "host:", smtp.get("host"),
                  "port:", smtp.get("port"), "SSL:", smtp.get("use_ssl"),
                  "STARTTLS:", smtp.get("use_tls"), "password present:", bool(smtp.get("password")), flush=True)
            if smtp.get("password"):
                matches.append(smtp)
                if "--repair-and-test" in sys.argv:
                    smtp.update(host="s11.hosterpk.com", port=587, use_ssl=False, use_tls=True)
                    path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
                    print("Saved secure SMTP correction:", path.name, flush=True)
    if "--enable-connection" in sys.argv:
        raise SystemExit("The verified tenant 1 mailbox was not found; no connection enabled.")
    if "--repair-and-test" in sys.argv:
        if not matches:
            raise SystemExit("No saved mailbox password found; no test sent.")
        result = probe(587, matches[0], send_test=True)
        print("TEST_SEND_RESULT:", json.dumps(result), flush=True)
        raise SystemExit(0 if result["ok"] else 1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda port: probe(port, matches[0] if matches else None), [465, 587]):
            print(json.dumps(result), flush=True)
