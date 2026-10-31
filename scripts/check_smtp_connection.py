"""Diagnose SMTP from the ERP machine without printing mailbox credentials."""
import concurrent.futures
import json
from pathlib import Path
import smtplib
import socket
import ssl
import sys
import time


def probe(port, settings=None):
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
            print("Saved connection:", path.name, "host:", smtp.get("host"),
                  "port:", smtp.get("port"), "SSL:", smtp.get("use_ssl"),
                  "STARTTLS:", smtp.get("use_tls"), "password present:", bool(smtp.get("password")), flush=True)
            if smtp.get("password"):
                matches.append(smtp)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda port: probe(port, matches[0] if matches else None), [465, 587]):
            print(json.dumps(result), flush=True)
