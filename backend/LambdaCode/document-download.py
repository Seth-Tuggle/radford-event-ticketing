import os, json, urllib.parse, boto3

s3 = boto3.client('s3')
BUCKET = os.environ['DOCUMENTS_BUCKET']

def lambda_handler(event, context):
    p = event.get('pathParameters') or {}
    event_id = p.get('eventId')
    doc_tail = p.get('docKey')  # URL-encoded tail after documents/

    if not (event_id and doc_tail):
        return _bad(400, "Missing eventId or docKey")

    tail = urllib.parse.unquote(doc_tail)
    key = f"events/{event_id}/documents/{tail}"

    try:
        s3.head_object(Bucket=BUCKET, Key=key)
    except s3.exceptions.ClientError:
        return _bad(404, "Document not found")

    url = s3.generate_presigned_url(
        ClientMethod='get_object',
        Params={'Bucket': BUCKET, 'Key': key},
        ExpiresIn=900
    )
    return _ok({"downloadUrl": url, "key": key})

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
