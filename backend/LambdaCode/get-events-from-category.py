import json, os, boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Attr
from urllib.parse import quote

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
DEFAULT_IMAGE_URL = (os.environ.get("DEFAULT_IMAGE_URL") or "").strip()
DEFAULT_IMAGE_KEY = (os.environ.get("DEFAULT_IMAGE_KEY") or "Default/default-event.jpg").strip()
MEDIA_BUCKET = (os.environ.get("MEDIA_BUCKET") or "").strip()

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

def _jsonable(v):
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
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod")

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
        if method == "OPTIONS":
            return _resp(200, {"ok": True})
        if method != "GET":
            return _resp(405, {"message": f"Method not allowed: {method}"})

        qs = event.get("queryStringParameters") or {}
        raw = (qs.get("category") or "").strip()
        if not raw:
            return _resp(400, {"message": "Missing required query param: category"})


        category = raw

        limit = max(1, min(int(qs.get("limit", "25")), 100))
        filter_expr = Attr("categories").contains(category) & Attr("status").ne("CANCELLED")

        items = []
        last_evaluated_key = None

        # Keep scanning pages until we hit 'limit' matches or run out of data
        while len(items) < limit:
            scan_kwargs = {
                "FilterExpression": filter_expr,
                # Scan Limit controls *items evaluated*, not items returned.
                # Use a moderate page size to reduce latency.
                "Limit": min(100, limit * 4),
            }
            if last_evaluated_key:
                scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

            resp = table.scan(**scan_kwargs)
            page_items = resp.get("Items", [])
            items.extend(page_items)

            last_evaluated_key = resp.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break

        # Trim to exact limit
        items = [_with_default_image(item) for item in items[:limit]]

        return _resp(200, {
            "category": category,
            "count": len(items),
            "items": items,
            "nextKey": last_evaluated_key
        })

    except Exception as e:
        return _resp(500, {"error": str(e)})
