"""Select web/client jobs; documentation and release metadata never publish products."""
import json
import os
from pathlib import Path
import subprocess


def classify(files, release_bump=False):
    if release_bump:
        return False, False
    def relevant(name):
        return not (name.startswith(('docs/', '.devcontainer/')) or name.lower().endswith('.md') or
                    Path(name).name.startswith(('LICENSE', 'COPYING', 'NOTICE')))
    product = [name for name in files if relevant(name)]
    web = any(not name.startswith('apps/client/') and name not in (
        '.github/workflows/android.yml', '.github/workflows/client-quality.yml',
        'scripts/pipeline-changes.py', 'scripts/test_pipeline_changes.py',
    ) for name in product)
    android = web or any(name.startswith('apps/client/') or name in (
        '.github/workflows/android.yml', '.github/workflows/client-quality.yml',
    ) for name in product)
    return web, android


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
        web = android = True
    else:
        sha = os.environ['GITHUB_SHA']
        before = event.get('before') or event['pull_request']['base']['sha']
        files = subprocess.check_output(['git', 'diff', '--name-only', '-z', before, sha]).decode().split('\0')
        message = subprocess.check_output(['git', 'log', '-1', '--format=%B', sha]).decode()
        # Only the known bot-created version/lock commit is suppressible.
        metadata = {'apps/client/' + name for name in ('package.json', 'package-lock.json',
                    'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'frontend.lock.json')}
        author = subprocess.check_output(['git', 'log', '-1', '--format=%ae', sha]).decode().strip()
        bump = ('openwebui-release-run:' in message and author.endswith('[bot]@users.noreply.github.com')
                and set(filter(None, files)) <= metadata)
        web, android = classify(list(filter(None, files)), bump)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        out.write(f'web={str(web).lower()}\nandroid={str(android).lower()}\n')
    print(f'Build web={web}, Android={android}')


if __name__ == '__main__':
    main()
