# index.py
from __future__ import annotations

# ────────────────────────────────────────────────────────────────────────────────
# Standard / 3rd-party imports
# ────────────────────────────────────────────────────────────────────────────────
import io
import json
import csv
import hmac
import logging
import os
import sys
import time
import uuid
from datetime import datetime
from functools import wraps
from typing import Any, Callable, Tuple, List
import requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import urllib
from supabase import create_client, Client
from werkzeug.exceptions import HTTPException

# ────────────────────────────────────────────────────────────────────────────────
# Early setup & env
# ────────────────────────────────────────────────────────────────────────────────
load_dotenv()  # .env first so everything below can read env vars

SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
SRK: str | None = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SRK:
    raise RuntimeError(
        "❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as env variables."
    )

# Shared secret for server-to-server auth.  Defaults to the SRK if not overridden.
BACKEND_SHARED_SECRET: str = os.getenv("BACKEND_SHARED_SECRET", SRK)
REQUIRE_BACKEND_SECRET: bool = (
    os.getenv("REQUIRE_BACKEND_SECRET", "true").strip().lower() == "true"
)

# ────────────────────────────────────────────────────────────────────────────────
# Logging config
# ────────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("api")

# ────────────────────────────────────────────────────────────────────────────────
# Flask app + CORS
# ────────────────────────────────────────────────────────────────────────────────
app = Flask(__name__)

# Allow your FE origins and the custom header used for the secret.
CORS(
    app,
    resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", "*").split(",")}},
    supports_credentials=True,
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Service-Auth",
    ],
)

# ────────────────────────────────────────────────────────────────────────────────
# Supabase client (always with SRK; per-request we’ll bind the user JWT)
# ────────────────────────────────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SRK)

# ────────────────────────────────────────────────────────────────────────────────
# Allowlist security (second layer after shared secret)
# ────────────────────────────────────────────────────────────────────────────────
STATIC_ALLOWED_EMAILS: set[str] = {
    # "you@example.com",
    # "teammate@example.com",
}

_env_allowed = os.getenv("ALLOWED_EMAILS", "").strip()
if _env_allowed:
    ALLOWED_EMAILS = {e.strip().lower() for e in _env_allowed.split(",") if e.strip()}
else:
    ALLOWED_EMAILS = {e.strip().lower() for e in STATIC_ALLOWED_EMAILS if e.strip()}


def _is_allowed(email: str | None) -> bool:
    """True if allowlist is empty or email is in the list (case-insensitive)."""
    if not ALLOWED_EMAILS:
        return True
    return (email or "").lower() in ALLOWED_EMAILS


# ────────────────────────────────────────────────────────────────────────────────
# Request instrumentation
# ────────────────────────────────────────────────────────────────────────────────
PUBLIC_PATHS = {"/api/auth/start", "/api/auth/user"}


@app.before_request
def _log_request_start() -> None:
    g._start_time = time.time()
    g._rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex


@app.before_request
def _enforce_backend_secret_header():
    """Require X-Service-Auth on every non-public route (if enabled)."""
    if not REQUIRE_BACKEND_SECRET:
        return

    if request.path in PUBLIC_PATHS:
        return

    presented = request.headers.get("X-Service-Auth", "")
    if not presented or not hmac.compare_digest(presented, BACKEND_SHARED_SECRET):
        logger.warning(
            "Forbidden (missing/invalid X-Service-Auth) path=%s rid=%s",
            request.path,
            getattr(g, "_rid", "-"),
        )
        return jsonify({"error": "Forbidden"}), 403


@app.after_request
def _log_request_end(response):
    try:
        duration_ms = (time.time() - getattr(g, "_start_time", time.time())) * 1000
        uid = getattr(g, "user_id", None)
        logger.info(
            "%s %s %s %.2fms rid=%s%s",
            request.method,
            request.path,
            response.status_code,
            duration_ms,
            getattr(g, "_rid", "-"),
            f" uid={uid}" if uid else "",
        )
    except Exception:
        pass
    return response


@app.errorhandler(HTTPException)
def _handle_http_exception(e: HTTPException):
    logger.warning(
        "HTTPException %s %s path=%s rid=%s",
        e.code,
        e.name,
        request.path,
        getattr(g, "_rid", "-"),
    )
    return e


@app.errorhandler(Exception)
def _handle_unhandled_exception(e: Exception):
    logger.exception("Unhandled exception path=%s rid=%s", request.path, getattr(g, "_rid", "-"))
    return jsonify({"error": "Internal Server Error"}), 500


# ────────────────────────────────────────────────────────────────────────────────
# Auth helpers
# ────────────────────────────────────────────────────────────────────────────────
def get_current_user() -> Tuple[str | None, str | None, str | None]:
    """Return (uid, email, jwt) or (None, None, None)."""
    auth = request.headers.get("Authorization", "")
    token = auth.split(" ", 1)[1].strip() if auth.startswith("Bearer ") else None
    if not token:
        return None, None, None

    # Preferred method via python client (fast path).
    try:
        u = supabase.auth.get_user(token)
        if getattr(u, "user", None) and getattr(u.user, "id", None):
            return u.user.id, getattr(u.user, "email", None), token
    except Exception:
        pass

    # Fallback raw HTTP call.
    try:
        r = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SRK},
            timeout=15,
        )
        if r.status_code == 200:
            j = r.json()
            return j.get("id"), j.get("email"), token
    except Exception:
        pass

    return None, None, None


def _auth_and_set_g():
    uid, email, token = get_current_user()
    if not uid:
        return None, None, None

    g.user_id = uid
    g.user_email = email
    g._jwt = token

    # Bind JWT to PostgREST so RLS policies run as this user.
    try:
        supabase.postgrest.auth(token)
    except Exception:
        logger.warning("Failed to bind JWT to PostgREST")

    return uid, email, token


def db_guard(fn: Callable) -> Callable:
    """Decorator that enforces auth + allowlist on database routes."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid, email, token = _auth_and_set_g()
        if not uid:
            logger.warning("Unauthorized access to %s rid=%s", request.path, getattr(g, "_rid", "-"))
            return jsonify({"error": "Unauthorized"}), 401

        if not _is_allowed(email):
            logger.warning(
                "Forbidden (allowlist) path=%s email=%s rid=%s",
                request.path,
                email,
                getattr(g, "_rid", "-"),
            )
            return jsonify({"error": "Forbidden"}), 403

        try:
            return fn(*args, **kwargs)
        finally:
            # Avoid cross-request header leakage.
            try:
                supabase.postgrest.auth(None)
            except Exception:
                pass

    return wrapper


# ────────────────────────────────────────────────────────────────────────────────
# Helpers for dataset logic (unchanged)
# ────────────────────────────────────────────────────────────────────────────────
TASK_KEYS = [
    "prompt",
    "inputs",
    "outputs",
    "unit_tests",
    "solution",
    "code_file",
    "language",
    "group",
    "difficulty",
    "topics",
    "time_complexity",
    "space_complexity",
]


def _normalize_topics(v: Any) -> List[str]:
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip() != ""]
    if isinstance(v, str):
        parts = [s.strip() for s in v.replace(",", ";").split(";")]
        return [p for p in parts if p]
    return []


def _normalize_difficulty(v: Any) -> str:
    s = str(v or "").strip().lower()
    if s == "hard":
        return "Hard"
    if s == "medium":
        return "Medium"
    return "Easy"


def _flatten_dataset_row(row: dict) -> dict:
    meta = row.get("meta") or {}
    for k in TASK_KEYS:
        if not meta.get(k):
            v = row.get(k)
            if v is not None:
                meta[k] = v
    out = {"id": row.get("id")}
    out.update(meta)
    out["notes"] = row.get("notes", "") or ""
    out["lastRunSuccessful"] = row.get("lastRunSuccessful", False)
    out["createdAt"] = row.get("createdAt")
    out["updatedAt"] = row.get("updatedAt")
    if "currentVersionId" in row:
        out["currentVersionId"] = row.get("currentVersionId")
    return out

def _row_from_generic_payload(payload, now):
    meta = {
        "prompt": payload.get("prompt", "") or "",
        "inputs": payload.get("inputs", "") or "",
        "outputs": payload.get("outputs", "") or "",
        "unit_tests": payload.get("unit_tests", "") or "",
        "solution": payload.get("solution") or payload.get("reference_solution") or "",
        "code_file": payload.get("code_file", "") or "",
        "language": payload.get("language"),
        "group": payload.get("group"),
        "time_complexity": payload.get("time_complexity", "") or "",
        "space_complexity": payload.get("space_complexity", "") or "",
        "topics": _normalize_topics(payload.get("topics")),
        "difficulty": _normalize_difficulty(payload.get("difficulty")),
    }
    row = {
        "prompt": meta["prompt"],
        "inputs": meta["inputs"],
        "outputs": meta["outputs"],
        "unit_tests": meta["unit_tests"],
        "solution": meta["solution"],
        "code_file": meta["code_file"],
        "language": meta["language"],
        "group": meta["group"],
        "difficulty": meta["difficulty"],
        "topics": meta["topics"],
        "time_complexity": meta["time_complexity"],
        "space_complexity": meta["space_complexity"],
        "notes": payload.get("notes", "") or "",
        "lastRunSuccessful": bool(payload.get("lastRunSuccessful", False)),
        "createdAt": now,
        "updatedAt": now,
        # "currentVersionId": payload.get("currentVersionId"),
        "meta": meta,
    }
    return row

def _split_meta(payload):
    reserved = {"notes", "lastRunSuccessful", "createdAt", "updatedAt", "currentVersionId", "id"}
    meta = {k: v for k, v in (payload or {}).items() if k not in reserved}
    base = {
        "notes": (payload or {}).get("notes", ""),
        "lastRunSuccessful": bool((payload or {}).get("lastRunSuccessful", False)),
        "currentVersionId": (payload or {}).get("currentVersionId", None),
    }
    return base, meta

def _normalize_snapshot_fields(snapshot: dict) -> dict:
    s = dict(snapshot or {})
    s["topics"] = _normalize_topics(s.get("topics"))
    if "difficulty" in s:
        s["difficulty"] = _normalize_difficulty(s.get("difficulty"))
    # ensure string fields are not None
    for k in ["prompt", "inputs", "outputs", "unit_tests", "solution",
              "code_file", "time_complexity", "space_complexity", "notes"]:
        if k in s and s[k] is None:
            s[k] = ""
    return s

def _merge_meta_with_snapshot(existing_meta: dict, snapshot: dict) -> dict:
    merged = dict(existing_meta or {})
    for k in TASK_KEYS:
        if k in snapshot:
            merged[k] = snapshot[k]
    return merged

def _ensure_rows_updated(resp, table: str, match_info: dict):
    data = getattr(resp, "data", None)
    if not data:
        logger.error(
            f"Supabase UPDATE affected 0 rows on '{table}'. "
            f"Match={match_info}. This likely indicates RLS blocking or a wrong id."
        )
        raise RuntimeError("No rows updated (possible RLS or wrong id)")

def _snapshot_from_row(row: dict) -> dict:
    """Build a version snapshot from a normalized dataset row dict produced by _row_from_generic_payload."""
    meta = row.get("meta") or {}
    snap = {
        "prompt": meta.get("prompt", ""),
        "inputs": meta.get("inputs", ""),
        "outputs": meta.get("outputs", ""),
        "code_file": meta.get("code_file", ""),
        "unit_tests": meta.get("unit_tests", ""),
        "solution": meta.get("solution", ""),
        "time_complexity": meta.get("time_complexity", ""),
        "space_complexity": meta.get("space_complexity", ""),
        "topics": meta.get("topics", []),
        "difficulty": meta.get("difficulty", "Easy"),
        "notes": row.get("notes", "") or "",
    }
    return _normalize_snapshot_fields(snap)

def _sync_dataset_with_snapshot(item_id: str, snapshot: dict, *, set_current_version_id: str | None = None):
    """
    Persist a version snapshot into dataset (meta + top-level). Optionally set currentVersionId.
    Optimized to avoid a post-update SELECT by computing the updated row in memory.
    """
    # Fetch existing row to preserve unknown meta keys and notes
    res = supabase.table('dataset').select('*').eq('id', item_id).single().execute()
    existing = getattr(res, "data", None)
    if not existing:
        return None

    norm = _normalize_snapshot_fields(snapshot)
    merged_meta = _merge_meta_with_snapshot(existing.get("meta") or {}, norm)

    now = datetime.now().isoformat()
    top_level_updates = {k: merged_meta.get(k) for k in TASK_KEYS}
    updates = {
        **top_level_updates,
        "meta": merged_meta,
        "notes": norm.get("notes", existing.get("notes", "") or ""),
        "updatedAt": now,
    }
    if set_current_version_id is not None:
        updates["currentVersionId"] = set_current_version_id

    resp = supabase.table('dataset').update(updates).eq('id', item_id).execute()
    _ensure_rows_updated(resp, "dataset", {"id": item_id})

    # Compose the updated row locally to avoid a second SELECT
    virtual = {**existing, **updates}
    return _flatten_dataset_row(virtual)

# ------------------------------------------------------------------------------
# Auth endpoints (left open so clients can sign in / discover their user)
# ------------------------------------------------------------------------------
@app.route('/api/auth/user', methods=['GET'])
def auth_user():
    uid, email,_ = get_current_user()
    if not uid:
        return jsonify({"authenticated": False}), 401
    return jsonify({"authenticated": True, "user": {"id": uid, "email": email}})

@app.route('/api/auth/start', methods=['GET'])
def auth_start():
    redirect_to = request.args.get("redirect_to") or os.getenv("SUPABASE_REDIRECT_URL") or (request.host_url.rstrip("/") + "/")
    url = f"{SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={urllib.parse.quote(redirect_to, safe='')}"
    logger.info(f"Auth start redirect_to={redirect_to} rid={getattr(g,'_rid','-')}")
    return jsonify({"url": url})

# ------------------------------------------------------------------------------
# Dataset CRUD (protected)
# ------------------------------------------------------------------------------
@app.route('/api/dataset', methods=['GET'])
@db_guard
def get_dataset():
    try:
        res = supabase.table('dataset').select('*').order('createdAt', desc=True).execute()
        rows = getattr(res, "data", []) or []
        items = [_flatten_dataset_row(r) for r in rows]
        return jsonify(items)
    except Exception as e:
        logger.exception(f"Failed to fetch dataset rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to fetch dataset: {str(e)}'}), 500

@app.route('/api/dataset', methods=['POST'])
@db_guard
def create_dataset_item():
    """
    Efficient create:
      - (Optional) createInitialVersion=true: pre-generate dataset_id & version_id
      - Insert dataset row with currentVersionId already set (1 call)
      - Insert the initial version (1 call)
    """
    try:
        data = request.get_json(silent=True) or {}
        now = datetime.now().isoformat()
        create_initial = bool(data.get("createInitialVersion", False))
        initial_label = (data.get("label") or data.get("initialLabel") or (g.user_email or "")).strip()

        dataset_id = str(uuid.uuid4())
        version_id = str(uuid.uuid4()) if create_initial else None

        row = _row_from_generic_payload(data, now)
        row["id"] = dataset_id

        # ✅ Do NOT set currentVersionId on the initial insert (and ignore any client-sent value)
        row.pop("currentVersionId", None)
  
        # 1) Insert dataset row
        res = supabase.table('dataset').insert(row).execute()
        created = (getattr(res, "data", []) or [])[0]

        # 2) Insert initial version (after dataset exists)
        if create_initial:
            snapshot = _snapshot_from_row(row)
            vrow = {
                "id": version_id,
                "item_id": dataset_id,
                "parent_id": None,
                "data": snapshot,
                "label": initial_label,
                "author_id": g.user_id,
                "created_at": now
            }
            supabase.table('task_versions').insert(vrow).execute()

            # 3) Now that the version exists, set it as head and mirror snapshot if desired
            # This keeps dataset meta/top-level in sync, and safely sets currentVersionId.
            _sync_dataset_with_snapshot(dataset_id, snapshot, set_current_version_id=version_id)

        # Respond with the flattened row. If you want to avoid a re-select, compose it locally:
        resp_row = created if not create_initial else {**created, "currentVersionId": version_id}
        return jsonify(_flatten_dataset_row(resp_row))
    except Exception as e:
        logger.exception(f"Failed to create dataset item rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to create dataset item: {str(e)}'}), 500

@app.route('/api/dataset/_bulk', methods=['POST'])
@db_guard
def bulk_create_dataset_items():
    """
    Efficient bulk import:
      - Pre-generate dataset ids and version ids
      - Single insert into dataset (with currentVersionId prefilled)
      - Single insert into task_versions (bulk)
    """
    try:
        body = request.get_json(silent=True) or {}
        items = body.get('items', [])
        if not items:
            return jsonify([])

        now = datetime.now().isoformat()
        ds_rows = []
        v_rows = []

        for payload in items:
            dataset_id = str(uuid.uuid4())
            version_id = str(uuid.uuid4())
            row = _row_from_generic_payload(payload, now)
            row["id"] = dataset_id
            row["currentVersionId"] = version_id
            ds_rows.append(row)

            snapshot = _snapshot_from_row(row)
            v_rows.append({
                "id": version_id,
                "item_id": dataset_id,
                "parent_id": None,
                "data": snapshot,
                "label": (g.user_email or "").strip(),  # initialize editor to authenticated email (no stamps)
                "author_id": g.user_id,
                "created_at": now
            })

        # Insert dataset rows (1 call)
        res = supabase.table('dataset').insert(ds_rows).execute()
        created_ds = getattr(res, "data", []) or []

        # Insert all versions (1 call)
        if v_rows:
            supabase.table('task_versions').insert(v_rows).execute()

        flat = []
        for r in created_ds:
            flat.append(_flatten_dataset_row(r))
        return jsonify(flat)
    except Exception as e:
        logger.exception(f"Failed to bulk create dataset items rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to bulk create dataset items: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['GET'])
@db_guard
def get_dataset_item(item_id):
    try:
        res = supabase.table('dataset').select('*').eq('id', item_id).single().execute()
        row = getattr(res, "data", None)
        if not row:
            return jsonify({'error': 'Item not found'}), 404
        return jsonify(_flatten_dataset_row(row))
    except Exception as e:
        logger.exception(f"Failed to fetch dataset item id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to fetch dataset item: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['PUT'])
@db_guard
def update_dataset_item(item_id):
    try:
        data = request.get_json(silent=True) or {}
        res = supabase.table('dataset').select('*').eq('id', item_id).single().execute()
        existing = getattr(res, "data", None)
        if not existing:
            return jsonify({'error': 'Item not found'}), 404

        _, incoming_meta = _split_meta(data)
        merged_meta = (existing.get("meta") or {}).copy()
        merged_meta.update(incoming_meta or {})
        merged_meta["topics"] = _normalize_topics(merged_meta.get("topics"))
        if "difficulty" in merged_meta:
            merged_meta["difficulty"] = _normalize_difficulty(merged_meta.get("difficulty"))

        tl_updates = {k: merged_meta.get(k) for k in TASK_KEYS if k in merged_meta}
        updates = {
            "lastRunSuccessful": data.get('lastRunSuccessful', existing.get("lastRunSuccessful", False)),
            "notes": data.get('notes', existing.get("notes", "") or ""),
            "updatedAt": datetime.now().isoformat(),
            "meta": merged_meta,
            **tl_updates,
        }
        if "currentVersionId" in data:
            updates["currentVersionId"] = data.get("currentVersionId")

        resp = supabase.table('dataset').update(updates).eq('id', item_id).execute()
        _ensure_rows_updated(resp, "dataset", {"id": item_id})

        # Compose locally (avoid a second SELECT)
        row = {**existing, **updates}
        return jsonify(_flatten_dataset_row(row))
    except Exception as e:
        logger.exception(f"Failed to update dataset item id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to update dataset item: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>', methods=['DELETE'])
@db_guard
def delete_dataset_item(item_id):
    try:
        supabase.table('dataset').delete().eq('id', item_id).execute()
        return jsonify({'success': True})
    except Exception as e:
        logger.exception(f"Failed to delete dataset item id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to delete dataset item: {str(e)}'}), 500

# ------------------------------------------------------------------------------
# Versions (+ atomic save) (protected)
# ------------------------------------------------------------------------------
@app.route('/api/dataset/<item_id>/versions', methods=['GET'])
@db_guard
def list_task_versions(item_id):
    try:
        res = supabase.table('task_versions').select('*').eq('item_id', item_id).order('created_at', desc=False).execute()
        versions = getattr(res, "data", []) or []
        nodes = {}
        for v in versions:
            nodes[v["id"]] = {
                "id": v["id"],
                "itemId": v.get("item_id"),
                "parentId": v.get("parent_id"),
                "data": v.get("data"),
                "label": v.get("label"),
                "authorId": v.get("author_id"),
                "createdAt": v.get("created_at"),
                "children": []
            }
        roots = []
        for n in nodes.values():
            pid = n["parentId"]
            if pid and pid in nodes:
                nodes[pid]["children"].append(n)
            else:
                roots.append(n)
        return jsonify({"tree": roots, "flat": list(nodes.values())})
    except Exception as e:
        logger.exception(f"Failed to fetch versions item_id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to fetch versions: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>/versions', methods=['POST'])
@db_guard
def create_task_version(item_id):
    try:
        uid, _ = g.user_id, g.user_email
        body = request.get_json(silent=True) or {}
        payload = body.get("data")
        parent_id = body.get("parentId")
        label = body.get("label")
        make_head = bool(body.get("makeHead", False))
        if payload is None:
            return jsonify({"error": "Missing 'data'"}), 400
        row = {
            "item_id": item_id,
            "parent_id": parent_id,
            "data": payload,
            "label": label,
            "author_id": uid,
            "created_at": datetime.now().isoformat()
        }
        res = supabase.table('task_versions').insert(row).execute()
        created = (getattr(res, "data", []) or [])[0]

        # Optional: make this new version the head and sync dataset
        if make_head:
            updated = _sync_dataset_with_snapshot(item_id, payload, set_current_version_id=created.get("id"))
            if not updated:
                return jsonify({'error': 'Item not found'}), 404

        return jsonify({
            "id": created.get("id"),
            "itemId": created.get("item_id"),
            "parentId": created.get("parent_id"),
            "data": created.get("data"),
            "label": created.get("label"),
            "authorId": created.get("author_id"),
            "createdAt": created.get("created_at")
        })
    except Exception as e:
        logger.exception(f"Failed to create version item_id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to create version: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>/versions/<version_id>', methods=['GET'])
@db_guard
def get_task_version(item_id, version_id):
    try:
        res = supabase.table('task_versions').select('*').eq('id', version_id).eq('item_id', item_id).single().execute()
        v = getattr(res, "data", None)
        if not v:
            return jsonify({'error': 'Version not found'}), 404
        return jsonify({
            "id": v.get("id"),
            "itemId": v.get("item_id"),
            "parentId": v.get("parent_id"),
            "data": v.get("data"),
            "label": v.get("label"),
            "authorId": v.get("author_id"),
            "createdAt": v.get("created_at")
        })
    except Exception as e:
        logger.exception(f"Failed to fetch version item_id={item_id} version_id={version_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to fetch version: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>/versions/<version_id>', methods=['PATCH', 'PUT'])
@db_guard
def update_task_version(item_id, version_id):
    try:
        body = request.get_json(silent=True) or {}
        updates = {}
        has_data_update = False
        if "data" in body:
            updates["data"] = body.get("data")
            has_data_update = True
        if "label" in body:
            updates["label"] = body.get("label")
        if not updates:
            return jsonify({"error": "No updates provided"}), 400

        resp = supabase.table('task_versions').update(updates).eq('id', version_id).eq('item_id', item_id).execute()
        _ensure_rows_updated(resp, "task_versions", {"id": version_id, "item_id": item_id})

        # Use the returned row if available to avoid an extra SELECT
        v = None
        try:
            arr = getattr(resp, "data", None)
            if isinstance(arr, list) and arr:
                v = arr[0]
        except Exception:
            v = None
        if v is None:
            sel = supabase.table('task_versions').select('*').eq('id', version_id).single().execute()
            v = getattr(sel, "data", None)

        # If this version is the head and its data was updated -> sync row
        if has_data_update:
            ds_res = supabase.table('dataset').select('currentVersionId').eq('id', item_id).single().execute()
            ds = getattr(ds_res, "data", None)
            if ds and ds.get("currentVersionId") == version_id:
                snapshot = updates.get("data") if "data" in updates else (v.get("data") if v else {})
                _sync_dataset_with_snapshot(item_id, snapshot)

        return jsonify({
            "id": v.get("id"),
            "itemId": v.get("item_id"),
            "parentId": v.get("parent_id"),
            "data": v.get("data"),
            "label": v.get("label"),
            "authorId": v.get("author_id"),
            "createdAt": v.get("created_at")
        })
    except Exception as e:
        logger.exception(f"Failed to update version item_id={item_id} version_id={version_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to update version: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>/head', methods=['PUT'])
@db_guard
def set_task_head(item_id):
    try:
        body = request.get_json(silent=True) or {}
        vid = body.get("versionId")
        if not vid:
            return jsonify({"error": "Missing 'versionId'"}), 400

        vres = supabase.table('task_versions').select('*').eq('id', vid).eq('item_id', item_id).single().execute()
        v = getattr(vres, "data", None)
        if not v:
            return jsonify({'error': 'Version not found'}), 404
        snapshot = v.get("data") or {}

        updated = _sync_dataset_with_snapshot(item_id, snapshot, set_current_version_id=vid)
        if not updated:
            return jsonify({'error': 'Item not found'}), 404
        return jsonify(updated)
    except Exception as e:
        logger.exception(f"Failed to set head item_id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to set head: {str(e)}'}), 500

@app.route('/api/dataset/<item_id>/save', methods=['POST'])
@db_guard
def atomic_save(item_id):
    """
    Atomic path for the UI:
      - If compressIntoVersionId provided: update that version's data/label
      - Else: create a new version (optionally with parentId)
      - In both cases: promote to head and mirror snapshot into dataset
    """
    try:
        uid, _ = g.user_id, g.user_email
        body = request.get_json(silent=True) or {}
        snapshot = body.get("data")
        label = body.get("label")
        parent_id = body.get("parentId")
        compress_into = body.get("compressIntoVersionId")
        if snapshot is None:
            return jsonify({"error": "Missing 'data'"}), 400

        now = datetime.now().isoformat()
          # Enforce: only compress the current head
        try:
            ds_res = supabase.table('dataset').select('currentVersionId').eq('id', item_id).single().execute()
            ds = getattr(ds_res, "data", None) or {}
            current_head = ds.get("currentVersionId")
        except Exception:
            current_head = None

        if compress_into and compress_into != current_head:
            # Treat as a new version instead of mutating history
            compress_into = None
        if compress_into:
            # Update existing version in place
            patch = {"data": snapshot}
            if label is not None:
                patch["label"] = label
            resp = supabase.table('task_versions').update(patch).eq('id', compress_into).eq('item_id', item_id).execute()
            _ensure_rows_updated(resp, "task_versions", {"id": compress_into, "item_id": item_id})
            version_id = compress_into
            inserted = False
            created_version = None
        else:
            # Create a new version
            row = {
                "item_id": item_id,
                "parent_id": parent_id,
                "data": snapshot,
                "label": label,
                "author_id": uid,
                "created_at": now
            }
            res = supabase.table('task_versions').insert(row).execute()
            created = (getattr(res, "data", []) or [])[0]
            version_id = created.get("id")
            inserted = True
            created_version = {
                "id": created.get("id"),
                "itemId": created.get("item_id"),
                "parentId": created.get("parent_id"),
                "label": created.get("label"),
                "authorId": created.get("author_id"),
                "createdAt": created.get("created_at"),
            }

        # Promote to head + mirror dataset
        dataset_row = _sync_dataset_with_snapshot(item_id, snapshot, set_current_version_id=version_id)
        if not dataset_row:
            return jsonify({'error': 'Item not found'}), 404

        # Return dataset + chosen version id
        return jsonify({
            "success": True,
            "versionId": version_id,
            "dataset": dataset_row,
            "inserted": inserted,
            "version": created_version,
            "label": label
        })
    except Exception as e:
        logger.exception(f"Atomic save failed item_id={item_id} rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Atomic save failed: {str(e)}'}), 500
def _email_local_part(s: str | None) -> str:
    """Return the part before '@' if this looks like an email; otherwise return the string as-is."""
    val = str(s or "").strip()
    if not val:
        return ""
    if "@" in val:
        return val.split("@", 1)[0]
    return val

def _parse_label_to_editor_and_stamps(label: str | None) -> tuple[str, list[str]]:
    """
    Expected format from formatStandardLabel(editor, stamps):
      'editor:'  OR  'editor: a, b, c'  OR  ''

    Returns (editor_local_part, [unique_stamp_local_parts]).
    """
    s = (label or "").strip()
    if not s:
        return "", []
    # Split on first colon
    editor, sep, right = s.partition(":")
    editor_name = _email_local_part(editor)
    stamps: list[str] = []
    if sep:  # there was a colon
        parts = [p.strip() for p in right.split(",")]
        seen = set()
        for p in parts:
            if not p:
                continue
            name = _email_local_part(p)
            if name and name not in seen:
                seen.add(name)
                stamps.append(name)
    return editor_name, stamps

def _compute_stamp_path_for_item(versions: dict, head_id: str | None) -> tuple[str, list[list[str]]]:
    """
    Traverse parent chain from head -> root, collect stamps per version node.
    Skip nodes with no stamps. Returns (path_str, segments), where segments is
    a list of lists of stampers per node in traversal order (head-first).
    """
    if not head_id:
        return "none", []

    path_segments: list[list[str]] = []
    seen: set[str] = set()
    curr = head_id
    steps = 0

    while curr and curr in versions and curr not in seen and steps < 1000:
        seen.add(curr)
        node = versions[curr]
        _, stamps = _parse_label_to_editor_and_stamps(node.get("label"))
        if stamps:
            path_segments.append(stamps)
        curr = node.get("parent_id")
        steps += 1

    if not path_segments:
        return "none", []
    segment_strings = [", ".join(seg) for seg in path_segments]
    return " <- ".join(segment_strings), path_segments

# ------------------------------------------------------------------------------
# Stamp paths (batch) (protected)
# ------------------------------------------------------------------------------
@app.route('/api/dataset/_stamp_paths', methods=['POST'])
@db_guard
def batch_stamp_paths():
    """
    Request:  { "ids": ["<dataset_id>", ...] }
    Response: { "paths": { "<dataset_id>": "a -> a, b" | "none", ... },
                "segments": { "<dataset_id>": [["a"], ["a","b"]], ... } }
    """
    try:
        body = request.get_json(silent=True) or {}
        ids = body.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return jsonify({"paths": {}, "segments": {}})

        ids = [str(x) for x in ids if x]

        # Helper to chunk .in_() calls so we don't risk long URLs with many ids
        def _chunks(lst, n=200):
            for i in range(0, len(lst), n):
                yield lst[i:i + n]

        # 1) Fetch heads for requested dataset items
        head_map: dict[str, str | None] = {}
        for chunk in _chunks(ids):
            ds_res = supabase.table('dataset').select('id,currentVersionId').in_('id', chunk).execute()
            rows = getattr(ds_res, "data", []) or []
            for r in rows:
                head_map[r["id"]] = r.get("currentVersionId")

        # 2) Fetch all versions for these items (only fields necessary)
        versions_by_item: dict[str, dict[str, dict]] = {}
        for chunk in _chunks(ids):
            v_res = supabase.table('task_versions').select('id,item_id,parent_id,label').in_('item_id', chunk).execute()
            vrows = getattr(v_res, "data", []) or []
            for v in vrows:
                d = versions_by_item.setdefault(v["item_id"], {})
                d[v["id"]] = {
                    "id": v["id"],
                    "parent_id": v.get("parent_id"),
                    "label": v.get("label", "")
                }

        # 3) Build paths
        paths: dict[str, str] = {}
        segments: dict[str, list[list[str]]] = {}
        for item_id in ids:
            head_id = head_map.get(item_id)
            versions = versions_by_item.get(item_id, {})
            path_str, segs = _compute_stamp_path_for_item(versions, head_id)
            paths[item_id] = path_str
            segments[item_id] = segs

        return jsonify({"paths": paths, "segments": segments})
    except Exception as e:
        logger.exception(f"Failed to compute stamp paths rid={getattr(g,'_rid','-')}")
        return jsonify({"error": "Failed to compute stamp paths"}), 500
# ------------------------------------------------------------------------------
# Test runner proxy (protected)
# ------------------------------------------------------------------------------
@app.route("/api/run-tests", methods=['POST'])
@db_guard
def run_tests_proxy():
    HF_API_URL = "https://hostpython.onrender.com/api/run-tests"
    if not HF_API_URL:
        return jsonify({
            "success": False,
            "error": "Backend API endpoint is not configured on the server."
        }), 500
    try:
        incoming_data = request.get_json(silent=True)
        if not incoming_data or "solution" not in incoming_data or "tests" not in incoming_data:
            return jsonify({
                "success": False,
                "error": "Request body must be valid JSON and include 'solution' and 'tests' keys."
            }), 400
    except Exception:
        logger.exception(f"Invalid JSON in request body rid={getattr(g,'_rid','-')}")
        return jsonify({"success": False, "error": "Invalid JSON in request body."}), 400
    try:
        logger.info(f"Proxying test run rid={getattr(g,'_rid','-')}")
        response = requests.post(
            HF_API_URL,
            json=incoming_data,
            headers={"Content-Type": "application/json"},
            timeout=45
        )
        response.raise_for_status()
        return app.response_class(
            response=response.content,
            status=response.status_code,
            mimetype=response.headers.get('Content-Type', 'application/json')
        )
    except requests.exceptions.Timeout:
        logger.error(f"Test runner timeout rid={getattr(g,'_rid','-')}")
        return jsonify({
            "success": False,
            "error": "The request to the test runner service timed out.",
            "timeout": True
        }), 504
    except requests.exceptions.RequestException as e:
        logger.exception(f"Failed to communicate with test runner rid={getattr(g,'_rid','-')}")
        return jsonify({
            "success": False,
            "error": f"Failed to communicate with the test runner service: {e}"
        }), 502

# ------------------------------------------------------------------------------
# Topic suggestion (protected)
# ------------------------------------------------------------------------------
from google import genai
client = genai.Client(api_key=os.getenv("API_KEY"))
confJson = genai.types.GenerateContentConfig(
    response_mime_type="application/json",
)

@app.route('/api/suggest-topics', methods=['POST'])
@db_guard
def suggest_topics():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json(silent=True) or {}
    problem_prompt = data.get('prompt')
    solution_code = data.get('solution')
    if not problem_prompt or not solution_code:
        return jsonify({"error": "Missing 'prompt' or 'solution' in request body"}), 400
    possible_topics = [
        "Array", "String", "Hash Table", "Dynamic Programming", "Math", "Sorting",
        "Greedy", "Depth-First Search", "Binary Search", "Database", "Matrix",
        "Tree", "Breadth-First Search", "Bit Manipulation", "Two Pointers",
        "Prefix Sum", "Heap (Priority Queue)", "Simulation", "Binary Tree",
        "Graph", "Stack", "Counting", "Sliding Window", "Design", "Enumeration",
        "Backtracking", "Union Find", "Linked List", "Number Theory", "Ordered Set",
        "Monotonic Stack", "Segment Tree", "Trie", "Combinatorics", "Bitmask",
        "Queue", "Divide and Conquer", "Recursion", "Geometry", "Binary Indexed Tree",
        "Memoization", "Hash Function", "Binary Search Tree", "Shortest Path",
        "String Matching", "Topological Sort", "Rolling Hash", "Game Theory",
        "Interactive", "Data Stream", "Monotonic Queue", "Brainteaser",
        "Doubly-Linked List", "Randomized", "Merge Sort", "Counting Sort",
        "Iterator", "Concurrency", "Probability and Statistics", "Quickselect",
        "Suffix Array", "Line Sweep", "Minimum Spanning Tree", "Bucket Sort",
        "Shell", "Reservoir Sampling", "Strongly Connected Component",
        "Eulerian Circuit", "Radix Sort", "Rejection Sampling", "Biconnected Component"
    ]
    prompt = f"""
    Analyze the following problem description and its solution code to identify the most relevant programming topics.
    From the provided list, please select the top 2 or 3 most applicable topics.

    Problem Prompt:
    {problem_prompt}

    Solution Code:
    ```
    {solution_code}
    ```

    Here is the list of possible topics to choose from:
    {json.dumps(possible_topics, indent=2)}

    Return your answer as a JSON array of strings. For example: ["Topic1", "Topic2"]
    """
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=confJson
        )
        cleaned_response_text = (response.text or "").strip().replace("```json", "").replace("```", "").strip()
        suggested_topics = json.loads(cleaned_response_text)
        if not isinstance(suggested_topics, list):
            raise ValueError("Model returned non-list JSON")
        return jsonify({"topics": suggested_topics})
    except Exception as e:
        logger.exception(f"Failed to generate or parse topics rid={getattr(g,'_rid','-')}")
        return jsonify({"error": "Failed to generate or parse topics from the model."}), 500

# ------------------------------------------------------------------------------
# Importers (protected) — also create initial versions efficiently
# ------------------------------------------------------------------------------
@app.route('/api/dataset/import/csv', methods=['POST'])
@db_guard
def import_dataset_csv():
    try:
        file = request.files.get('file')
        if file:
            text = file.read().decode('utf-8-sig')
        else:
            text = request.get_data(as_text=True)
        if not text:
            return jsonify({'error': 'No CSV content provided'}), 400

        f = io.StringIO(text)
        reader = csv.DictReader(f)
        rows = list(reader)
        if not rows:
            return jsonify([])

        now = datetime.now().isoformat()
        ds_rows, v_rows = [], []

        for r in rows:
            payload = {}
            if r.get('full_task_json'):
                try:
                    payload = json.loads(r.get('full_task_json'))
                except Exception:
                    try:
                        payload = json.loads(r.get('full_task_json').replace('""', '"'))
                    except Exception:
                        payload = {}
            if not payload:
                payload = {
                    "id": r.get("id"),
                    "language": r.get("language"),
                    "prompt": r.get("prompt"),
                    "inputs": r.get("inputs"),
                    "outputs": r.get("outputs"),
                    "code_file": r.get("code_file"),
                    "reference_solution": r.get("reference_solution") or r.get("solution"),
                    "unit_tests": r.get("unit_tests"),
                    "difficulty": r.get("difficulty"),
                    "topics": r.get("topics"),
                    "time_complexity": r.get("time_complexity"),
                    "space_complexity": r.get("space_complexity"),
                    "notes": r.get("notes"),
                    "group": r.get("group"),
                    "lastRunSuccessful": False
                }
            meta = payload.get("metadata") or {}
            merged = {
                "language": payload.get("language"),
                "prompt": payload.get("prompt"),
                "inputs": payload.get("inputs"),
                "outputs": payload.get("outputs"),
                "code_file": payload.get("code_file"),
                "reference_solution": payload.get("reference_solution"),
                "solution": payload.get("solution"),
                "unit_tests": payload.get("unit_tests"),
                "difficulty": meta.get("difficulty", payload.get("difficulty")),
                "topics": meta.get("topics", payload.get("topics")),
                "time_complexity": meta.get("time_complexity", payload.get("time_complexity")),
                "space_complexity": meta.get("space_complexity", payload.get("space_complexity")),
                "group": payload.get("group"),
                "notes": payload.get("notes", r.get("notes") or ""),
                "lastRunSuccessful": bool(payload.get("lastRunSuccessful", False)),
            }
            dataset_id = str(uuid.uuid4())
            version_id = str(uuid.uuid4())
            row = _row_from_generic_payload(merged, now)
            row["id"] = dataset_id
            row["currentVersionId"] = version_id
            ds_rows.append(row)

            snapshot = _snapshot_from_row(row)
            v_rows.append({
                "id": version_id,
                "item_id": dataset_id,
                "parent_id": None,
                "data": snapshot,
                "label": (g.user_email or "").strip(),  # editor = importer email, no stamps
                "author_id": g.user_id,
                "created_at": now
            })

        # Insert dataset rows (1 call)
        res = supabase.table('dataset').insert(ds_rows).execute()
        created = getattr(res, "data", []) or []

        # Insert versions (1 call)
        if v_rows:
            supabase.table('task_versions').insert(v_rows).execute()

        return jsonify([_flatten_dataset_row(x) for x in created])
    except Exception as e:
        logger.exception(f"Failed to import CSV rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to import CSV: {str(e)}'}), 500

@app.route('/api/dataset/import/jsonl', methods=['POST'])
@db_guard
def import_dataset_jsonl():
    try:
        file = request.files.get('file')
        if file:
            text = file.read().decode('utf-8-sig')
        else:
            text = request.get_data(as_text=True)
        if not text:
            return jsonify({'error': 'No JSONL content provided'}), 400
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if not lines:
            return jsonify([])

        now = datetime.now().isoformat()
        ds_rows, v_rows = [], []

        for line in lines:
            try:
                obj = json.loads(line)
            except Exception:
                continue
            meta = obj.get("metadata") or {}
            merged = {
                "language": obj.get("language"),
                "prompt": obj.get("prompt"),
                "inputs": obj.get("inputs"),
                "outputs": obj.get("outputs"),
                "code_file": obj.get("code_file"),
                "reference_solution": obj.get("reference_solution"),
                "solution": obj.get("solution"),
                "unit_tests": obj.get("unit_tests"),
                "difficulty": meta.get("difficulty", obj.get("difficulty")),
                "topics": meta.get("topics", obj.get("topics")),
                "time_complexity": meta.get("time_complexity", obj.get("time_complexity")),
                "space_complexity": meta.get("space_complexity", obj.get("space_complexity")),
                "group": obj.get("group"),
                "notes": obj.get("notes", ""),
                "lastRunSuccessful": bool(obj.get("lastRunSuccessful", False)),
            }
            dataset_id = str(uuid.uuid4())
            version_id = str(uuid.uuid4())
            row = _row_from_generic_payload(merged, now)
            row["id"] = dataset_id
            row["currentVersionId"] = version_id
            ds_rows.append(row)

            snapshot = _snapshot_from_row(row)
            v_rows.append({
                "id": version_id,
                "item_id": dataset_id,
                "parent_id": None,
                "data": snapshot,
                "label": (g.user_email or "").strip(),
                "author_id": g.user_id,
                "created_at": now
            })

        if not ds_rows:
            return jsonify([])

        # Insert dataset rows (1 call)
        res = supabase.table('dataset').insert(ds_rows).execute()
        created = getattr(res, "data", []) or []

        # Insert versions (1 call)
        if v_rows:
            supabase.table('task_versions').insert(v_rows).execute()

        return jsonify([_flatten_dataset_row(x) for x in created])
    except Exception as e:
        logger.exception(f"Failed to import JSONL rid={getattr(g,'_rid','-')}")
        return jsonify({'error': f'Failed to import JSONL: {str(e)}'}), 500

# ------------------------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5328)
