#!/bin/bash
#
# SPDX-FileCopyrightText: Copyright MuTech Automation
# SPDX-License-Identifier: Apache-2.0
#
# Compiles the MuTech-IoT server add-on (white labeling API) against the official ThingsBoard
# 4.3.1.6 server and packs it as mutech-server-addon-4.3.1.6.jar. The prebuilt jar is committed
# next to this script; run this only to rebuild it. Needs a JDK (javac 17 or newer) and python3.
#
#   ./build-server-addon.sh --official-deb thingsboard-4.3.1.6.deb
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SOURCES=(
  "$REPO/application/src/main/java/org/thingsboard/server/controller/MutechBrandingController.java"
)
OUT="$HERE/mutech-server-addon-4.3.1.6.jar"
OFFICIAL_DEB=""

while [ $# -gt 0 ]; do
  case "$1" in
    --official-deb) OFFICIAL_DEB="$(realpath "$2")"; shift 2 ;;
    *) sed -n '7,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
done
[ -n "$OFFICIAL_DEB" ] || { echo "--official-deb is required"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

dpkg-deb --fsys-tarfile "$OFFICIAL_DEB" | tar -x -C "$WORK" ./usr/share/thingsboard/bin/thingsboard.jar
mkdir -p "$WORK/cp" "$WORK/classes"
(cd "$WORK/cp" && python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall('.', [n for n in zipfile.ZipFile(sys.argv[1]).namelist() if n.startswith('BOOT-INF/')])" \
  "$WORK/usr/share/thingsboard/bin/thingsboard.jar")
javac --release 17 -parameters -proc:none -nowarn \
  -cp "$WORK/cp/BOOT-INF/classes:$WORK/cp/BOOT-INF/lib/*" -d "$WORK/classes" "${SOURCES[@]}"

# Fixed timestamps and order, so the same compiler produces the same jar.
python3 - "$WORK/classes" "$OUT" <<'PY'
import os, sys, zipfile
classes, out = sys.argv[1], sys.argv[2]
paths = sorted(os.path.relpath(os.path.join(b, f), classes) for b, _, fs in os.walk(classes) for f in fs)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in paths:
        info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, open(os.path.join(classes, path), 'rb').read())
print('\n'.join(paths))
PY
sha256sum "$OUT"
