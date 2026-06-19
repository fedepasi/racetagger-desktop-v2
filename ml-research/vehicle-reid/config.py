"""Shared config + helpers for the vehicle-ReID research harness.

Read-only against the production DB. All secrets come from the environment — never hard-code
or commit them.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


# Default Supabase project (RaceTagger production). Overridable via env.
DEFAULT_SUPABASE_URL = "https://taompbzifylmdzgbbrpv.supabase.co"
IMAGES_BUCKET = os.environ.get("RT_IMAGES_BUCKET", "images")

# Accept these confidence levels as trustworthy identity labels. The DB stores them
# upper-cased ('HIGH') plus a 'manual' value for human-corrected rows; we also tolerate
# lower-case variants defensively.
TRUSTED_CONFIDENCE = ("HIGH", "MANUAL")


def get_env(name: str, required: bool = True, default: str | None = None) -> str | None:
    val = os.environ.get(name, default)
    if required and not val:
        raise SystemExit(
            f"Missing env var {name}. See README.md → Setup. "
            f"(Required: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"
        )
    return val


@dataclass
class Settings:
    db_url: str
    supabase_url: str
    service_key: str
    bucket: str = IMAGES_BUCKET

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            db_url=get_env("SUPABASE_DB_URL"),
            supabase_url=get_env("SUPABASE_URL", required=False, default=DEFAULT_SUPABASE_URL),
            service_key=get_env("SUPABASE_SERVICE_ROLE_KEY"),
        )

    def storage_object_url(self, storage_path: str) -> str:
        return f"{self.supabase_url}/storage/v1/object/{self.bucket}/{storage_path}"


def normalize_number(raw: str | None) -> str | None:
    """Normalize a race number the way a human reads it: trim, drop leading zeros on pure
    digits ("034" -> "34"), upper-case otherwise. Returns None for empty input."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.isdigit():
        return str(int(s))
    return s.upper()


def identity_id(execution_id: str, number: str) -> str:
    """Stable identity key for a vehicle within an event."""
    return f"{execution_id}:{number}"
