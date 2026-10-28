import json, os, boto3
from datetime import datetime

TABLE_NAME = os.environ.get("TABLE_NAME", "team02-events")
PK_NAME    = os.environ.get("PK_NAME", "event_id")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "PATCH,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body)
    }

def _get_method(event):
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod")  # fallback

def lambda_handler(event, context):
    try:
        method = _get_method(event)

        # CORS preflight
        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        if method != "PATCH":
            return _resp(405, {"message": f"Only PATCH allowed (got {method})"})

        path_params = event.get("pathParameters") or {}
        evt_id = path_params.get("id")
        if not evt_id:
            return _resp(400, {"message": "Missing event ID in path: /events/{id}"})

        body = json.loads(event.get("body") or "{}")
        if body.get("status") != "CANCELLED":
            return _resp(400, {"message": "Use {\"status\":\"CANCELLED\"}"})

        cancelled_at = datetime.utcnow().isoformat() + "Z"

        table.update_item(
            Key={PK_NAME: evt_id},
            UpdateExpression="SET #s = :s, cancelledAt = :t",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "CANCELLED", ":t": cancelled_at}
        )

        return _resp(200, {
            "event_id": evt_id,
            "status": "CANCELLED",
            "cancelledAt": cancelled_at
        })

    except Exception as e:
        return _resp(500, {"error": str(e)})