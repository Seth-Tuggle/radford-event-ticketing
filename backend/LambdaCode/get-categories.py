import json, os, boto3
from decimal import Decimal

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
PK_NAME    = os.environ.get("PK_NAME", "event_id")

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
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod")

def lambda_handler(event, context):
    try:
        method = _get_method(event)

        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        path_params = event.get("pathParameters") or {}
        evt_id = path_params.get("id")

        # Only support: GET with a specific event id
        if method != "GET" or not evt_id:
            return _resp(400, {"message": "Provide an event id in the path. Example: GET /events/{id}/categories (returns categories only)."})

        # Fetch ONLY the categories attribute
        res = table.get_item(
            Key={PK_NAME: evt_id},
            ProjectionExpression="#c",
            ExpressionAttributeNames={"#c": "categories"},
        )

        item = res.get("Item")
        if not item:
            return _resp(404, {"message": f"Event {evt_id} not found"})

        # If categories is missing, return empty list (or None — your choice)
        categories = item.get("categories", [])

        # Return just the categories value (not the whole event)
        return _resp(200, categories)

    except Exception as e:
        return _resp(500, {"error": str(e)})
