#!/usr/bin/env python3
"""rclone --auth-proxy: map S3 access_key/secret to that tenant's buckets only."""
import configparser
import json
import os
import sys

TENANTS_PATH = os.environ.get("TENANTS_FILE", "/run/secrets/tenants.json")
CONF_PATH = os.environ.get("RCLONE_CONFIG", "/run/secrets/rclone.conf")


def load_conf(path):
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read(path)
    return cfg


def sftp_conn(sec, subpath):
    host = sec["host"]
    user = sec["user"]
    passwd = sec["pass"]
    return (
        f":sftp,host={host},user={user},pass={passwd},"
        f"shell_type=unix,md5sum_command=none,sha1sum_command=none:{subpath}"
    )


def resolve(cfg, name, extra_path=""):
    if name not in cfg:
        raise KeyError(f"unknown remote {name}")
    sec = cfg[name]
    typ = sec.get("type", "")
    if typ == "sftp":
        path = extra_path.lstrip("/")
        return sftp_conn(sec, path)
    if typ == "alias":
        remote = sec["remote"]
        rname, _, rpath = remote.partition(":")
        joined = "/".join(p for p in (rpath, extra_path) if p)
        return resolve(cfg, rname, joined)
    if typ == "crypt":
        remote = sec["remote"]
        rname, _, rpath = remote.partition(":")
        inner = resolve(cfg, rname, rpath)
        pw = sec["password"]
        pw2 = sec["password2"]
        return f":crypt,remote='{inner}',password={pw},password2={pw2}:"
    raise ValueError(f"unsupported remote type {typ} for {name}")


def tenant_buckets(tenants, match):
    buckets = match.get("buckets") or ["*"]
    if buckets != ["*"]:
        return list(buckets)
    out = []
    for name, t in tenants.items():
        if name == "sftpgo":
            continue
        for b in t.get("buckets") or []:
            if b != "*" and b not in out:
                out.append(b)
    return out


def main():
    req = json.load(sys.stdin)
    user = req.get("user") or ""
    passwd = req.get("pass") or ""
    tenants = json.load(open(TENANTS_PATH))
    match = None
    for name, t in tenants.items():
        if name == "sftpgo":
            continue
        if t.get("access_key") == user and t.get("secret_key") == passwd:
            match = t
            break
    if not match:
        sys.stderr.write("auth-proxy: denied unknown key\n")
        sys.exit(1)
    cfg = load_conf(CONF_PATH)
    buckets = tenant_buckets(tenants, match)
    if not buckets:
        sys.stderr.write("auth-proxy: no buckets\n")
        sys.exit(1)
    ups = []
    for b in buckets:
        ups.append(f"{b}={resolve(cfg, b)}")
    out = {"type": "combine", "_root": "", "upstreams": " ".join(ups)}
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
