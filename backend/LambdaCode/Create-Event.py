import os, json, uuid, boto3, re
from decimal import Decimal
from datetime import datetime, UTC
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
import requests

LOCAL = os.environ.get("LOCAL", "true").lower() == "true"

RAW_TABLE = os.environ.get("TABLE_NAME", "team02-events")
TABLE_NAME = RAW_TABLE.strip()
TEAM03_CREATE_TICKETS_ARN = (
    os.environ.get("TEAM03_CREATE_TICKETS_ARN")
    or "arn:aws:lambda:us-east-1:000000000000:function:team03-create-tickets"
).strip()
DEFAULT_BUDGET_PRICE = Decimal("10")
DEFAULT_STANDARD_PRICE = Decimal("50")
DEFAULT_VIP_PRICE = Decimal("100")
TEAM03_SUPPORTED_LAYOUTS = {
    ("Muse Banquet Hall", "Classroom"),
    ("Muse Banquet Hall", "Theater"),
    ("Muse Banquet Hall", "Banquet"),
}

# set for performance
# Some of these will practically never be used since the Dedmon center is the only supported sports venue
CATEGORIES = ("Sports",
              "Baseball",
              "Basketball",
              "Cross Country",
              "Golf",
              "Soccer",
              "Track and Field",
              "Lacrosse",
              "Softball",
              "Volleyball",
              "Music",
              "Conference",
              "Speech",
              "Performance",
              "Honors",
              "Academic")

if not LOCAL:
    dynamodb = boto3.resource("dynamodb")
    TABLE = dynamodb.Table(TABLE_NAME)
    lambda_client = boto3.client("lambda")

DEBUG = os.environ.get("DEBUG", "").lower() == "true"

ISO_RE = re.compile(r"^[0-9]{4}\-[01][0-9]\-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9][+\-][01][0-9]:[0-5][0-9]$")
CREATED_AT_RE = re.compile(r"^[0-9]{4}\-[01][0-9]\-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]\.[0-9]{6}$")


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(tzinfo=None).isoformat(timespec="microseconds")


def _resolve_created_at(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return _utc_now_iso()

    created_at = str(value).strip()
    if not CREATED_AT_RE.match(created_at):
        raise ValueError("created_at must be of format YYYY-MM-DDThh:mm:ss.ffffff")

    try:
        datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S.%f")
    except Exception:
        raise ValueError("created_at must be a valid timestamp of format YYYY-MM-DDThh:mm:ss.ffffff")

    return created_at

def _json_sanitize(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, set):
        return sorted([_json_sanitize(x) for x in o])
    if isinstance(o, (list, tuple)):
        return [_json_sanitize(x) for x in o]
    if isinstance(o, dict):
        return {k: _json_sanitize(v) for k, v in o.items()}
    return o

def _resp(status, body):
    safe = _json_sanitize(body)
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "OPTIONS,POST"
        },
        "body": json.dumps(safe)
    }

def _as_decimal(n):
    if n is None:
        return None
    try:
        return Decimal(str(n))
    except Exception:
        raise ValueError("seat_count must be a number")

def _coerce_string_or_list(val, field_name):
    if val is None:
        return None
    if isinstance(val, str):
        if val.startswith("data:"):
            raise ValueError(f"{field_name} must be S3 keys/URLs, not Base64 data")
        return val
    if isinstance(val, (list, tuple)):
        out = []
        for x in val:
            s = str(x)
            if s.startswith("data:"):
                raise ValueError(f"{field_name} must be S3 keys/URLs, not Base64 data")
            out.append(s)
        return out
    raise ValueError(f"{field_name} must be a string or list of strings")

def _coerce_categories(val):
    if val is None:
        return None
    if isinstance(val, (list, tuple, set)):
        return set(str(x).strip() for x in val if str(x).strip())
    if isinstance(val, str):
        parts = [p.strip() for p in val.split(",")]
        return set(p for p in parts if p)
    raise ValueError("categories must be a list/CSV/string")

def _resolve_categories(val):
    cats = _coerce_categories(val)
    if not cats:
        raise ValueError("At least one category is required")

    valid_cats = sorted(cat for cat in cats if cat in CATEGORIES)
    if not valid_cats:
        raise ValueError("At least one valid category is required")

    return valid_cats

def _parse_iso(dt_str: str) -> datetime:
    # Convert "YYYY-MM-DDThh:mm:ss+00:00" -> datetime
    # datetime.fromisoformat supports "+00:00" offsets
    return datetime.fromisoformat(dt_str)

def _coerce_price(value, field_name):
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        price = Decimal(str(value))
    except Exception:
        raise ValueError(f"{field_name} must be a number")

    if price < 0:
        raise ValueError(f"{field_name} cannot be negative")

    return price

def _resolve_tier_prices(body):
    budget_price = _coerce_price(body.get("budget_price"), "budget_price")
    standard_price = _coerce_price(body.get("standard_price"), "standard_price")
    vip_price = _coerce_price(body.get("vip_price"), "vip_price")

    if budget_price is None:
        budget_price = DEFAULT_BUDGET_PRICE
    if standard_price is None:
        standard_price = DEFAULT_STANDARD_PRICE
    if vip_price is None:
        vip_price = DEFAULT_VIP_PRICE

    if not (budget_price < standard_price < vip_price):
        raise ValueError("budget_price must be less than standard_price, and standard_price must be less than vip_price")

    return {
        "budget_price": budget_price,
        "standard_price": standard_price,
        "vip_price": vip_price,
    }

def _json_number(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value

def _safe_json_loads(value):
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return value
    return value

def _normalize_invoke_payload(raw_payload):
    parsed = _safe_json_loads(raw_payload)
    if isinstance(parsed, dict) and "body" in parsed:
        body = _safe_json_loads(parsed.get("body"))
        return parsed, body
    return parsed, parsed

def _sync_tickets_with_team03(event_id, venue_name, layout_name, tier_prices):
    if (venue_name, layout_name) not in TEAM03_SUPPORTED_LAYOUTS:
        return {
            "ticket_sync_status": "UNSYNCED",
            "ticket_sync_reason": "UNSUPPORTED_VENUE_LAYOUT",
        }

    payload = {
        "event_id": event_id,
        "venue_name": venue_name,
        "layout_name": layout_name,
        "budget_price": _json_number(tier_prices["budget_price"]),
        "standard_price": _json_number(tier_prices["standard_price"]),
        "vip_price": _json_number(tier_prices["vip_price"]),
    }

    try:
        response = lambda_client.invoke(
            FunctionName=TEAM03_CREATE_TICKETS_ARN,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload).encode("utf-8"),
        )
    except Exception as exc:
        return {
            "ticket_sync_status": "UNSYNCED",
            "ticket_sync_reason": f"INVOKE_ERROR: {str(exc)}",
        }

    parsed_payload, response_body = _normalize_invoke_payload(response["Payload"].read())
    function_error = response.get("FunctionError")
    status_code = parsed_payload.get("statusCode") if isinstance(parsed_payload, dict) else None

    if function_error:
        return {
            "ticket_sync_status": "UNSYNCED",
            "ticket_sync_reason": f"LAMBDA_FUNCTION_ERROR: {function_error}",
        }

    if isinstance(status_code, int) and status_code >= 400:
        return {
            "ticket_sync_status": "UNSYNCED",
            "ticket_sync_reason": f"TEAM03_STATUS_{status_code}",
        }

    normalized_body = response_body if isinstance(response_body, dict) else {}
    staff_passcode = (
        normalized_body.get("staff_passcode")
        or normalized_body.get("staffPasscode")
    )

    result = {
        "ticket_sync_status": "SYNCED",
    }
    if staff_passcode:
        result["staff_passcode"] = str(staff_passcode)
    return result

def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return _resp(200, {"ok": True})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "Invalid JSON body"})

    required = ["event_name", "date_time", "end_date_time", "location", "venue_name", "layout_name"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return _resp(400, {"error": f"Missing required fields: {', '.join(missing)}"})

    event_id = str(body.get("event_id") or uuid.uuid4())

    cognito_sub = (((event.get("requestContext") or {}).get("authorizer") or {}).get("claims") or {}).get("sub")
    event_creator = body.get("event_creator") or cognito_sub

    # Validate date_time format
    date_time = str(body["date_time"])
    if not ISO_RE.match(date_time):
        return _resp(400, {"message": f'date_time field value must be of format YYYY-MM-DDThh:mm:ss+/-hh:mm, input was "{date_time}"'})

    # Validate end_date_time format + ordering
    end_date_time = str(body.get("end_date_time"))
    if end_date_time:
        if not ISO_RE.match(end_date_time):
            return _resp(400, {"message": f'end_date_time field value must be of format YYYY-MM-DDThh:mm:ss+/-hh:mm, input was "{end_date_time}"'})

        try:
            start_dt = _parse_iso(date_time)
            end_dt = _parse_iso(end_date_time)
        except Exception:
            return _resp(400, {"message": "date_time/end_date_time must be valid ISO-8601 timestamps with timezone offset"})

        if end_dt <= start_dt:
            return _resp(400, {"message": "end_date_time must be after date_time"})

    # seat_count validation (only if provided)
    if "seat_count" in body and body["seat_count"] is not None:
        try:
            seat_count = int(body["seat_count"])
            if seat_count <= 0:
                return _resp(400, {"message": f'seat_count field value must be a positive integer, input was "{seat_count}"'})
        except Exception:
            bad_val = body.get("seat_count")
            return _resp(400, {"message": f'seat_count field value must be a positive integer, input was "{bad_val}"'})

    event_name=str(body["event_name"])
    venue_name = str(body["venue_name"]).strip()
    layout_name = str(body["layout_name"]).strip()

    try:
        created_at = _resolve_created_at(body.get("created_at"))
        tier_prices = _resolve_tier_prices(body)
        categories = _resolve_categories(body.get("categories"))

        item = {
            "event_id": event_id,
            "event_name": event_name,
            "created_at": created_at,
            "date_time": date_time,
            "location": str(body["location"]),
            "venue_name": venue_name,
            "layout_name": layout_name,
            "budget_price": tier_prices["budget_price"],
            "standard_price": tier_prices["standard_price"],
            "vip_price": tier_prices["vip_price"],
            "categories": categories,
            "ticket_sync_status": "UNSYNCED",
            "index": "ALL_EVENTS",
        }

        if end_date_time:
            item["end_date_time"] = end_date_time

        if "description" in body:
            item["description"] = str(body["description"])

        if "seat_count" in body and body["seat_count"] is not None:
            item["seat_count"] = _as_decimal(body["seat_count"])

        # Accept S3 keys/URLs only (no Base64)
        if "images" in body:
            item["images"] = _coerce_string_or_list(body["images"], "images")
        if "documents" in body:
            item["documents"] = _coerce_string_or_list(body["documents"], "documents")

        if event_creator:
            item["event_creator"] = str(event_creator)

    except ValueError as ve:
        return _resp(400, {"error": str(ve)})

    # print(item["event_id"])
    # print(item["event_name"])

    if LOCAL:
        print("Final event:")
        print(item)
        return _resp(201, {"message": f"Input accepted, aborting before attempting network access"})

    sync_result = _sync_tickets_with_team03(event_id, venue_name, layout_name, tier_prices)
    item["ticket_sync_status"] = sync_result["ticket_sync_status"]
    if sync_result.get("ticket_sync_reason"):
        item["ticket_sync_reason"] = sync_result["ticket_sync_reason"]
    if sync_result.get("staff_passcode"):
        item["staff_passcode"] = sync_result["staff_passcode"]

    headers={"user-agent":"Team02-create"}
    sendJson={
    "topic_name": event_id,
    "display_name": event_name
    }
    try:
        notificationsResponse=requests.post("https://service.example.invalid/Sprint2/Group-5/SNSTopicCreator",json=sendJson,headers=headers,verify=False)
    except Exception as exc:
        return _resp(500,{"message":"Error initializing notifications.","error":str(exc)})

    item["notification_ARN"]=json.loads(notificationsResponse.text)["topic_arn"]

    try:
        TABLE.put_item(Item=item, ConditionExpression=Attr("event_id").not_exists())
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        msg = e.response.get("Error", {}).get("Message")
        http = 409 if code == "ConditionalCheckFailedException" else 500
        payload = {"error": "DynamoDB error", "error_code": code}
        if DEBUG:
            payload["error_message"] = msg
        return _resp(http, payload)

    response_body = {
        "message": "Event created",
        "event_id": event_id,
        "ticket_sync_status": item["ticket_sync_status"],
    }
    if item.get("ticket_sync_reason"):
        response_body["ticket_sync_reason"] = item["ticket_sync_reason"]
    if item.get("staff_passcode"):
        response_body["staff_passcode"] = item["staff_passcode"]

    return _resp(201, response_body)
