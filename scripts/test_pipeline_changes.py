import unittest
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
spec = spec_from_file_location('changes', Path(__file__).with_name('pipeline-changes.py'))
changes = module_from_spec(spec)
spec.loader.exec_module(changes)

class SelectionTests(unittest.TestCase):
    def test_docs_do_not_publish(self):
        self.assertEqual(changes.classify(['README.md', 'apps/client/docs/ACCEPTANCE.md', '.devcontainer/devcontainer.json']), (False, False))
    def test_web_is_shared_by_both_products(self):
        self.assertEqual(changes.classify(['src/routes/+page.svelte']), (True, True))
    def test_native_does_not_rebuild_web(self):
        self.assertEqual(changes.classify(['apps/client/src-tauri/src/lib.rs']), (False, True))
    def test_release_bump_does_not_loop(self):
        self.assertEqual(changes.classify(['apps/client/package.json'], True), (False, False))
    def test_android_workflow_does_not_rebuild_web(self):
        self.assertEqual(changes.classify(['.github/workflows/android.yml']), (False, True))

if __name__ == '__main__': unittest.main()
