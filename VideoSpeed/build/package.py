"""Package an already-built VideoSpeed extension using Python's standard library."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import re

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / 'extension'
DIST = ROOT / 'dist'
manifest = json.loads((EXTENSION / 'manifest.json').read_text(encoding='utf-8'))
package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
assert manifest['name'] == manifest['action']['default_title'] == 'VideoSpeed'
assert manifest['version'] == package['version']
for relative in ['src/content.js', 'src/page-bridge.js', 'src/background.js']:
    match = re.search(r"\b(?:VERSION|version)=['\"]([\d.]+)['\"]", (ROOT / relative).read_text(encoding='utf-8'))
    assert match and match[1] == manifest['version'], relative

runtime = sorted(path for path in EXTENSION.rglob('*') if path.is_file())
allowed = {
    'manifest.json', 'background.js', 'content.js', 'page-bridge.js',
    'popup.html', 'popup.js', 'popup.css', 'settings.js',
    'site-domain.js', 'site-rules.js', 'quality-options.js', 'i18n.js', 'locale-zh.js',
    'LICENSE', 'THIRD_PARTY_LICENSES.txt',
    *('icons/' + name + '.png' for name in ['16', '32', '48', '128', 'off-16', 'off-32', 'off-48', 'off-128']),
    '_locales/en/messages.json', '_locales/zh_TW/messages.json',
}
assert {path.relative_to(EXTENSION).as_posix() for path in runtime} == allowed
assert not any(path.is_symlink() for path in runtime)

background = manifest['background']
assert 'type' not in background, 'Background service worker must use the classic-script default'
worker_output = EXTENSION / background['service_worker']
worker_source = worker_output.read_text(encoding='utf-8')
assert not re.search(r'(?m)^\s*(?:import\b|export\b)|\bimport\s*\(', worker_source), \
    'Background service worker output must be bundled without module imports or exports'

referenced_files = [background['service_worker'], manifest['action']['default_popup']]
for icon_map in [manifest.get('icons', {}), manifest.get('action', {}).get('default_icon', {})]:
    if isinstance(icon_map, str):
        referenced_files.append(icon_map)
    elif isinstance(icon_map, dict):
        referenced_files.extend(icon_map.values())
for script in manifest.get('content_scripts', []):
    for kind in ['js', 'css']:
        referenced_files.extend(script.get(kind, []))
for key in ['options_page', 'devtools_page']:
    if manifest.get(key):
        referenced_files.append(manifest[key])
for key in ['options_ui', 'side_panel']:
    if manifest.get(key, {}).get('page' if key == 'options_ui' else 'default_path'):
        referenced_files.append(manifest[key]['page' if key == 'options_ui' else 'default_path'])
referenced_files.extend(manifest.get('chrome_url_overrides', {}).values())
assert all((EXTENSION / filename).is_file() for filename in referenced_files), \
    f'Manifest references a missing runtime file: {[name for name in referenced_files if not (EXTENSION / name).is_file()]}'


def archive(filename, entries):
    """Fixed metadata keeps identical inputs reproducible across machines."""
    path = DIST / filename
    with ZipFile(path, 'w', compression=ZIP_DEFLATED, compresslevel=9) as output:
        for source, name in sorted(entries, key=lambda item: item[1]):
            info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            output.writestr(info, source.read_bytes(), compresslevel=9)
    return path


DIST.mkdir(exist_ok=True)
install = archive('VideoSpeed.zip', [(path, 'VideoSpeed/' + path.relative_to(EXTENSION).as_posix()) for path in runtime])
store = archive('VideoSpeed-chrome-web-store.zip', [(path, path.relative_to(EXTENSION).as_posix()) for path in runtime])
source = [path for folder in ['src', 'extension', 'tests', 'build', 'docs'] for path in (ROOT / folder).rglob('*') if path.is_file()]
source += [ROOT / name for name in ['README.md', 'LICENSE', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes']]
source_zip = archive('VideoSpeed-source.zip', [(path, 'VideoSpeed/' + path.relative_to(ROOT).as_posix()) for path in source])
with ZipFile(install) as check:
    assert len(check.namelist()) == len(runtime) and 'VideoSpeed/manifest.json' in check.namelist()
with ZipFile(store) as check:
    assert 'manifest.json' in check.namelist() and all(not name.startswith('VideoSpeed/') for name in check.namelist())
hashes = {path.name: {'bytes': path.stat().st_size, 'sha256': sha256(path.read_bytes()).hexdigest()} for path in [install, store, source_zip]}
(DIST / 'SHA256SUMS.txt').write_text(''.join(value['sha256'] + '  ' + name + '\n' for name, value in sorted(hashes.items())), encoding='utf-8')
info = {'name': manifest['name'], 'version': manifest['version'], 'runtimeFiles': len(runtime), 'archives': hashes,
        'releaseAssets': [install.name, source_zip.name]}
(DIST / 'package-info.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
print(json.dumps(info, indent=2))
