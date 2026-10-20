from codex_webui.assets import StaticAssets


def test_module_dependency_changes_invalidate_the_entire_bundle(tmp_path):
    (tmp_path / "index.html").write_text('<script type="module" src="/static/bootstrap.js"></script>')
    (tmp_path / "bootstrap.js").write_text("import('./app.js')")
    (tmp_path / "app.js").write_text("import './editor.js'")
    dependency = tmp_path / "editor.js"
    dependency.write_text("export const version = 1")
    first = StaticAssets(tmp_path)
    assert first.prefix == StaticAssets(tmp_path).prefix
    dependency.write_text("export const version = 2")
    second = StaticAssets(tmp_path)
    assert first.prefix != second.prefix
    assert f'{second.prefix}/bootstrap.js' in second.html
    assert first.prefix not in second.html
