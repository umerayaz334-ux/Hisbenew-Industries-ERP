import io
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from PIL import Image
from fastapi import HTTPException, UploadFile
from unittest.mock import patch
from app.services.image_delivery import serve_upload

class ImageDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'uploads'
        self.root.mkdir()
        self.cache = Path(self.temp.name) / 'cache'
        self.request = SimpleNamespace(headers={})
    def tearDown(self): self.temp.cleanup()
    def test_concurrent_resizing_and_etag(self):
        Image.new('RGB', (600,300), 'red').save(self.root / 'sample.png')
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _: serve_upload(self.root,self.cache,'sample.png',self.request,100), range(16)))
        for result in results:
            with Image.open(result.path) as image:
                self.assertEqual(image.size,(100,50)); image.load()
        request=SimpleNamespace(headers={'if-none-match': results[0].headers['etag']})
        self.assertEqual(serve_upload(self.root,self.cache,'sample.png',request,100).status_code,304)
    def test_same_stem_different_extension_and_traversal(self):
        for name in ('same.png','same.jpg'): Image.new('RGB',(20,20)).save(self.root/name)
        a=serve_upload(self.root,self.cache,'same.png',self.request)
        b=serve_upload(self.root,self.cache,'same.jpg',self.request)
        self.assertNotEqual(a.path,b.path)
        for name in ('../outside.png','missing.png'):
            with self.assertRaises(HTTPException) as error: serve_upload(self.root,self.cache,name,self.request)
            self.assertEqual(error.exception.status_code,404)
    def test_new_upload_served_and_invalid_upload_rejected(self):
        from app import main
        data=io.BytesIO(); Image.new('RGB',(30,20)).save(data,format='PNG'); data.seek(0)
        with patch.object(main,'UPLOAD_DIR',self.root):
            url=main.save_uploaded_file(UploadFile(filename='new.png',file=data))
            result=serve_upload(self.root,self.cache,url.rsplit('/',1)[1],self.request,20)
            with Image.open(result.path) as image: self.assertEqual(image.size,(20,13))
            with self.assertRaises(HTTPException): main.save_uploaded_file(UploadFile(filename='bad.png',file=io.BytesIO(b'broken')))
        self.assertEqual(len(list(self.root.iterdir())),1)
    def test_recovery_preserves_existing(self):
        import importlib.util, zipfile
        script=Path(__file__).resolve().parents[2]/'scripts/restore_missing_images.py'
        spec=importlib.util.spec_from_file_location('restore_images',script); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        data=io.BytesIO(); Image.new('RGB',(20,20)).save(data,format='PNG')
        archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('new.png',data.getvalue()); z.writestr('existing.png',data.getvalue())
        (self.root/'existing.png').write_bytes(b'keep original')
        self.assertEqual(mod.restore_images(archive.getvalue(),self.root),{'restored':1,'existing_preserved':1})
        self.assertEqual((self.root/'existing.png').read_bytes(),b'keep original')

    def test_service_and_school_reject_damaged_images(self):
        import asyncio
        import importlib
        service = importlib.import_module("app.service_takers.router")
        from app.school import admissions
        with patch.object(service, 'UPLOAD_DIR', self.root):
            for save in (service.save_product_image, service.save_payment_proof):
                with self.assertRaises(HTTPException):
                    save(UploadFile(filename='bad.jpg',file=io.BytesIO(b'not an image')))
        with patch.object(admissions, 'STUDENT_UPLOAD_DIR', self.root):
            with self.assertRaises(HTTPException):
                asyncio.run(admissions.save_school_file(UploadFile(filename='bad.jpg',file=io.BytesIO(b'not an image'))))
        self.assertEqual(list(self.root.iterdir()), [])
