import os
root = os.getcwd()
skip = {'.git','.pytest_cache','.tmp','tmp','node_modules','__pycache__','.venv','venv'}
maxdepth = 4
max_entries = 20

def dump(path, indent, depth):
    if depth < 0:
        return
    try:
        entries = sorted(os.listdir(path), key=lambda s: s.lower())
    except Exception:
        return
    dirs = []
    files = []
    for name in entries:
        if name in skip:
            continue
        full = os.path.join(path, name)
        if os.path.isdir(full):
            dirs.append(name)
        else:
            files.append(name)
    for name in dirs:
        print(f"{indent}{name}/")
        dump(os.path.join(path, name), indent + '  ', depth-1)
    for name in files[:max_entries]:
        print(f"{indent}{name}")
    if len(files) > max_entries:
        print(f"{indent}... {len(files)-max_entries} more files")

print(os.path.basename(root) + '/')
dump(root, '  ', maxdepth)
