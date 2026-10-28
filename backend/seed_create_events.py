import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


DEFAULT_API_BASE = "https://service.example.invalid/production/Group-2"
DEFAULT_CREATE_PATH = "/Create-Event"
SEED_START_YEAR = 2025
SEED_START_MONTH = 4
SEED_END_YEAR = 2027
SEED_END_MONTH = 12
TOTAL_MONTH_SLOTS = ((SEED_END_YEAR - SEED_START_YEAR) * 12) + (SEED_END_MONTH - SEED_START_MONTH) + 1
DEFAULT_COUNT = TOTAL_MONTH_SLOTS
CREATOR_NAMESPACE = uuid.UUID("6e16f5e0-17a5-4b4a-9b74-0f50c82d6158")

CATEGORIES = (
    "Sports",
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
    "Academic",
)

VENUE_LAYOUTS = (
    {"venue_name": "Muse Banquet Hall", "layout_name": "Theater", "seat_count": 200, "location": "Muse Banquet Hall"},
    {"venue_name": "Muse Banquet Hall", "layout_name": "Classroom", "seat_count": 175, "location": "Muse Banquet Hall"},
    {"venue_name": "Muse Banquet Hall", "layout_name": "Banquet", "seat_count": 150, "location": "Muse Banquet Hall"},
    {"venue_name": "Dedmon Center", "layout_name": "All Section", "seat_count": 3200, "location": "Dedmon Center"},
    {"venue_name": "Dedmon Center", "layout_name": "Graduation Style", "seat_count": 2500, "location": "Dedmon Center"},
)

EVENT_BLUEPRINTS = (
    {"title": "Campus Networking Night", "categories": ["Conference", "Academic"], "hours": 2, "prices": (10, 35, 75)},
    {"title": "Highlander Jazz Evening", "categories": ["Music", "Performance"], "hours": 3, "prices": (12, 30, 60)},
    {"title": "Alumni Basketball Classic", "categories": ["Sports", "Basketball"], "hours": 2, "prices": (15, 40, 80)},
    {"title": "Research Poster Forum", "categories": ["Academic", "Honors"], "hours": 2, "prices": (8, 20, 45)},
    {"title": "Leadership Speaker Series", "categories": ["Speech", "Conference"], "hours": 2, "prices": (10, 28, 55)},
    {"title": "Spring Theater Showcase", "categories": ["Performance", "Music"], "hours": 3, "prices": (14, 33, 66)},
    {"title": "Highlander Soccer Social", "categories": ["Sports", "Soccer"], "hours": 2, "prices": (10, 25, 50)},
    {"title": "Track and Field Awards", "categories": ["Track and Field", "Honors"], "hours": 2, "prices": (9, 24, 48)},
    {"title": "Women in Business Summit", "categories": ["Conference", "Academic"], "hours": 4, "prices": (20, 55, 110)},
    {"title": "Student Vocal Showcase", "categories": ["Music", "Performance"], "hours": 2, "prices": (7, 18, 36)},
    {"title": "Campus Golf Mixer", "categories": ["Golf", "Sports"], "hours": 3, "prices": (18, 42, 84)},
    {"title": "Lacrosse Alumni Reunion", "categories": ["Lacrosse", "Sports"], "hours": 2, "prices": (13, 34, 68)},
    {"title": "Softball Family Day", "categories": ["Softball", "Sports"], "hours": 3, "prices": (11, 26, 52)},
    {"title": "Volleyball Skills Clinic", "categories": ["Volleyball", "Sports"], "hours": 2, "prices": (10, 22, 44)},
    {"title": "Cross Country Kickoff", "categories": ["Cross Country", "Sports"], "hours": 2, "prices": (9, 21, 42)},
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Seed valid events into the Group-2 Create-Event API."
    )
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="API base URL without the Create-Event suffix.")
    parser.add_argument("--create-path", default=DEFAULT_CREATE_PATH, help="Create path under the API base.")
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="Number of events to create.")
    parser.add_argument(
        "--creator-id",
        default="",
        help="Optional fixed value for event_creator. Leave empty to rotate different UUID-style creator IDs.",
    )
    parser.add_argument(
        "--authorization",
        default="",
        help="Optional Authorization header value. Not required when sending event_creator explicitly.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print generated payloads instead of calling the API.",
    )
    parser.add_argument(
        "--pause-ms",
        type=int,
        default=200,
        help="Pause between API requests to avoid hammering downstream integrations.",
    )
    return parser.parse_args()


def normalize_base_url(url):
    return str(url).rstrip("/")


def build_create_url(api_base, create_path):
    return normalize_base_url(api_base) + "/" + str(create_path).lstrip("/")


def build_creator(index, creator_id):
    fixed_creator = str(creator_id).strip()
    if fixed_creator:
        return fixed_creator
    return str(uuid.uuid5(CREATOR_NAMESPACE, f"seed-creator-{index + 1}"))


def slugify(value):
    lowered = str(value).lower()
    collapsed = re.sub(r"[^a-z0-9]+", "-", lowered)
    return collapsed.strip("-") or "event"


def build_description(title, venue_name, layout_name, categories):
    category_list = ", ".join(categories)
    return (
        f"{title} test event generated for Create-Event API validation. "
        f"Venue: {venue_name} ({layout_name}). Categories: {category_list}."
    )


def month_slot(index):
    total_month = (SEED_START_MONTH - 1) + index
    year = SEED_START_YEAR + (total_month // 12)
    month = (total_month % 12) + 1
    return year, month


def build_start_time(index):
    eastern = ZoneInfo("America/New_York")
    year, month = month_slot(index)
    hour = 18 + (index % 3)
    return datetime(year, month, 15, hour, 0, 0, tzinfo=eastern)


def build_created_at(index):
    year, month = month_slot(index)
    return datetime(year, month, 1, 16, 36, 42, 3654).isoformat(timespec="microseconds")


def validate_payload(payload):
    required = ("event_name", "date_time", "end_date_time", "location", "venue_name", "layout_name")
    for field in required:
        if not payload.get(field):
            raise ValueError(f"{field} is required")

    seat_count = payload.get("seat_count")
    if seat_count is None or int(seat_count) <= 0:
        raise ValueError("seat_count must be a positive integer")

    categories = payload.get("categories")
    if not isinstance(categories, list) or not categories:
        raise ValueError("At least one category is required")
    invalid = [category for category in categories if category not in CATEGORIES]
    if invalid:
        raise ValueError(f"Invalid categories: {', '.join(invalid)}")

    budget_price = payload.get("budget_price")
    standard_price = payload.get("standard_price")
    vip_price = payload.get("vip_price")
    if budget_price is None or standard_price is None or vip_price is None:
        raise ValueError("All tier prices must be present")
    if not (budget_price < standard_price < vip_price):
        raise ValueError("budget_price must be less than standard_price, and standard_price must be less than vip_price")

    start = datetime.fromisoformat(payload["date_time"])
    end = datetime.fromisoformat(payload["end_date_time"])
    if end <= start:
        raise ValueError("end_date_time must be after date_time")

    created_at = payload.get("created_at")
    if created_at is not None:
        try:
            datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S.%f")
        except Exception:
            raise ValueError("created_at must be of format YYYY-MM-DDThh:mm:ss.ffffff")

    for field_name in ("images", "documents"):
        values = payload.get(field_name)
        if values is None:
            continue
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list) or not all(isinstance(value, str) and not value.startswith("data:") for value in values):
            raise ValueError(f"{field_name} must be a string or list of strings and cannot contain Base64 data")


def build_payload(index, creator_id):
    blueprint = EVENT_BLUEPRINTS[index % len(EVENT_BLUEPRINTS)]
    venue_layout = VENUE_LAYOUTS[index % len(VENUE_LAYOUTS)]
    start_time = build_start_time(index)
    end_time = start_time + timedelta(hours=blueprint["hours"])
    creator = build_creator(index, creator_id)
    asset_group = slugify(blueprint["title"] + "-" + start_time.strftime("%Y-%m"))
    budget_price, standard_price, vip_price = blueprint["prices"]

    payload = {
        "event_name": blueprint["title"] + " - " + start_time.strftime("%B %Y"),
        "created_at": build_created_at(index),
        "date_time": start_time.isoformat(timespec="seconds"),
        "end_date_time": end_time.isoformat(timespec="seconds"),
        "location": venue_layout["location"],
        "venue_name": venue_layout["venue_name"],
        "layout_name": venue_layout["layout_name"],
        "seat_count": venue_layout["seat_count"],
        "budget_price": budget_price,
        "standard_price": standard_price,
        "vip_price": vip_price,
        "description": build_description(
            blueprint["title"],
            venue_layout["venue_name"],
            venue_layout["layout_name"],
            blueprint["categories"],
        ),
        "categories": list(blueprint["categories"]),
        "images": [
            f"events/generated/{asset_group}/hero.jpg",
            f"events/generated/{asset_group}/gallery-1.jpg",
        ],
        "documents": [
            f"events/generated/{asset_group}/documents/info.pdf",
            f"events/generated/{asset_group}/documents/run-of-show.pdf",
        ],
        "event_creator": creator,
    }
    validate_payload(payload)
    return payload


def post_json(url, payload, authorization=""):
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if authorization:
        headers["Authorization"] = authorization

    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, safe_json_loads(body)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        return error.code, safe_json_loads(body)


def safe_json_loads(raw_text):
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return raw_text


def main():
    args = parse_args()
    if args.count < 1:
        print("count must be at least 1", file=sys.stderr)
        return 2
    if args.count > TOTAL_MONTH_SLOTS:
        print(f"count cannot exceed {TOTAL_MONTH_SLOTS} for the April 2025 through December 2027 range", file=sys.stderr)
        return 2

    create_url = build_create_url(args.api_base, args.create_path)
    payloads = [build_payload(index, args.creator_id) for index in range(args.count)]

    if args.dry_run:
        print(json.dumps(payloads, indent=2))
        return 0

    print(f"Posting {len(payloads)} event(s) to {create_url}")
    successes = []
    failures = []

    for index, payload in enumerate(payloads):
        status_code, response_data = post_json(create_url, payload, args.authorization)
        returned_event_id = response_data.get("event_id") if isinstance(response_data, dict) else None
        record = {
            "event_id": returned_event_id,
            "event_name": payload["event_name"],
            "status_code": status_code,
            "response": response_data,
        }

        if 200 <= status_code < 300:
            successes.append(record)
            created_label = returned_event_id or payload["event_name"]
            print(f"[{index + 1:02d}/{len(payloads):02d}] created {created_label} ({status_code})")
        else:
            failures.append(record)
            print(f"[{index + 1:02d}/{len(payloads):02d}] failed {payload['event_name']} ({status_code})")
            print(json.dumps(response_data, indent=2))

        if index < len(payloads) - 1 and args.pause_ms > 0:
            time.sleep(args.pause_ms / 1000.0)

    print()
    print(json.dumps({"successes": successes, "failures": failures}, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
