import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Tenant, User
from app.service_takers.models import ServiceTaker
from app.service_takers.router import update_client
from app.service_takers.schemas import ServiceTakerUpdate
from app.etsy.router import (
    SaveDraft, Transition, create_draft, save_draft, transition, workspace,
    upload_asset, download_asset, delete_asset, validate_data,
)


class EtsyWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.db.add_all([Tenant(id=1, slug="one", company_name="One"), Tenant(id=2, slug="two", company_name="Two")])
        self.db.flush()
        self.admin = self.make_user("admin", "admin", 1)
        self.friend = self.make_user("friend", "service_taker", 1)
        self.other = self.make_user("other", "service_taker", 1)
        self.outside = self.make_user("outside", "admin", 2)
        self.db.commit()
        self.content = {"createDraftListing": {"title": "Handmade wooden box", "description": "Wooden keepsake box", "quantity": 2,
            "price": 15, "who_made": "i_did", "when_made": "made_to_order", "taxonomy_id": 1, "type": "physical"}}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def make_user(self, username, role, tenant):
        user = User(name=username, username=username, tenant_id=tenant, pin="test", role=role,
                    is_active=True, allowed_pages=json.dumps(["Service Dashboard", "Service Etsy Listings"]))
        self.db.add(user)
        self.db.flush()
        if role == "service_taker":
            self.db.add(ServiceTaker(user_id=user.id, tenant_id=tenant, company_name=username, contact_name=username, is_active=True))
        return user

    def request(self, user):
        return SimpleNamespace(state=SimpleNamespace(user_id=user.id, tenant_id=user.tenant_id))

    def create(self):
        return create_draft(SaveDraft(data=self.content), self.request(self.friend), self.db)

    def assert_status(self, code, function, *args, **kwargs):
        with self.assertRaises(HTTPException) as caught:
            function(*args, **kwargs)
        self.assertEqual(code, caught.exception.status_code)

    def test_friend_submits_admin_reviews_and_approved_draft_is_locked(self):
        draft = self.create()
        submitted = transition(draft["id"], Transition(revision=draft["revision"], action="submit"), self.request(self.friend), self.db)
        self.assertEqual(submitted["status"], "In review")
        self.assert_status(403, transition, draft["id"], Transition(revision=submitted["revision"], action="approve"), self.request(self.friend), self.db)
        approved = transition(draft["id"], Transition(revision=submitted["revision"], action="approve"), self.request(self.admin), self.db)
        self.assert_status(409, save_draft, draft["id"], SaveDraft(revision=approved["revision"], data=self.content), self.request(self.friend), self.db)
        self.assert_status(503, transition, draft["id"], Transition(revision=approved["revision"], action="publish"), self.request(self.admin), self.db)
        returned = transition(draft["id"], Transition(revision=approved["revision"], action="return", note="Improve the description"), self.request(self.admin), self.db)
        self.assertEqual(returned["status"], "Changes requested")
        saved = save_draft(draft["id"], SaveDraft(revision=returned["revision"], data=self.content), self.request(self.friend), self.db)
        self.assertGreater(saved["revision"], returned["revision"])

    def test_manual_listing_can_be_approved_without_api_references(self):
        self.content = {"createDraftListing": {"title": "Wooden box", "description": "Handmade box", "price": 20, "quantity": 1},
                        "manualListing": {"category": "Home / Storage", "currency": "GBP", "shipping_instructions": "Royal Mail"}}
        draft = self.create()
        self.assertEqual(draft["issues"], [])
        submitted = transition(draft["id"], Transition(revision=draft["revision"], action="submit"), self.request(self.friend), self.db)
        approved = transition(draft["id"], Transition(revision=submitted["revision"], action="approve"), self.request(self.admin), self.db)
        self.assertEqual(approved["status"], "Approved")
        self.assertEqual(approved["data"]["manualListing"]["currency"], "GBP")
        self.assertFalse(workspace(self.request(self.admin), self.db)["connection"]["connected"])
        self.assertTrue(validate_data({"createDraftListing": {"title": "  ", "price": 0, "quantity": 1}}, True))

    def test_other_users_and_tenants_cannot_read_or_edit_drafts(self):
        draft = self.create()
        for user in [self.other, self.outside]:
            self.assertEqual(workspace(self.request(user), self.db)["drafts"], [])
            self.assert_status(404, save_draft, draft["id"], SaveDraft(revision=draft["revision"], data=self.content), self.request(user), self.db)
        self.assertEqual(len(workspace(self.request(self.admin), self.db)["drafts"]), 1)

    def test_switch_revokes_access_immediately_and_can_be_restored(self):
        self.create()
        client = self.db.query(ServiceTaker).filter_by(user_id=self.friend.id).one()
        update_client(client.id, ServiceTakerUpdate(etsy_listing_enabled=False), self.request(self.admin), self.db)
        self.assert_status(403, workspace, self.request(self.friend), self.db)
        update_client(client.id, ServiceTakerUpdate(etsy_listing_enabled=True), self.request(self.admin), self.db)
        self.assertEqual(len(workspace(self.request(self.friend), self.db)["drafts"]), 1)

    def test_stale_revision_cannot_overwrite_saved_content(self):
        draft = self.create()
        save_draft(draft["id"], SaveDraft(revision=draft["revision"], data=self.content), self.request(self.friend), self.db)
        self.assert_status(409, save_draft, draft["id"], SaveDraft(revision=draft["revision"], data=self.content), self.request(self.friend), self.db)

    def test_media_is_private_and_revocation_applies_to_downloads(self):
        draft = self.create()
        image = io.BytesIO()
        Image.new("RGB", (40, 40), "green").save(image, format="PNG")
        image.seek(0)
        with tempfile.TemporaryDirectory() as directory, patch("app.etsy.router.PRIVATE_DIR", Path(directory)):
            updated = upload_asset(draft["id"], self.request(self.friend), "image", draft["revision"], UploadFile(filename="sample.png", file=image), self.db)
            asset = updated["assets"][0]
            self.assertEqual(updated["data"]["uploadListingImage"]["entries"][0]["asset_id"], asset["id"])
            self.assert_status(404, download_asset, draft["id"], asset["id"], self.request(self.other), self.db)
            self.assertTrue(Path(download_asset(draft["id"], asset["id"], self.request(self.admin), self.db).path).is_file())
            self.friend.allowed_pages = "[]"
            self.db.commit()
            self.assert_status(403, download_asset, draft["id"], asset["id"], self.request(self.friend), self.db)
            deleted = delete_asset(draft["id"], asset["id"], updated["revision"], self.request(self.admin), self.db)
            self.assertEqual(deleted["assets"], [])
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_invalid_payloads_and_publish_state_are_rejected(self):
        for data in [{"unexpected": {}}, {"createDraftListing": "bad"}, {"createDraftListing": {"tags": 123}},
                     {"updateListing": {"state": "active"}}, {"createDraftListing": {"quantity": 1.5}}]:
            with self.subTest(data=data):
                self.assertTrue(validate_data(data))
        self.assertEqual(validate_data(self.content, True), [])
        self.assertEqual(validate_data({"createDraftListing": {"title": None}, "updateListing": None}), [])
        self.assertTrue(validate_data({}, True))

    def test_disallowed_role_cannot_enter_workspace(self):
        worker = self.make_user("worker", "worker", 1)
        self.db.commit()
        self.assert_status(403, workspace, self.request(worker), self.db)


if __name__ == "__main__":
    unittest.main()
