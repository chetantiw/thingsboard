#!/bin/bash
#
# SPDX-FileCopyrightText: Copyright MuTech Automation
# SPDX-License-Identifier: Apache-2.0
#
# Upgrades a ThingsBoard 4.x .deb installation (PostgreSQL) to the MuTech-IoT build,
# with a database + configuration backup and a rollback mode.
#
#   Upgrade:   sudo ./upgrade-mutech-iot.sh --deb ./mutech-iot-4.3.1.6-mutech4.deb
#   Rollback:  sudo ./upgrade-mutech-iot.sh --rollback /var/backups/mutech-iot/<timestamp> --old-deb ./thingsboard-<old>.deb
#
# Options:   -y / --yes          do not ask for confirmation
#            --packages <dir>    folder with the official intermediate packages (otherwise downloaded)
#
# ThingsBoard only migrates a database between neighbouring releases, so older databases are
# first migrated with the official ThingsBoard packages: 4.0 -> 4.1 -> 4.2.0 -> 4.2.2.6 -> MuTech-IoT.
#
set -euo pipefail

TB_HOME=/usr/share/thingsboard
TB_CONF_DIR=${TB_HOME}/conf
TB_CONF=${TB_CONF_DIR}/thingsboard.conf
BACKUP_ROOT=/var/backups/mutech-iot
PACKAGE_CACHE=/var/cache/mutech-iot
HEALTH_TIMEOUT_SEC=600
RELEASES_URL=https://github.com/thingsboard/thingsboard/releases/download

# Official intermediate packages: version, file, SHA-256.
declare -A HOP_FILE=(
  [4.1]=thingsboard-4.1.deb
  [4.2]=thingsboard-4.2.deb
  [4.2.2.6]=thingsboard-4.2.2.6.deb
)
declare -A HOP_TAG=(
  [4.1]=v4.1
  [4.2]=v4.2
  [4.2.2.6]=v4.2.2.6
)
declare -A HOP_SHA256=(
  [4.1]=0d09d5152fbeb33250d86a7e06d2c3eee61913d9d97522d57146f31b5affeff1
  [4.2]=d3318c4c51f8abe153b888ad525524b8391f715f94741f7bf379367445310876
  [4.2.2.6]=520a38acb69ca3a2a7611cad81506af1e96f0ae5f24915209c6206fd164c8a6b
)

NEW_DEB=""
ROLLBACK_DIR=""
OLD_DEB=""
PACKAGES_DIR=""
ASSUME_YES=false

log()  { echo -e "\033[1;34m[mutech]\033[0m $*"; }
warn() { echo -e "\033[1;33m[mutech] WARNING:\033[0m $*" >&2; }
die()  { echo -e "\033[1;31m[mutech] ERROR:\033[0m $*" >&2; exit 1; }

usage() {
  sed -n '7,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) NEW_DEB="$(realpath "$2")"; shift 2 ;;
    --rollback) ROLLBACK_DIR="$2"; shift 2 ;;
    --old-deb) OLD_DEB="$(realpath "$2")"; shift 2 ;;
    --packages) PACKAGES_DIR="$(realpath "$2")"; shift 2 ;;
    -y|--yes) ASSUME_YES=true; shift ;;
    *) usage ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
[ -n "$NEW_DEB" ] || [ -n "$ROLLBACK_DIR" ] || usage

confirm() {
  $ASSUME_YES && return 0
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "Aborted by user."
}

service_ctl() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl "$1" thingsboard
  else
    service thingsboard "$1"
  fi
}

# Reads the database connection the installation uses from thingsboard.conf.
load_db_settings() {
  local conf="${1:-$TB_CONF}"
  [ -f "$conf" ] || die "$conf not found - is ThingsBoard installed as a .deb package?"
  eval "$(bash -c "source '$conf' >/dev/null 2>&1; \
    printf 'DB_URL=%q\n' \"\${SPRING_DATASOURCE_URL:-jdbc:postgresql://localhost:5432/thingsboard}\"; \
    printf 'DB_USER=%q\n' \"\${SPRING_DATASOURCE_USERNAME:-postgres}\"; \
    printf 'DB_PASS=%q\n' \"\${SPRING_DATASOURCE_PASSWORD:-postgres}\"; \
    printf 'HTTP_PORT=%q\n' \"\${HTTP_BIND_PORT:-8080}\"; \
    printf 'TS_TYPE=%q\n' \"\${DATABASE_TS_TYPE:-sql}\"")"
  [[ "$DB_URL" =~ ^jdbc:postgresql://([^:/]+)(:([0-9]+))?/([^?]+) ]] || die "Unsupported database URL: $DB_URL"
  DB_HOST="${BASH_REMATCH[1]}"
  DB_PORT="${BASH_REMATCH[3]:-5432}"
  DB_NAME="${BASH_REMATCH[4]}"
  export PGPASSWORD="$DB_PASS"
}

psql_db() {
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

# Prints the database schema as "major minor patch" (4000000 -> 4 0 0, 4002002006 -> 4 2 2).
schema_version() {
  local v
  v=$(psql_db -tAc "select schema_version from tb_schema_settings" 2>/dev/null | tr -d '[:space:]')
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "unknown"; return; }
  if [ "$v" -ge 1000000000 ]; then
    echo "$((v / 1000000000)) $((v / 1000000 % 1000)) $((v / 1000 % 1000))"
  else
    echo "$((v / 1000000)) $((v / 1000 % 1000)) $((v % 1000))"
  fi
}

# Official releases the database has to pass through before the MuTech-IoT package.
required_hops() {
  read -r major minor patch <<< "$1"
  case "$major.$minor" in
    4.0) echo "4.1 4.2 4.2.2.6" ;;
    4.1) echo "4.2 4.2.2.6" ;;
    4.2) if [ "$patch" -eq 0 ]; then echo "4.2.2.6"; else echo ""; fi ;;
    4.3) echo "" ;;
    *) die "Database schema $major.$minor.$patch is not supported by this script. Upgrade to ThingsBoard 4.0 first (see thingsboard.io/docs/user-guide/install/upgrade-instructions)." ;;
  esac
}

fetch_hop_package() {
  local version="$1" file="${HOP_FILE[$1]}" path
  if [ -n "$PACKAGES_DIR" ] && [ -f "$PACKAGES_DIR/$file" ]; then
    path="$PACKAGES_DIR/$file"
  else
    mkdir -p "$PACKAGE_CACHE"
    path="$PACKAGE_CACHE/$file"
    if [ ! -f "$path" ] || ! echo "${HOP_SHA256[$version]}  $path" | sha256sum -c --status; then
      log "Downloading official ThingsBoard $version ..." >&2
      curl -fSL --retry 3 -o "$path.part" "$RELEASES_URL/${HOP_TAG[$version]}/$file" >&2
      mv "$path.part" "$path"
    fi
  fi
  echo "${HOP_SHA256[$version]}  $path" | sha256sum -c --status || die "Checksum mismatch for $path"
  echo "$path"
}

# Installs a package, keeps this server's thingsboard.conf, and migrates the database if needed.
install_and_migrate() {
  local deb="$1" label="$2" logfile="$BACKUP_DIR/upgrade-$2.log"
  log "Installing $label ($(dpkg-deb -f "$deb" Version)) ..."
  dpkg -i --force-confnew "$deb" > "$BACKUP_DIR/dpkg-$label.log" 2>&1 || { cat "$BACKUP_DIR/dpkg-$label.log"; return 1; }
  cp -a "$BACKUP_DIR/conf/thingsboard.conf" "$TB_CONF"
  chown -R thingsboard: "$TB_HOME"
  # A database already on 4.3 (an earlier MuTech-IoT build) needs no migration.
  if [ "$label" = "mutech-iot" ] && [ "$(schema_version | cut -d' ' -f1-2)" = "4 3" ]; then
    log "Database is already at schema $(schema_version | tr ' ' '.'): no migration needed."
    return 0
  fi
  log "Migrating the database with $label (this can take a while on large databases) ..."
  # upgrade.sh runs Java as the thingsboard user, which needs a working directory it can read.
  (cd "$TB_HOME" && "$TB_HOME/bin/install/upgrade.sh") > "$logfile" 2>&1 || true
  # upgrade.sh exits with 0 even when the migration fails, so check its output.
  if ! grep -q "ThingsBoard upgraded successfully!" "$logfile"; then
    grep -E "not supported|Supported versions|ERROR|Exception" "$logfile" | head -5 >&2 || true
    warn "Full log: $logfile"
    return 1
  fi
  log "Database is now at schema $(schema_version | tr ' ' '.')"
}

wait_until_healthy() {
  log "Waiting for the server to answer on port ${HTTP_PORT} (up to $((HEALTH_TIMEOUT_SEC / 60)) min) ..."
  local waited=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:${HTTP_PORT}/api/noauth/oauth2Clients" || true)" = "200" ]; do
    sleep 5
    waited=$((waited + 5))
    [ $waited -lt $HEALTH_TIMEOUT_SEC ] || return 1
  done
}

rollback_hint() {
  warn "The service has NOT been started on a half-upgraded database."
  warn "To go back:  sudo $0 --rollback $BACKUP_DIR --old-deb <the .deb of version $(cat "$BACKUP_DIR/previous-version.txt")>"
}

rollback() {
  [ -f "$ROLLBACK_DIR/thingsboard.dump" ] || die "$ROLLBACK_DIR/thingsboard.dump not found."
  [ -f "$ROLLBACK_DIR/conf/thingsboard.conf" ] || die "$ROLLBACK_DIR/conf/thingsboard.conf not found."
  [ -n "$OLD_DEB" ] && [ -f "$OLD_DEB" ] || die "Pass the package you had before with --old-deb <file.deb>."
  load_db_settings "$ROLLBACK_DIR/conf/thingsboard.conf"
  log "Rolling back to $(dpkg-deb -f "$OLD_DEB" Version) using backup $ROLLBACK_DIR"
  confirm "This replaces everything in database '$DB_NAME' with the backup. Continue?"
  service_ctl stop || true
  log "Restoring the database ..."
  psql_db -qc "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error "$ROLLBACK_DIR/thingsboard.dump"
  log "Re-installing the previous package ..."
  dpkg -i --force-downgrade --force-confnew "$OLD_DEB" > /dev/null
  cp -a "$ROLLBACK_DIR/conf/." "$TB_CONF_DIR/"
  chown -R thingsboard: "$TB_HOME"
  service_ctl start
  if wait_until_healthy; then
    log "Rollback finished - version $(dpkg-query -W -f='${Version}' thingsboard) is running again."
  else
    die "The previous version did not come up. Check /var/log/thingsboard/thingsboard.log"
  fi
}

upgrade() {
  [ -f "$NEW_DEB" ] || die "Package $NEW_DEB not found."
  dpkg-deb -f "$NEW_DEB" Package | grep -qx thingsboard || die "$NEW_DEB is not a ThingsBoard package."
  dpkg -s thingsboard >/dev/null 2>&1 || die "No ThingsBoard .deb installation found on this server."
  for tool in pg_dump pg_restore psql curl java sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || die "'$tool' is missing. Install it first: sudo apt install postgresql-client curl openjdk-17-jre-headless"
  done
  local java_major
  java_major=$(java -version 2>&1 | awk -F'"' '/version/ {split($2, v, "."); print v[1]}')
  [ "${java_major:-0}" -ge 17 ] || die "Java 17 or newer is required (found ${java_major:-none})."

  load_db_settings
  [ "$TS_TYPE" = "sql" ] || warn "DATABASE_TS_TYPE=$TS_TYPE: only PostgreSQL is backed up by this script; back up Cassandra/Timescale separately first."
  psql_db -tAc "select 1" >/dev/null || die "Cannot connect to database $DB_NAME on $DB_HOST:$DB_PORT as $DB_USER."

  local current target schema hops
  current=$(dpkg-query -W -f='${Version}' thingsboard)
  target=$(dpkg-deb -f "$NEW_DEB" Version)
  schema=$(schema_version)
  [ "$schema" != "unknown" ] || die "Could not read the database schema version."
  hops=$(required_hops "$schema")
  log "Installed package: $current | database schema: ${schema// /.} | target: $target"
  log "Upgrade path: ${schema// /.} -> ${hops:+${hops// / -> } -> }MuTech-IoT $target"

  BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  local db_size free_kb
  db_size=$(psql_db -tAc "select pg_database_size(current_database())")
  free_kb=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
  [ $((db_size / 1024)) -lt "$free_kb" ] || die "Not enough free disk space in $BACKUP_ROOT for the backup (~$((db_size / 1024 / 1024)) MB needed)."

  # Fetch everything before touching the running system.
  declare -A hop_paths=()
  for hop in $hops; do
    hop_paths[$hop]=$(fetch_hop_package "$hop")
  done

  confirm "Stop the server, back up database '$DB_NAME' to $BACKUP_DIR and upgrade?"

  log "Stopping the service ..."
  service_ctl stop || true

  log "Backing up database '$DB_NAME' ($((db_size / 1024 / 1024)) MB) ..."
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$BACKUP_DIR/thingsboard.dump"
  cp -a "$TB_CONF_DIR" "$BACKUP_DIR/conf"
  echo "$current" > "$BACKUP_DIR/previous-version.txt"
  log "Backup written to $BACKUP_DIR"

  local modified
  modified=$(dpkg -V thingsboard 2>/dev/null | awk '$NF ~ /conf\/(thingsboard\.yml|logback\.xml)$/ {print $NF}' || true)
  if [ -n "$modified" ]; then
    warn "These files were edited on this server and are replaced by the new defaults:"
    echo "$modified" | sed 's/^/           /' >&2
    warn "Your versions are saved in $BACKUP_DIR/conf - re-apply your changes afterwards."
  fi

  for hop in $hops; do
    install_and_migrate "${hop_paths[$hop]}" "thingsboard-$hop" || { rollback_hint; exit 1; }
  done
  install_and_migrate "$NEW_DEB" "mutech-iot" || { rollback_hint; exit 1; }

  log "Starting the service ..."
  service_ctl start
  if wait_until_healthy; then
    log "Upgrade finished: MuTech-IoT $target is running on http://<this-server>:${HTTP_PORT}"
    log "Backup kept in $BACKUP_DIR - delete it once you are happy with the upgrade."
  else
    warn "The server did not answer in time. Check: sudo tail -n 200 /var/log/thingsboard/thingsboard.log"
    warn "To go back:  sudo $0 --rollback $BACKUP_DIR --old-deb <the .deb of version $current>"
    exit 1
  fi
}

if [ -n "$ROLLBACK_DIR" ]; then
  rollback
else
  upgrade
fi
