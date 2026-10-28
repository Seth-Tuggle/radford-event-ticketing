import os, json, boto3, urllib.parse

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')

TABLE = dynamodb.Table(os.environ['EVENTS_TABLE'])
BUCKET = os.environ['MEDIA_BUCKET']
VIEW_BASE = os.environ.get('VIEW_BASE', '').rstrip('/')  # set for public, leave empty for private
DEFAULT_IMAGE_URL = (os.environ.get('DEFAULT_IMAGE_URL') or '').strip()
DEFAULT_IMAGE_KEY = (os.environ.get('DEFAULT_IMAGE_KEY') or 'Default/default-event.jpg').strip()

def _cors():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "http://127.0.0.1:5500",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

def _build_image_url(key):
    if not key:
        return None
    if VIEW_BASE:
        return f"{VIEW_BASE}/{urllib.parse.quote(key, safe='/')}"
    return s3.generate_presigned_url(
        ClientMethod='get_object',
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=900
    )

def _default_image_url():
    if DEFAULT_IMAGE_URL:
        return DEFAULT_IMAGE_URL
    return _build_image_url(DEFAULT_IMAGE_KEY)

def lambda_handler(event, context):
    # Preflight
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": _cors(), "body": ""}

    event_id = (event.get('pathParameters') or {}).get('eventId')
    if not event_id:
        return {"statusCode": 400, "headers": _cors(), "body": json.dumps({"error":"missing eventId"})}

    # fetch event
    resp = TABLE.get_item(Key={"pk": f"EVENT#{event_id}", "sk": "META"})
    item = resp.get("Item")
    if not item:
        return {"statusCode": 404, "headers": _cors(), "body": json.dumps({"error":"not found"})}

    # build hero URL
    hero_key = item.get("heroImageKey")
    hero_url = None
    if hero_key:
        hero_url = _build_image_url(hero_key)
    else:
        hero_url = _default_image_url()

    # (optional) do the same for gallery: if you store an array of keys in item["galleryKeys"], presign or map to VIEW_BASE too

    out = {**item, "heroImageUrl": hero_url}
    out.pop("staff_passcode", None)
    out.pop("ticket_sync_response", None)
    return {"statusCode": 200, "headers": _cors(), "body": json.dumps(out)}
