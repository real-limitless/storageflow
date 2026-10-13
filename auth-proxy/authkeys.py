#!/usr/bin/env python3
import json, sys

tenants = json.load(open(sys.argv[1]))
want = sys.argv[2] if len(sys.argv) > 2 else "admin"
pairs = []
for name, t in tenants.items():
    if name == "sftpgo":
        continue
    if want not in ("admin", "all") and name != want:
        continue
    if want == "admin" and name != "admin":
        continue
    ak = t.get("access_key")
    sk = t.get("secret_key")
    if ak and sk:
        pairs.append(f'"{ak},{sk}"')
print(",".join(pairs))
