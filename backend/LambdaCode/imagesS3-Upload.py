import json, os, uuid, mimetypes, boto3, logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')

BUCKET = os.environ.get('MEDIA_BUCKET')  # must be set

# --- CORS (dev) ---
CORS_HEADERS = {
    # lock this down to your dev origin; use "*" temporarily if you prefer
    "Access-Control-Allow-Origin": "http://127.0.0.1:5500",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
}
BASE_HEADERS = {"Content-Type": "application/json", **CORS_HEADERS}
# -------------------

def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')

        # prefer path param if present
        path_event_id = (event.get('pathParameters') or {}).get('eventId')
        event_id = path_event_id or body.get('eventId')
        if not event_id:
            return _bad_request("Missing eventId in path or body")

        kind = (body.get('kind') or 'hero').lower()
        ext  = (body.get('ext')  or 'jpg').lower()

        key = (
            f"events/{event_id}/hero.{ext}"
            if kind == 'hero'
            else f"events/{event_id}/gallery/{uuid.uuid4().hex}.{ext}"
        )

        content_type = mimetypes.guess_type(f"f.{ext}")[0] or "application/octet-stream"

        url = s3.generate_presigned_url(
            ClientMethod='put_object',
            Params={'Bucket': BUCKET, 'Key': key, 'ContentType': content_type},
            ExpiresIn=900, HttpMethod='PUT'
        )

        return _ok({"uploadUrl": url, "key": key})

    except Exception as e:
        logger.exception("presign failed")
        # helpful (but safe) dev error
        return _server_err(f"{type(e).__name__}: {str(e)}")

def _ok(obj):
    return {"statusCode": 200, "headers": BASE_HEADERS, "body": json.dumps(obj)}

def _bad_request(msg):
    return {"statusCode": 400, "headers": BASE_HEADERS, "body": json.dumps({"error": msg})}

def _server_err(msg):
    return {"statusCode": 500, "headers": BASE_HEADERS, "body": json.dumps({"error": msg})}
