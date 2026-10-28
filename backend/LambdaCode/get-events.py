import json, os, boto3
from decimal import Decimal
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Attr
from urllib.parse import quote

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
PK_NAME    = os.environ.get("PK_NAME", "event_id")
DEFAULT_IMAGE_URL = (os.environ.get("DEFAULT_IMAGE_URL") or "").strip()
DEFAULT_IMAGE_KEY = (os.environ.get("DEFAULT_IMAGE_KEY") or "Default/default-event.jpg").strip()
MEDIA_BUCKET = (os.environ.get("MEDIA_BUCKET") or "").strip()

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

def _jsonable(v):
    """Recursively convert DynamoDB types to JSON-serializable ones."""
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, set):
        return [_jsonable(x) for x in v]
    if isinstance(v, list):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsonable(val) for k, val in v.items()}
    return v

def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(_jsonable(body))
    }

def _get_method(event):
    """
    Works for:
    - HTTP API
    - REST API
    - Lambda console tests (defaults to GET)
    """
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod") or "GET"

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

def lambda_handler(event, context):
    try:
        method = _get_method(event)

        # CORS preflight
        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        if method != "GET":
            return _resp(405, {"message": f"Method not allowed: {method}"})

        path_params = event.get("pathParameters") or {}
        evt_id = path_params.get("id")

        # -------------------------
        # GET /events/{id}
        # Return even if CANCELLED
        # -------------------------
        if evt_id:
            res = table.get_item(Key={PK_NAME: evt_id})
            item = res.get("Item")
            if not item:
                return _resp(404, {"message": f"Event {evt_id} not found"})
            return _resp(200, _with_default_image(item))

        # -------------------------
        # GET /events
        # Hide CANCELLED + Hide expired
        # -------------------------
        qs = event.get("queryStringParameters") or {}
        limit = max(1, min(int(qs.get("limit", "50")), 100))

        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

        filter_expr = (
            (Attr("status").ne("CANCELLED") | Attr("status").not_exists())
            &
            (Attr("end_date_time").gt(now) | Attr("end_date_time").not_exists())
        )

        items = []
        scan_kwargs = {
            "Limit": limit,
            "FilterExpression": filter_expr
        }

        while True:
            res = table.scan(**scan_kwargs)
            items.extend(res.get("Items", []))

            if len(items) >= limit:
                items = items[:limit]
                break

            if "LastEvaluatedKey" not in res:
                break

            scan_kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]

        items = [_with_default_image(item) for item in items[:limit]]

        return _resp(200, {"items": items, "count": len(items)})

    except Exception as e:
        return _resp(500, {"error": str(e)})
