import base64
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote

import boto3

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
DEFAULT_IMAGE_URL = (os.environ.get("DEFAULT_IMAGE_URL") or "").strip()
DEFAULT_IMAGE_KEY = (os.environ.get("DEFAULT_IMAGE_KEY") or "Default/default-event.jpg").strip()
MEDIA_BUCKET = (os.environ.get("MEDIA_BUCKET") or "").strip()

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

TOKEN_RE = re.compile(r"[a-z0-9]+")

TITLE_TOKEN_WEIGHT = 40
TITLE_PHRASE_WEIGHT = 120
TITLE_COVERAGE_WEIGHT = 15

CATEGORY_TOKEN_WEIGHT = 24
CATEGORY_PHRASE_WEIGHT = 80
CATEGORY_COVERAGE_WEIGHT = 10

DESCRIPTION_TOKEN_WEIGHT = 10
DESCRIPTION_PHRASE_WEIGHT = 30
DESCRIPTION_COVERAGE_WEIGHT = 4


def _json_safe(obj):
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, set):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(_json_safe(body)),
    }


def _get_method(event):
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod") or ""


def _get_qs(event):
    return event.get("queryStringParameters") or {}


def _normalize_text(value):
    cleaned = TOKEN_RE.findall(str(value or "").lower())
    return " ".join(cleaned)


def _collapse_text(value):
    return "".join(TOKEN_RE.findall(str(value or "").lower()))


def _tokenize(value):
    tokens = []
    seen = set()
    for token in TOKEN_RE.findall(str(value or "").lower()):
        if token and token not in seen:
            seen.add(token)
            tokens.append(token)
    return tokens


def _to_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if "," in raw:
            parts = [part.strip() for part in raw.split(",")]
            return [part for part in parts if part]
        return [raw]
    return [str(value)]


def _encode_token(payload):
    raw = json.dumps(payload).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def _decode_token(token):
    try:
        raw = base64.urlsafe_b64decode(token.encode("utf-8"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def _default_image_ref():
    if DEFAULT_IMAGE_URL:
        return DEFAULT_IMAGE_URL
    if MEDIA_BUCKET and DEFAULT_IMAGE_KEY:
        return f"https://{MEDIA_BUCKET}.s3.amazonaws.com/{quote(DEFAULT_IMAGE_KEY, safe='/')}"
    return ""


def _has_attached_image(item):
    images = item.get("images")
    if isinstance(images, str) and images.strip():
        return True
    if isinstance(images, (list, tuple, set)) and any(str(image).strip() for image in images):
        return True

    for field in ("hero_image", "heroImageUrl", "heroImageKey"):
        if str(item.get(field) or "").strip():
            return True

    return False


def _with_default_image(item):
    if not isinstance(item, dict):
        return item
    if _has_attached_image(item):
        updated = dict(item)
        updated.pop("staff_passcode", None)
        updated.pop("ticket_sync_response", None)
        return updated

    default_image = _default_image_ref()
    updated = dict(item)
    updated.pop("staff_passcode", None)
    updated.pop("ticket_sync_response", None)
    if not default_image:
        return updated
    updated["images"] = [default_image]
    return updated


def _score_field(text, query_text, query_collapsed, query_tokens, token_weight, phrase_weight, coverage_weight):
    normalized = _normalize_text(text)
    collapsed = _collapse_text(text)

    if not normalized and not collapsed:
        return {"score": 0, "hits": 0, "phrase": False}

    hits = set()
    for token in query_tokens:
        if token in normalized or token in collapsed:
            hits.add(token)

    phrase_match = False
    if query_text and query_text in normalized:
        phrase_match = True
    elif query_collapsed and query_collapsed in collapsed:
        phrase_match = True

    score = len(hits) * token_weight
    if hits:
        score += len(hits) * coverage_weight
    if phrase_match:
        score += phrase_weight

    return {
        "score": score,
        "hits": len(hits),
        "phrase": phrase_match,
    }


def _score_categories(categories, query_text, query_collapsed, query_tokens):
    if not categories:
        return {"score": 0, "hits": 0, "phrase": False}

    normalized_values = [_normalize_text(value) for value in categories]
    collapsed_values = [_collapse_text(value) for value in categories]

    hits = set()
    for token in query_tokens:
        for normalized, collapsed in zip(normalized_values, collapsed_values):
            if token in normalized or token in collapsed:
                hits.add(token)
                break

    phrase_match = False
    for normalized, collapsed in zip(normalized_values, collapsed_values):
        if query_text and query_text in normalized:
            phrase_match = True
            break
        if query_collapsed and query_collapsed in collapsed:
            phrase_match = True
            break

    score = len(hits) * CATEGORY_TOKEN_WEIGHT
    if hits:
        score += len(hits) * CATEGORY_COVERAGE_WEIGHT
    if phrase_match:
        score += CATEGORY_PHRASE_WEIGHT

    return {
        "score": score,
        "hits": len(hits),
        "phrase": phrase_match,
    }


def _score_item(item, query_text, query_collapsed, query_tokens):
    title_result = _score_field(
        item.get("event_name"),
        query_text,
        query_collapsed,
        query_tokens,
        TITLE_TOKEN_WEIGHT,
        TITLE_PHRASE_WEIGHT,
        TITLE_COVERAGE_WEIGHT,
    )
    category_result = _score_categories(
        _to_list(item.get("categories")),
        query_text,
        query_collapsed,
        query_tokens,
    )
    description_result = _score_field(
        item.get("description"),
        query_text,
        query_collapsed,
        query_tokens,
        DESCRIPTION_TOKEN_WEIGHT,
        DESCRIPTION_PHRASE_WEIGHT,
        DESCRIPTION_COVERAGE_WEIGHT,
    )

    total_score = (
        title_result["score"]
        + category_result["score"]
        + description_result["score"]
    )

    return {
        "score": total_score,
        "title_hits": title_result["hits"],
        "category_hits": category_result["hits"],
        "description_hits": description_result["hits"],
        "title_phrase": title_result["phrase"],
        "category_phrase": category_result["phrase"],
        "description_phrase": description_result["phrase"],
    }


def _sort_key(result):
    item = result["item"]
    return (
        -int(result["title_hits"] > 0),
        -int(result["title_phrase"]),
        -result["title_hits"],
        -int(result["category_hits"] > 0),
        -int(result["category_phrase"]),
        -result["category_hits"],
        -int(result["description_hits"] > 0),
        -int(result["description_phrase"]),
        -result["description_hits"],
        -result["score"],
        item.get("date_time") or "",
        item.get("event_name") or "",
        item.get("event_id") or "",
    )


def _scan_all_items():
    items = []
    last_key = None

    while True:
        scan_kwargs = {"Limit": 100}
        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key

        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items") or [])

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

    return items


def _is_upcoming(item, now=None):
    current_time = now or datetime.now(timezone.utc)
    dt_str = item.get("date_time")
    if not dt_str:
        return True

    try:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt >= current_time
    except Exception:
        return True


def lambda_handler(event, context):
    try:
        method = _get_method(event)

        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        if method != "GET":
            return _resp(405, {"error": "Method not allowed"})

        qs = _get_qs(event)
        q = (qs.get("q") or "").strip()
        if not q:
            now = datetime.now(timezone.utc)
            all_items = [
                _with_default_image(item)
                for item in _scan_all_items()
                if item.get("status") != "CANCELLED" and _is_upcoming(item, now)
            ]
            return _resp(200, {
                "q": "",
                "count": len(all_items),
                "totalMatches": len(all_items),
                "items": all_items,
            })

        try:
            limit = int(qs.get("limit") or 25)
        except ValueError:
            return _resp(400, {"error": "limit must be an integer"})
        limit = max(1, min(limit, 100))

        offset = 0
        if qs.get("nextToken"):
            token_payload = _decode_token(qs["nextToken"])
            if not token_payload or not isinstance(token_payload.get("offset"), int):
                return _resp(400, {"error": "Invalid nextToken"})
            offset = max(0, token_payload["offset"])

        query_text = _normalize_text(q)
        query_collapsed = _collapse_text(q)
        query_tokens = _tokenize(q)
        if not query_tokens:
            return _resp(400, {"error": "Missing required query parameter: q"})

        ranked_matches = []
        for item in _scan_all_items():
            if item.get("status") == "CANCELLED":
                continue

            ranking = _score_item(item, query_text, query_collapsed, query_tokens)
            if ranking["score"] <= 0:
                continue

            ranked_matches.append({
                "item": item,
                "score": ranking["score"],
                "title_hits": ranking["title_hits"],
                "title_phrase": ranking["title_phrase"],
                "category_hits": ranking["category_hits"],
                "category_phrase": ranking["category_phrase"],
                "description_hits": ranking["description_hits"],
                "description_phrase": ranking["description_phrase"],
            })

        ranked_matches.sort(key=_sort_key)

        page = ranked_matches[offset:offset + limit]
        next_offset = offset + len(page)

        body = {
            "q": q,
            "count": len(page),
            "totalMatches": len(ranked_matches),
            "items": [_with_default_image(entry["item"]) for entry in page],
        }

        if next_offset < len(ranked_matches):
            body["nextToken"] = _encode_token({"offset": next_offset})

        return _resp(200, body)

    except Exception as e:
        return _resp(500, {"error": str(e)})
