from fastapi.testclient import TestClient

from api.main import app


def test_local_dashboard_is_served():
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Job Intelligence Platform" in response.text
    assert "Visa Status" in response.text
    assert "CareerBuilder" in response.text
    assert "blocked/experimental" in response.text
    assert "Remotely.jobs" in response.text
    assert "We Work Remotely" in response.text


def test_static_assets_are_served():
    client = TestClient(app)

    response = client.get("/static/app.js")

    assert response.status_code == 200
    assert "loadData" in response.text


def test_refresh_endpoint_is_registered():
    paths = {route.path for route in app.routes}

    assert "/refresh" in paths
