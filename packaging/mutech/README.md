# Deploying MuTech-IoT on a ThingsBoard .deb server

`mutech-iot-4.3.1.6-mutech1.deb` is the official ThingsBoard CE 4.3.1.6 package with the
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

```bash
# 1. Download the release files
wget https://github.com/chetantiw/thingsboard/releases/download/mutech-4.3.1.6-1/mutech-iot-4.3.1.6-mutech1.deb
wget https://github.com/chetantiw/thingsboard/releases/download/mutech-4.3.1.6-1/mutech-iot-4.3.1.6-mutech1.deb.sha256
wget https://github.com/chetantiw/thingsboard/releases/download/mutech-4.3.1.6-1/upgrade-mutech-iot.sh
sha256sum -c mutech-iot-4.3.1.6-mutech1.deb.sha256
chmod +x upgrade-mutech-iot.sh

# 2. Run the upgrade (it shows the plan and asks before stopping anything)
sudo ./upgrade-mutech-iot.sh --deb ./mutech-iot-4.3.1.6-mutech1.deb
```

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

## Roll back

```bash
sudo ./upgrade-mutech-iot.sh --rollback /var/backups/mutech-iot/<timestamp> --old-deb ./<your-previous-thingsboard>.deb
```

This restores the database backup, re-installs the previous package and your configuration,
and starts the service. Without your previous package you can use the official
`thingsboard-4.0.deb` from the ThingsBoard releases page (the stock 4.0 user interface).
