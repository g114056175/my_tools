"""Export the current curated review into the standalone source package.

Optional developer tool; does not run during application startup or building.
Usage: python tools/export-review.py --review-root PATH
"""
import argparse, hashlib, json, os, re, shutil
from pathlib import Path
from release_docs import prepare_docs, write_manifest

project=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--review-root',type=Path,required=True)
args=parser.parse_args();review=args.review_root.resolve()
target=project/'docs/comparison';target.mkdir(parents=True,exist_ok=True)
build=json.loads((project/'dist/build-info.json').read_text(encoding='utf-8-sig'))
assert hashlib.sha256((project/'dist/BlueArchiveCursor.exe').read_bytes()).hexdigest()==build['exeSha256']
verification=json.loads((review/'analysis/04_verification/verification.json').read_text(encoding='utf-8-sig'))
assert verification['build']['sha256']==build['exeSha256'], 'Review was captured from another release'
link=re.compile(r'(!?\[[^\]]*\])\(([^)]+)\)')
queue=[review/'comparison.md',review/'00_README.md',review/'analysis/00_README.md']
copied=set()
while queue:
    source=queue.pop(0)
    if source in copied:continue
    relative=source.relative_to(review)
    if relative.parts[0] in ('archive','source'):continue
    assert source.is_file(),source
    destination=target/relative;destination.parent.mkdir(parents=True,exist_ok=True)
    if source.suffix=='.md':
        text=source.read_text(encoding='utf-8-sig')
        def rewrite(match):
            label,url=match.groups()
            if re.match(r'https?://|#',url):return match.group(0)
            url=url.strip('<>');file,_,anchor=url.partition('#');resolved=(source.parent/file).resolve()
            if resolved.is_relative_to(review):
                rel=resolved.relative_to(review)
                if rel.parts[0]=='archive':return label.strip('[]')+'（保留在本機研究工作區）'
                assert resolved.is_file(),(source,url)
                queue.append(resolved);dest=target/rel
            elif resolved.is_relative_to(project):
                assert resolved.is_file(),(source,url)
                dest=resolved
            else:raise ValueError('Nonportable review link: '+str(resolved))
            return label+'('+Path(os.path.relpath(dest,destination.parent)).as_posix()+('#'+anchor if anchor else '')+')'
        text=link.sub(rewrite,text)
        destination.write_text(text,encoding='utf8')
    else:shutil.copy2(source,destination)
    copied.add(source)
for name in ['verification.json','artifact-validation.json','build-info.json','palette-hierarchy.json','release-smoke.json','test.json','click-wave.json','performance.json','preview-info.json','birth-flash.json','layering.json','ring-shape.json','motion.json']:
    source=review/'analysis/04_verification'/name
    if source.is_file():shutil.copy2(source,target/'analysis/04_verification'/name);copied.add(source)
prepare_docs(project,build)
manifest=write_manifest(project,build)
print(json.dumps({'files':len(manifest['files']),'bytes':sum(f['bytes'] for f in manifest['files']),'sha256':build['exeSha256']},indent=2))
