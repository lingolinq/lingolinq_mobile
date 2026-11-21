#!/usr/bin/env python3
"""Clear the forced feature-flag list in a packaged shell.

init.js reads the div in index.html, then app.js assigns
window.enabled_frontend_features and the compiled app sets each name true.
Blank both. Fail when the assignment is missing or appears more than once,
so a store build cannot ship the stale list quietly.
"""
import re
import sys
from pathlib import Path

FLAG_ASSIGN = re.compile(r'window\.enabled_frontend_features\s*=\s*\[[^\]]*\];')
DIV = re.compile(
    r"(<div id='enabled_frontend_features' data-list=')[^']*('></div>)"
)


def clear_app_js(text):
    found = FLAG_ASSIGN.findall(text)
    if len(found) != 1:
        raise SystemExit(
            'app.js must contain exactly one enabled_frontend_features assignment, found %s' % len(found)
        )
    return FLAG_ASSIGN.sub('window.enabled_frontend_features = [];', text, count=1)


def clear_index_html(text):
    updated, count = DIV.subn(r'\1\2', text, count=1)
    if count != 1:
        raise SystemExit('index.html missing the enabled_frontend_features div')
    return updated


def main(argv):
    if len(argv) != 3:
        raise SystemExit('usage: clear_forced_feature_flags.py APP_JS INDEX_HTML')
    app_path = Path(argv[1])
    html_path = Path(argv[2])
    app_path.write_text(clear_app_js(app_path.read_text()))
    html_path.write_text(clear_index_html(html_path.read_text()))


if __name__ == '__main__':
    main(sys.argv)
