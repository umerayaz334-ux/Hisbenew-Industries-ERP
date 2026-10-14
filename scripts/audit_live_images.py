"""Read-only database image audit plus a temporary upload/delivery smoke test."""
import io
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
from urllib.parse import unquote, urlsplit
from collections import Counter

backend=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(backend))
os.environ['SKIP_DATABASE_INITIALIZATION']='1'
from app.config import UPLOAD_DIR
from app.database import engine
from sqlalchemy import inspect, MetaData, Table, select, String, Text
from PIL import Image

references=set()
with engine.connect() as connection:
    for name in inspect(engine).get_table_names():
        table=Table(name,MetaData(),autoload_with=connection)
        for column in table.columns:
            if not isinstance(column.type,(String,Text)): continue
            for value in connection.execute(select(column).where(column.like('%/static/uploads/%'))).scalars():
                for match in re.finditer(r'/static/uploads/([^\s"<>?]+)',str(value)):
                    relative=unquote(match.group(1)).rstrip("',}]")
                    if Path(relative).suffix.lower() in {'.png','.jpg','.jpeg','.webp','.gif','.bmp'}:
                        references.add(relative)
missing=[]; damaged=[]
root=Path(UPLOAD_DIR).resolve()
for relative in sorted(references):
    path=(root/relative).resolve()
    if not path.is_relative_to(root) or not path.is_file(): missing.append(relative); continue
    try:
        with Image.open(path) as image: image.verify()
    except Exception: damaged.append(relative)
print(json.dumps({'upload_dir':str(root),'referenced_images':len(references),'missing':missing,'damaged':damaged}))

from fastapi import UploadFile
from app.main import save_uploaded_file
image=io.BytesIO(); Image.new('RGB',(32,24),'blue').save(image,format='PNG'); image.seek(0)
url=save_uploaded_file(UploadFile(filename='deployment-image-check.png',file=image))
probe=root/Path(url).name
try:
    for origin in ('http://127.0.0.1:8000','https://api.hisbenew.com'):
        response=urllib.request.urlopen(origin+url+'?w=20',timeout=30)
        content=response.read()
        with Image.open(io.BytesIO(content)) as decoded:
            decoded.load()
            assert decoded.size==(20,15), decoded.size
        print('New upload delivery passed:',origin,response.status,response.headers.get('Content-Type'))
finally:
    probe.unlink(missing_ok=True)
