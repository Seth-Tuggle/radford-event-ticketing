import builtins
import importlib.util
import json
import os
import re
from pathlib import Path
from unittest.mock import patch


os.environ["LOCAL"] = "true"

MODULE_PATH = Path(__file__).resolve().parent / "LambdaCode" / "Create-Event.py"
SPEC = importlib.util.spec_from_file_location("create_event_lambda", MODULE_PATH)
create_event_lambda = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(create_event_lambda)


def build_event_body(categories=None, created_at=None, event_creator=None):
    body = {
        "event_name": "Creation test",
        "date_time": "2026-10-18T19:39:40+00:00",
        "end_date_time": "2026-10-18T21:39:40+00:00",
        "location": "Test",
        "venue_name": "Muse Banquet Hall",
        "layout_name": "Theater",
        "seat_count": 86,
    }
    if categories is not None:
        body["categories"] = categories
    if created_at is not None:
        body["created_at"] = created_at
    if event_creator is not None:
        body["event_creator"] = event_creator
    return {"body": json.dumps(body)}


def test_create_event_accepts_one_category():
    response = create_event_lambda.lambda_handler(build_event_body(["Music"]), None)
    assert response["statusCode"] == 201
    assert json.loads(response["body"])["message"] == "Input accepted, aborting before attempting network access"


def test_create_event_sets_created_at_and_event_creator():
    printed = []

    def fake_print(*args, **kwargs):
        printed.append(args)

    body = build_event_body(
        ["Music"],
        created_at="2026-04-11T16:36:42.003654",
        event_creator="11111111-1111-4111-8111-111111111111",
    )
    with patch.object(builtins, "print", side_effect=fake_print):
        response = create_event_lambda.lambda_handler(body, None)

    assert response["statusCode"] == 201
    item = printed[-1][0]
    assert item["created_at"] == "2026-04-11T16:36:42.003654"
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$", item["created_at"])
    assert item["event_creator"] == "11111111-1111-4111-8111-111111111111"


def test_create_event_rejects_missing_categories():
    response = create_event_lambda.lambda_handler(build_event_body(), None)
    body = json.loads(response["body"])
    assert response["statusCode"] == 400
    assert body["error"] == "At least one category is required"


def test_create_event_rejects_empty_categories():
    response = create_event_lambda.lambda_handler(build_event_body([]), None)
    body = json.loads(response["body"])
    assert response["statusCode"] == 400
    assert body["error"] == "At least one category is required"


def test_create_event_rejects_unsupported_categories():
    response = create_event_lambda.lambda_handler(build_event_body(["Not A Real Category"]), None)
    body = json.loads(response["body"])
    assert response["statusCode"] == 400
    assert body["error"] == "At least one valid category is required"
