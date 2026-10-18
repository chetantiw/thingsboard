#!/usr/bin/env python3
#
# SPDX-FileCopyrightText: Copyright MuTech Automation
# SPDX-License-Identifier: Apache-2.0
#
# Apache License 2.0, section 4(b): modified files must carry a notice that they were changed.
# Adds "SPDX-FileContributor: Modified by MuTech Automation" under the license line of every file
# that differs from the upstream ThingsBoard release. Files that cannot hold a comment (JSON,
# images) are covered by the NOTICE file. Safe to run again after new changes.
#
#   python3 packaging/mutech/mark-modified-files.py [upstream-tag]   (default: v4.3.1.6)
#
import os
import subprocess
import sys

MARKER = 'SPDX-FileContributor: Modified by MuTech Automation'
LICENSE_LINE = 'SPDX-License-Identifier: Apache-2.0'
# Files whose header is a comment block (JSON and images cannot hold one).
EXTENSIONS = {'.ts', '.js', '.scss', '.java', '.html', '.xml', '.sh', '.yml', '.yaml'}

base = sys.argv[1] if len(sys.argv) > 1 else 'v4.3.1.6'
root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
os.chdir(root)
changed = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=M', base], text=True).split()

marked = 0
for path in changed:
    if os.path.splitext(path)[1] not in EXTENSIONS or not os.path.isfile(path):
        continue
    with open(path, encoding='utf-8', newline='') as f:
        text = f.read()
    if MARKER in text:
        continue
    newline = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(newline)
    for i, line in enumerate(lines[:12]):
        if LICENSE_LINE in line and 'Thingsboard Authors' in newline.join(lines[:i + 1]):
            # Same comment prefix as the license line: "// ", "# " or the indent inside <!-- -->.
            lines.insert(i + 1, line[:line.index(LICENSE_LINE)] + MARKER)
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(newline.join(lines))
            marked += 1
            break
    else:
        print('no upstream license header, skipped:', path)

print(f'{marked} file(s) marked, {len(changed)} changed since {base}')
