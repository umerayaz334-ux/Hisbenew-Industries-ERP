"""Cross-tenant Muse audit using the real HTTP middleware and get_db dependency."""
from contextlib import contextmanager
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app import main
from app.models import (Product, Customer, User, Tenant, Order, OrderItem, StockMovement,
                        MuseSubmission, AccountingTransaction, AccountingAccount,
                        AccountingJournalEntry, AccountingJournalLine)
from app.muse_api import rotate_key, process_queue
from tests import test_muse_api as muse_tests


class MuseTenantAudit(unittest.TestCase):
    tearDown = muse_tests.MuseTests.tearDown
    order = muse_tests.MuseTests.order
    process = muse_tests.MuseTests.process
    def setUp(self):
        muse_tests.MuseTests.setUp(self)
        self.keys = {}
        self.users = {}
        for tenant_id in (1, 2):
            with Session(self.engine) as db:
                db.info['tenant_id'] = tenant_id
                user = User(name=f'Admin {tenant_id}', role='admin', tenant_id=tenant_id)
                db.add(user)
                db.commit()
                self.users[tenant_id] = user.id
                self.keys[tenant_id] = rotate_key(db, user, tenant_id)['api_key']

    @contextmanager
    def client(self):
        with patch.object(main, 'SessionLocal', lambda: Session(self.engine)), patch.object(main.muse_queue_service, 'notify'):
            yield TestClient(main.app)

    def headers(self, tenant):
        return {'Authorization': f'Bearer {self.keys[tenant]}', 'X-ERP-Tenant-Id': str(3 - tenant)}

    def post_order(self, client, tenant, number, sku, **extra):
        body = self.order(order_no=number, items=[dict(article_no=sku, quantity=2, unit_price_usd=50)], **extra).model_dump(mode='json')
        response = client.post('/integrations/muse/orders', headers=self.headers(tenant), json=body)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()['id']

    def test_two_tenants_full_http_queue_and_accounting(self):
        with self.client() as client:
            for tenant in (1, 2):
                response = client.post('/integrations/muse/products', headers=self.headers(tenant), json={
                    'article_no': f'T{tenant}', 'name': f'Product {tenant}', 'unit_price_usd': 50,
                    'image_url': f'https://example.com/{tenant}.jpg'})
                self.assertEqual(response.status_code, 200, response.text)
                self.post_order(client, tenant, f'ORDER-{tenant}', f'T{tenant}')
            self.process()
            for tenant in (1, 2):
                headers = self.headers(tenant)
                products = client.get('/integrations/muse/products?tenant_id=999', headers=headers).json()
                self.assertIn(f'T{tenant}', [p['article_no'] for p in products])
                self.assertNotIn(f'T{3-tenant}', [p['article_no'] for p in products])
                submissions = client.get('/integrations/muse/submissions', headers=headers).json()
                self.assertEqual([(r['order_no'], r['status']) for r in submissions], [(f'ORDER-{tenant}', 'Applied')])
                pending = client.get('/integrations/muse/pending-payouts', headers=headers).json()
                self.assertEqual([r['order_no'] for r in pending], [f'ORDER-{tenant}'])
                result = client.post('/integrations/muse/payouts', headers=headers, json={
                    'order_no': f'ORDER-{tenant}', 'actual_paid_usd': 80, 'paid_at': '2026-10-11T08:00:00Z'})
                self.assertEqual(result.status_code, 202)
            self.process()
        with Session(self.engine) as db:
            for tenant in (1, 2):
                order = db.query(Order).filter_by(tenant_id=tenant).one()
                self.assertEqual(order.payout_status, 'Received')
                self.assertEqual(db.get(Customer, order.customer_id).tenant_id, tenant)
                item = db.query(OrderItem).filter_by(order_id=order.id).one()
                self.assertEqual(item.tenant_id, tenant)
                self.assertEqual(db.get(Product, item.product_id).tenant_id, tenant)
                self.assertEqual(db.get(Product, item.product_id).reserved_stock, 2)
                for model in (StockMovement, AccountingTransaction, AccountingAccount, AccountingJournalEntry, AccountingJournalLine):
                    rows = db.query(model).filter_by(tenant_id=tenant).all()
                    self.assertTrue(rows, model.__name__)
                transaction = db.query(AccountingTransaction).filter_by(tenant_id=tenant).one()
                self.assertEqual(transaction.source_id, order.id)
                self.assertEqual(db.get(AccountingAccount, transaction.account_id).tenant_id, tenant)
            self.assertEqual(db.query(Customer).count(), 2)  # Same name and phone, separate customers.
            for model in (Product, Customer, Order, OrderItem, StockMovement, AccountingTransaction):
                self.assertEqual(db.query(model).filter(model.tenant_id.is_(None)).count(), 0)

    def test_cross_tenant_references_and_payload_injection(self):
        with Session(self.engine) as db:
            db.info['tenant_id'] = 2
            customer = Customer(name='Private', phone='999')
            db.add_all([customer, Product(article_no='PRIVATE-SKU', name='Private', factory_stock=20)])
            db.commit()
            customer_id = customer.id
        with self.client() as client:
            foreign_sku = self.post_order(client, 1, 'BAD-SKU', 'PRIVATE-SKU')
            foreign_customer = self.post_order(client, 1, 'BAD-CUSTOMER', 'SKU-1', customer_id=customer_id)
            self.post_order(client, 2, 'PRIVATE-ORDER', 'PRIVATE-SKU')
            self.process()
            response = client.post('/integrations/muse/payouts', headers=self.headers(1), json={
                'order_no': 'PRIVATE-ORDER', 'actual_paid_usd': 80, 'paid_at': '2026-10-11T08:00:00Z'})
            payout_id = response.json()['id']
            collision = self.post_order(client, 1, 'PRIVATE-ORDER', 'SKU-1')
            self.process()
            bodies = {'products': {'article_no': 'INJECT', 'name': 'Test', 'unit_price_usd': 1},
                      'orders': self.order().model_dump(mode='json'),
                      'payouts': {'order_no': 'PRIVATE-ORDER', 'actual_paid_usd': 80, 'paid_at': '2026-10-11T08:00:00Z'}}
            for route, body in bodies.items():
                self.assertEqual(client.post('/integrations/muse/' + route, headers=self.headers(1), json={**body, 'tenant_id': 2}).status_code, 422)
            for route in ('/products', '/orders', '/customers', '/muse-settings', '/muse-settings/retry/1', '/muse-settings/key'):
                response = client.post(route, headers=self.headers(1), json={}) if 'retry' in route or route.endswith('/key') else client.get(route, headers=self.headers(1))
                self.assertEqual(response.status_code, 401, route)
        with Session(self.engine) as db:
            for submission_id in (foreign_sku, foreign_customer, payout_id, collision):
                self.assertEqual(db.get(MuseSubmission, submission_id).status, 'Failed')
            self.assertEqual(db.query(Order).count(), 1)
            self.assertNotEqual(db.query(Order).one().payout_status, 'Received')
            self.assertEqual(db.query(AccountingTransaction).count(), 0)
            self.assertEqual(db.query(Product).filter_by(article_no='SKU-1').one().reserved_stock, 0)
            self.assertEqual(db.query(Customer).filter_by(tenant_id=1).count(), 0)

    def test_rotation_and_disabled_identity_isolation(self):
        with Session(self.engine) as db:
            db.info['tenant_id'] = 1
            rotate_key(db, db.get(User, self.users[1]), 1)
        with self.client() as client:
            self.assertEqual(client.get('/integrations/muse/products', headers=self.headers(1)).status_code, 401)
            self.assertEqual(client.get('/integrations/muse/products', headers=self.headers(2)).status_code, 200)
            for field, value in (('is_active', False), ('role', 'worker'), ('tenant_id', 1)):
                with Session(self.engine) as db:
                    user = db.get(User, self.users[2])
                    original = getattr(user, field)
                    setattr(user, field, value)
                    db.commit()
                self.assertEqual(client.get('/integrations/muse/products', headers=self.headers(2)).status_code, 403)
                with Session(self.engine) as db:
                    setattr(db.get(User, self.users[2]), field, original)
                    db.commit()
            with Session(self.engine) as db:
                db.get(Tenant, 2).status = 'inactive'
                db.commit()
            self.assertEqual(client.get('/integrations/muse/products', headers=self.headers(2)).status_code, 403)

    def test_settings_retry_and_key_creation_cannot_switch_tenant(self):
        from app.security import create_access_token
        with self.client() as client:
            failed_id = self.post_order(client, 2, 'FAIL-OTHER', 'MISSING')
            self.process()
            headers = {'Authorization': f'Bearer {create_access_token(self.users[1])}', 'X-ERP-Tenant-Id': '2'}
            response = client.get('/muse-settings', headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['submissions'], [])
            response = client.post(f'/muse-settings/retry/{failed_id}', headers=headers)
            self.assertEqual(response.status_code, 409, response.text)
            response = client.post('/muse-settings/key', headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(client.get('/integrations/muse/products', headers=self.headers(2)).status_code, 200)
            new_headers = {'Authorization': 'Bearer ' + response.json()['api_key']}
            self.assertEqual([p['article_no'] for p in client.get('/integrations/muse/products', headers=new_headers).json()], ['SKU-1'])
        with Session(self.engine) as db:
            self.assertEqual(db.get(MuseSubmission, failed_id).status, 'Failed')

    def test_super_admin_key_still_scoped_and_inactive_queue_blocked(self):
        with Session(self.engine) as db:
            user = db.get(User, self.users[1])
            user.role = 'super_admin'
            db.commit()
        with self.client() as client:
            response = client.post('/integrations/muse/products', headers=self.headers(1), json={
                'article_no': 'SUPER-SKU', 'name': 'Scoped', 'unit_price_usd': 5})
            self.assertEqual(response.status_code, 200)
            submission_id = self.post_order(client, 1, 'DISABLED-ORDER', 'SKU-1')
            with Session(self.engine) as db:
                self.assertEqual(db.get(Product, response.json()['id']).tenant_id, 1)
                db.get(Tenant, 1).status = 'inactive'
                db.commit()
            self.process()
        with Session(self.engine) as db:
            self.assertEqual(db.get(MuseSubmission, submission_id).status, 'Failed')
            self.assertEqual(db.query(Order).count(), 0)
            self.assertEqual(db.query(Customer).count(), 0)
