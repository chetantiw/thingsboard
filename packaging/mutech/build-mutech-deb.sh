#!/bin/bash
#
# SPDX-FileCopyrightText: Copyright MuTech Automation
# SPDX-License-Identifier: Apache-2.0
#
# Builds mutech-iot-4.3.1.6-mutech4.deb from the official ThingsBoard 4.3.1.6 package by
# replacing its user interface with the MuTech-IoT UI (ui-ngx-4.3.1.6-mutech4.jar) and adding the
# MuTech-IoT server add-on (white labeling API, mutech-server-addon-4.3.1.6.jar; source in
# application/src/main/java/org/thingsboard/server/controller/MutechBrandingController.java).
#
#   ./build-mutech-deb.sh [--ui-jar ui-ngx-4.3.1.6-mutech4.jar] [--official-deb thingsboard-4.3.1.6.deb]
#
# Needs: curl, dpkg-deb, python3, zip, sha256sum, md5sum.
#
set -euo pipefail

OFFICIAL_URL=https://github.com/thingsboard/thingsboard/releases/download/v4.3.1.6/thingsboard-4.3.1.6.deb
OFFICIAL_SHA256=0f252b842f0dfacae2c26bf49a5717c30682cafbfb81eaf4b52d8b03c16d5c4b
ADDON_JAR_SHA256=3425c9cf979e7464639a5c60e4f9217ec7a6c6b7f7f2f41c8ccfa53ee82baefc
UI_JAR_SHA256=6f094ece201021b67131616455fe01181b3ae3936dbfa6b1800ff2fb598b6191
# thingsboard.jar produced from the inputs above (the build that was tested).
EXPECTED_JAR_MD5=289d048419171a138b2115042a952a59
VERSION=4.3.1.6-1+mutech4
OUT=mutech-iot-4.3.1.6-mutech4.deb

HERE="$(cd "$(dirname "$0")" && pwd)"
UI_JAR="$HERE/ui-ngx-4.3.1.6-mutech4.jar"
ADDON_JAR="$HERE/mutech-server-addon-4.3.1.6.jar"
OFFICIAL_DEB=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ui-jar) UI_JAR="$(realpath "$2")"; shift 2 ;;
    --official-deb) OFFICIAL_DEB="$(realpath "$2")"; shift 2 ;;
    *) sed -n '6,14p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
done

log() { echo -e "\033[1;34m[mutech]\033[0m $*"; }
die() { echo -e "\033[1;31m[mutech] ERROR:\033[0m $*" >&2; exit 1; }

for tool in curl dpkg-deb python3 zip sha256sum md5sum; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is missing: sudo apt install -y curl dpkg python3 zip coreutils"
done

[ -f "$UI_JAR" ] || die "UI jar $UI_JAR not found."
echo "$UI_JAR_SHA256  $UI_JAR" | sha256sum -c --status || die "Checksum mismatch for $UI_JAR (download it again)."
[ -f "$ADDON_JAR" ] || die "Server add-on $ADDON_JAR not found."
echo "$ADDON_JAR_SHA256  $ADDON_JAR" | sha256sum -c --status || die "Checksum mismatch for $ADDON_JAR (download it again)."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -z "$OFFICIAL_DEB" ]; then
  OFFICIAL_DEB="$WORK/thingsboard-4.3.1.6.deb"
  log "Downloading the official ThingsBoard 4.3.1.6 package (~400 MB) ..."
  curl -fSL --retry 3 -o "$OFFICIAL_DEB" "$OFFICIAL_URL"
fi
echo "$OFFICIAL_SHA256  $OFFICIAL_DEB" | sha256sum -c --status || die "Checksum mismatch for $OFFICIAL_DEB."

log "Unpacking ..."
dpkg-deb -R "$OFFICIAL_DEB" "$WORK/pkg"
JAR="$WORK/pkg/usr/share/thingsboard/bin/thingsboard.jar"

log "Replacing the user interface and adding the server add-on ..."
# thingsboard.jar starts with a launch script; nested jars must stay STORED (uncompressed).
python3 - "$JAR" "$UI_JAR" "$ADDON_JAR" <<'PY'
import os, sys, zipfile
jar, ui_jar, addon_jar = sys.argv[1], sys.argv[2], sys.argv[3]
target = 'BOOT-INF/lib/ui-ngx-4.3.1.6.jar'
data = open(jar, 'rb').read()
offset = data.index(b'PK\x03\x04')
body = jar + '.body'
with zipfile.ZipFile(jar) as zin, zipfile.ZipFile(body, 'w') as zout:
    replaced = False
    for info in zin.infolist():
        if info.filename == target:
            new = zipfile.ZipInfo(target, date_time=info.date_time)
            new.compress_type = zipfile.ZIP_STORED
            new.external_attr = info.external_attr
            zout.writestr(new, open(ui_jar, 'rb').read())
            replaced = True
        else:
            zout.writestr(info, zin.read(info.filename), compress_type=info.compress_type)
    if not replaced:
        sys.exit('UI jar entry not found in thingsboard.jar')
    # Add-on classes go next to the server's own classes, so Spring finds the controller.
    existing = set(zin.namelist())
    with zipfile.ZipFile(addon_jar) as addon:
        for name in addon.namelist():
            target_name = 'BOOT-INF/classes/' + name
            if target_name in existing:
                sys.exit('Add-on class already present in thingsboard.jar: ' + name)
            info = zipfile.ZipInfo(target_name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zout.writestr(info, addon.read(name))
with open(jar, 'wb') as f:
    f.write(data[:offset])
    f.write(open(body, 'rb').read())
os.remove(body)
PY
zip -qA "$JAR"
[ "$(md5sum "$JAR" | cut -d' ' -f1)" = "$EXPECTED_JAR_MD5" ] || die "The rebuilt thingsboard.jar does not match the tested build."

log "Updating package metadata ..."
sed -i "s/^Version: .*/Version: $VERSION/; \
        s/^Maintainer: .*/Maintainer: MuTech Automation <chetantiw@gmail.com>/; \
        s/^Description: .*/Description: MuTech-IoT (ThingsBoard CE 4.3.1.6 with the MuTech-IoT UI and white labeling)/" "$WORK/pkg/DEBIAN/control"
sed -i "s#^[0-9a-f]\{32\}  usr/share/thingsboard/bin/thingsboard.jar\$#$EXPECTED_JAR_MD5  usr/share/thingsboard/bin/thingsboard.jar#" "$WORK/pkg/DEBIAN/md5sums"
# The official package lists a config file it does not ship; newer dpkg-deb rejects that.
sed -i '\#/usr/share/thingsboard/conf/actor-system.conf#d' "$WORK/pkg/DEBIAN/conffiles"

log "Building $OUT ..."
dpkg-deb --root-owner-group -Zgzip --build "$WORK/pkg" "$OUT" >/dev/null
log "Done: $(realpath "$OUT") ($(dpkg-deb -f "$OUT" Version))"
