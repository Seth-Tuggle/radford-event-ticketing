import base64
import json
import os
from datetime import datetime
from decimal import Decimal
from urllib.parse import quote

import boto3
from boto3.dynamodb.conditions import Attr

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
DEFAULT_IMAGE_URL = (os.environ.get("DEFAULT_IMAGE_URL") or "").strip()
DEFAULT_IMAGE_KEY = (os.environ.get("DEFAULT_IMAGE_KEY") or "Default/default-event.jpg").strip()
MEDIA_BUCKET = (os.environ.get("MEDIA_BUCKET") or "").strip()

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


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


def _encode_token(lek):
    raw = json.dumps(lek).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8")


def _decode_token(tok):
    try:
        raw = base64.urlsafe_b64decode(tok.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def _extract_date(value):
    if not value:
        return ""
    return str(value)[:10]


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


def _parse_date(raw_value, field_name):
    value = (raw_value or "").strip()
    if not value:
        return None, f"Missing required query parameter: {field_name} (format: YYYY-MM-DD)"

    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None, f"Invalid {field_name} format. Expected YYYY-MM-DD"

    return parsed.isoformat(), None


def _resolve_date_range(qs):
    single_date = (qs.get("date") or "").strip()

    start_raw = (
        qs.get("startDate")
        or qs.get("start_date")
        or single_date
    )
    end_raw = (
        qs.get("endDate")
        or qs.get("end_date")
        or single_date
    )

    if not start_raw or not end_raw:
        return None, None, (
            "Missing required query parameters: startDate and endDate "
            "(format: YYYY-MM-DD). You may also pass date for a single-day search."
        )

    start_date, start_error = _parse_date(start_raw, "startDate")
    if start_error:
        if single_date and start_raw == single_date:
            return None, None, "Invalid date format. Expected YYYY-MM-DD"
        return None, None, start_error

    end_date, end_error = _parse_date(end_raw, "endDate")
    if end_error:
        if single_date and end_raw == single_date:
            return None, None, "Invalid date format. Expected YYYY-MM-DD"
        return None, None, end_error

    if start_date > end_date:
        return None, None, "startDate must be less than or equal to endDate"

    return start_date, end_date, None


def _date_in_range(value, start_date, end_date):
    item_date = _extract_date(value)
    if not item_date:
        return False
    return start_date <= item_date <= end_date


def _match_item(item, start_date, end_date, filter_type):
    start_match = _date_in_range(item.get("date_time") or "", start_date, end_date)
    end_match = _date_in_range(item.get("end_date_time") or "", start_date, end_date)

    if filter_type == "start":
        return start_match
    if filter_type == "end":
        return end_match
    return start_match or end_match


def _build_filter_expression(start_date, end_date, filter_type):
    start_bound = start_date
    end_bound = end_date + "\uffff"

    if filter_type == "start":
        return Attr("date_time").between(start_bound, end_bound)
    if filter_type == "end":
        return Attr("end_date_time").between(start_bound, end_bound)
    return (
        Attr("date_time").between(start_bound, end_bound)
        | Attr("end_date_time").between(start_bound, end_bound)
    )


def lambda_handler(event, context):
    try:
        method = _get_method(event)

        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        if method != "GET":
            return _resp(405, {"error": "Method not allowed"})

        qs = _get_qs(event)

        start_date, end_date, date_error = _resolve_date_range(qs)
        if date_error:
            return _resp(400, {"error": date_error})

        filter_type = (qs.get("type") or "both").strip().lower()
        if filter_type not in ("start", "end", "both"):
            return _resp(400, {"error": "Invalid type parameter. Must be 'start', 'end', or 'both'"})

        try:
            limit = int(qs.get("limit") or 25)
        except ValueError:
            return _resp(400, {"error": "limit must be an integer"})
        limit = max(1, min(limit, 100))

        start_key = None
        if qs.get("nextToken"):
            start_key = _decode_token(qs["nextToken"])
            if start_key is None:
                return _resp(400, {"error": "Invalid nextToken"})

        filter_expr = _build_filter_expression(start_date, end_date, filter_type)

        matches = []
        last_evaluated_key = start_key
        page_limit = 100

        while len(matches) < limit:
            scan_kwargs = {
                "Limit": page_limit,
                "FilterExpression": filter_expr,
            }
            if last_evaluated_key:
                scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

            resp = table.scan(**scan_kwargs)
            items = resp.get("Items") or []

            for item in items:
                if _match_item(item, start_date, end_date, filter_type):
                    matches.append(item)
                    if len(matches) >= limit:
                        break

            last_evaluated_key = resp.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break

        matches = [_with_default_image(item) for item in matches]

        body = {
            "startDate": start_date,
            "endDate": end_date,
            "type": filter_type,
            "count": len(matches),
            "items": matches,
        }

        if start_date == end_date:
            body["date"] = start_date

        if last_evaluated_key:
            body["nextToken"] = _encode_token(last_evaluated_key)

        return _resp(200, body)

    except Exception as e:
        return _resp(500, {"error": str(e)})
