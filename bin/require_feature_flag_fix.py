#!/usr/bin/env python3
"""Refuse a packaged app.js that still forces flags onto a signed-in user.

LingoLinq-AAC #1347 adds resolve_feature_flags. When someone is signed in,
that function returns their own flags and ignores the compiled window list.
Logged-out screens, including Basic Access, fall back to that compiled list.
It includes emergency_boards. Do not blank it: production domain_settings
does not send a replacement list until #1347 is deployed, and a logged-out
screen with no flags hides Basic Access online and offline.
"""
import sys
from pathlib import Path

MARKER = 'resolve_feature_flags'


def require_feature_flag_fix(text):
    if MARKER not in text:
        raise SystemExit(
            'app.js has no resolve_feature_flags. '
            'Package from a LingoLinq build that includes LingoLinq-AAC #1347. '
            'A production or older bundle still forces the window list onto a signed-in user.'
        )


def main(argv):
    if len(argv) != 2:
        raise SystemExit('usage: require_feature_flag_fix.py APP_JS')
    require_feature_flag_fix(Path(argv[1]).read_text())


if __name__ == '__main__':
    main(sys.argv)
