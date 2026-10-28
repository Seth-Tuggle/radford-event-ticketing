import os, json, uuid, mimetypes, boto3

s3 = boto3.client('s3')
BUCKET = os.environ['DOCUMENTS_BUCKET']

def lambda_handler(event, context):
    body = json.loads(event.get('body') or '{}')
    path_params = event.get('pathParameters') or {}
    event_id = path_params.get('eventId') or body.get('eventId')
    if not event_id:
        return _bad(400, "Missing eventId in path or body")

    original = (body.get('filename') or 'document').strip()
    ext = (body.get('ext') or _guess_ext(original) or 'bin').lower()
    content_type = body.get('contentType') or mimetypes.guess_type(original)[0] or 'application/octet-stream'

    key = f"events/{event_id}/documents/{uuid.uuid4().hex}.{ext}"

    url = s3.generate_presigned_url(
        ClientMethod='put_object',
        Params={
            'Bucket': BUCKET,
            'Key': key,
            'ContentType': content_type,
            'Metadata': {'original-filename': original}
        },
        ExpiresIn=900
    )
    return _ok({"uploadUrl": url, "key": key, "contentType": content_type})

def _guess_ext(name):
    return name.rsplit('.', 1)[-1].lower() if '.' in name else None

def _ok(payload):
    return {"statusCode": 200, "headers": _cors(), "body": json.dumps(payload)}

def _bad(code, msg):
    return {"statusCode": code, "headers": _cors(), "body": json.dumps({"error": msg})}

def _cors():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    }
