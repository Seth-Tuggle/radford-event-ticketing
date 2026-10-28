import json, os, boto3,re # end_time
from decimal import Decimal
from botocore.exceptions import ClientError

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

def _to_ddb(v):
    """Recursively convert JSON values to DynamoDB-friendly ones."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return Decimal(str(v))
    if isinstance(v, list):
        return [_to_ddb(x) for x in v]
    if isinstance(v, dict):
        return {k: _to_ddb(val) for k, val in v.items()}
    return v

def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS,PUT,PATCH"
        },
        "body": json.dumps(_jsonable(body))
    }

def lambda_handler(event, context):
    """
    PATCH /events/{id}
    """
    try:
        path_params = event.get("pathParameters") or {}
        evt_id = path_params.get("id")

        if not evt_id:
            return _resp(400, {"message": "Missing path parameter 'id'"})

        # Parse JSON body
        try:
            body = json.loads(event.get("body") or "{}")
        except json.JSONDecodeError:
            return _resp(400, {"message": "Request body must be valid JSON"})

        # Prevent overwriting primary key
        if PK_NAME in body:
            body.pop(PK_NAME, None)

        if not body:
            return _resp(400, {"message": "No fields to update"})

# ------------------------------
# Validate end_date_time if present
# ------------------------------
        if "end_date_time" in body and body["end_date_time"] is not None:
            end_date_time = str(body["end_date_time"])

            if not re.match(
              "[0-9]{4}\\-[01][0-9]\\-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9][+\\-][01][0-9]:[0-5][0-9]",end_date_time ):
                return _resp(400, { "message": "end_date_time must be format YYYY-MM-DDThh:mm:ss+/-hh:mm"})

            # Get existing event to compare start time
            existing = table.get_item(Key={PK_NAME: evt_id}).get("Item")

            if not existing:
               return _resp(404, {"message": f"Event {evt_id} not found"})

            start_time = existing.get("date_time")

            if start_time and end_date_time <= start_time:
                return _resp(400, { "message": "end_date_time must be after date_time"})

            body["end_date_time"] = end_date_time
# ------------------------------
 
            
    # ✅ Validate price if present
        if "price" in body and body["price"] is not None:
            try:
                price = float(body["price"])
            except (TypeError, ValueError):
                return _resp(400, {"message": "Price must be a number"})

            if price < 0:
                return _resp(400, {"message": "Price cannot be negative"})

            body["price"] = price

        # Build update expression
        update_parts = []
        expr_attr_names = {}
        expr_attr_values = {}

        for i, (field, value) in enumerate(body.items()):
            name_key = f"#f{i}"
            value_key = f":v{i}"
            update_parts.append(f"{name_key} = {value_key}")
            expr_attr_names[name_key] = field
            expr_attr_values[value_key] = _to_ddb(value)

        update_expr = "SET " + ", ".join(update_parts)

        try:
            res = table.update_item(
                Key={PK_NAME: evt_id},
                UpdateExpression=update_expr,
                ExpressionAttributeNames=expr_attr_names,
                ExpressionAttributeValues=expr_attr_values,
                ConditionExpression=f"attribute_exists({PK_NAME})",
                ReturnValues="ALL_NEW"
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return _resp(404, {"message": f"Event {evt_id} not found"})
            raise

        return _resp(200, res.get("Attributes", {}))

    except Exception as e:
        return _resp(500, {"error": str(e)})
