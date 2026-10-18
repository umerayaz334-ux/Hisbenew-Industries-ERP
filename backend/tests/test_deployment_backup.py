import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_backend', Path(__file__).resolve().parents[2] / 'scripts' / 'backup_backend.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeploymentBackupTests(unittest.TestCase):
    def test_snapshot_preserves_database_and_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backend'
            (root / 'app').mkdir(parents=True)
            (root / 'app' / 'main.py').write_text('original source')
            with closing(sqlite3.connect(root / 'data.db')) as db:
                db.execute('create table jobs (id integer)')
                db.execute('insert into jobs values (3)')
                db.commit()
            with patch.dict('os.environ', {'DATABASE_URL': '', 'APP_DATA_DIR': str(root)}):
                snapshot = module.backup(root)
            with closing(sqlite3.connect(snapshot / '0-data.db')) as db:
                self.assertEqual(db.execute('select id from jobs').fetchall(), [(3,)])
            self.assertEqual((snapshot / 'app' / 'main.py').read_text(), 'original source')

    def test_missing_database_blocks_deployment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backend'
            (root / 'app').mkdir(parents=True)
            with patch.dict('os.environ', {'DATABASE_URL': '', 'APP_DATA_DIR': str(root)}):
                with self.assertRaisesRegex(RuntimeError, 'No database found'):
                    module.backup(root)
