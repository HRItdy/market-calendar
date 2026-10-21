"""Trade-log snapshots in Neon Object Storage (S3-compatible, bucket declared in neon.ts).

A JSON snapshot is written once a day by the tracker and right before "Clear log", so a
cleared or damaged log can be recovered. Enabled when the AWS_* variables that `neon deploy`
pulls (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION) are set.
Restore by downloading a snapshot (`neon bucket object get`) and POSTing its orders to
/api/journal/import.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

BUCKET = os.environ.get("MC_BACKUP_BUCKET", "assets")
PREFIX = "journal-backups/"
_client = None
_last_daily: str | None = None


def enabled() -> bool:
    return all(os.environ.get(k) for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT_URL_S3"))


def client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        # Credentials, endpoint and region come from the standard AWS_* variables;
        # Neon requires path-style addressing.
        _client = boto3.client("s3", config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}))
    return _client


def save(orders: list[dict], reason: str) -> str | None:
    """Write a snapshot; returns its key, or None when storage isn't configured."""
    if not enabled():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"{PREFIX}{stamp}-{reason}.json"
    body = json.dumps({"saved_at": int(time.time() * 1000), "reason": reason, "orders": orders}).encode()
    client().put_object(Bucket=BUCKET, Key=key, Body=body, ContentType="application/json")
    return key


def daily(orders_fn) -> str | None:
    """At most one snapshot per UTC day; `orders_fn` is only called when one is due."""
    global _last_daily
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    if not enabled() or _last_daily == today:
        return None
    if any(o["key"].startswith(f"{PREFIX}{today}") and o["key"].endswith("-daily.json") for o in list_backups()):
        _last_daily = today
        return None
    orders = orders_fn()
    key = save(orders, "daily") if orders else None
    _last_daily = today
    return key


def list_backups() -> list[dict]:
    if not enabled():
        return []
    out, token = [], None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": PREFIX, **({"ContinuationToken": token} if token else {})}
        page = client().list_objects_v2(**kw)
        out += [{"key": o["Key"], "size": o["Size"], "modified": o["LastModified"].isoformat()} for o in page.get("Contents", [])]
        if not page.get("IsTruncated"):
            return sorted(out, key=lambda o: o["key"], reverse=True)
        token = page["NextContinuationToken"]


def load(key: str) -> dict:
    if not key.startswith(PREFIX) or ".." in key:
        raise ValueError("not a trade-log backup")
    return json.loads(client().get_object(Bucket=BUCKET, Key=key)["Body"].read())
