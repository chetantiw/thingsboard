# Deploying MuTech-IoT on a ThingsBoard .deb server

`mutech-iot-4.3.1.6-mutech2.deb` is the official ThingsBoard CE 4.3.1.6 package with the
MuTech-IoT user interface. The server (Java) part is unchanged upstream ThingsBoard.

`upgrade-mutech-iot.sh` upgrades an existing ThingsBoard 4.x `.deb` installation that uses
PostgreSQL. ThingsBoard can only migrate a database between neighbouring releases, so the
script first migrates older databases with the official ThingsBoard packages
(downloaded from GitHub and checked against pinned SHA-256 sums):

```
4.0 -> 4.1 -> 4.2.0 -> 4.2.2.6 -> MuTech-IoT 4.3.1.6
```

## Before you start

- Plan a maintenance window: the server is stopped during the upgrade. On the test
  database (50 MB) the whole upgrade took about 6 minutes; large telemetry tables take longer.
- Free disk space for a full database backup in `/var/backups/mutech-iot` and about
  1.5 GB for the packages in `/var/cache/mutech-iot`.
- Keep the `.deb` of the version you run today if you have it: it is needed to roll back.
- Install the tools the script uses (they are usually already there):

  ```bash
  sudo apt install -y postgresql-client curl openjdk-17-jre-headless
  ```

## Upgrade

Run these on the server (as a user with sudo):

```bash
# 1. Get the MuTech-IoT files (UI, build script, upgrade script)
mkdir -p ~/mutech-iot && cd ~/mutech-iot
BASE=https://raw.githubusercontent.com/chetantiw/thingsboard/mutech-v4.3.1.6-ui-redesign/packaging/mutech
for f in ui-ngx-4.3.1.6-mutech2.jar build-mutech-deb.sh upgrade-mutech-iot.sh; do wget -q "$BASE/$f"; done
chmod +x build-mutech-deb.sh upgrade-mutech-iot.sh

# 2. Build the MuTech-IoT package from the official ThingsBoard 4.3.1.6 package
#    (downloads ~400 MB from github.com/thingsboard and checks every file against pinned checksums)
sudo apt install -y python3 zip
./build-mutech-deb.sh

# 3. Upgrade (shows the plan and asks before stopping anything)
sudo ./upgrade-mutech-iot.sh --deb ./mutech-iot-4.3.1.6-mutech2.deb
```

`build-mutech-deb.sh` verifies the result against the build that was tested, so the
package on your server is identical to the one used in the rehearsal.

The script:

1. Reads the database settings from `/usr/share/thingsboard/conf/thingsboard.conf`.
2. Works out the upgrade path from the database schema version and downloads the
   official intermediate packages it needs.
3. Stops ThingsBoard and backs up the database (`pg_dump`) and the `conf` folder to
   `/var/backups/mutech-iot/<timestamp>`.
4. Installs each package in turn, keeps your `thingsboard.conf`, and migrates the
   database, checking that every step succeeded.
5. Starts the service and waits until it answers.

If a step fails, the script stops without starting the server and prints the rollback command.

`thingsboard.yml` and `logback.xml` are replaced with the new defaults (as ThingsBoard
requires for an upgrade). If you edited them, the script lists them and your copies stay in
the backup folder.

Servers without internet access: download `thingsboard-4.1.deb`, `thingsboard-4.2.deb` and
`thingsboard-4.2.2.6.deb` from https://github.com/thingsboard/thingsboard/releases into a
folder and add `--packages <folder>`.

## Updating an earlier MuTech-IoT build

Servers that already run MuTech-IoT 4.3.1.6 (for example `4.3.1.6-1+mutech1`) are updated with
the same three steps. The database is already on 4.3, so the script backs it up, installs the
new package and restarts the service without migrating anything (about a minute).

## Roll back

```bash
sudo ./upgrade-mutech-iot.sh --rollback /var/backups/mutech-iot/<timestamp> --old-deb ./<your-previous-thingsboard>.deb
```

This restores the database backup, re-installs the previous package and your configuration,
and starts the service. Without your previous package you can use the official
`thingsboard-4.0.deb` from the ThingsBoard releases page (the stock 4.0 user interface).
