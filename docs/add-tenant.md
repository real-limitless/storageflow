# Add a tenant

Example id: `north`. The shipped tenant is `acme`. Copy that pattern.

## 1. Backend path

Local:

```sh
mkdir -p data/backend/north/plain
```

SFTP, on the remote you already operate:

```sh
mkdir -p ~/customers/north/plain
```

Skip crypt and shard until you want those layers.

## 2. rclone remotes

Edit the gitignored `secrets/rclone.json`. The `rclone_conf` string is rclone ini.

Local plain:

```ini
[north-plain]
type = alias
remote = localbox:/data/north/plain

[gateway-north]
type = combine
upstreams = north-plain=north-plain:
```

Append `north-plain=north-plain:` to `[gateway]` `upstreams` so admin can see it. Upstream names must be unique.

Optional SFTP. Replace the host, user, and password. Do not commit them.

```ini
[backend]
type = sftp
host = sftp.example.com
user = storage
pass = CHANGE_ME
shell_type = unix
md5sum_command = none
sha1sum_command = none

[north-plain]
type = alias
remote = backend:customers/north/plain
```

Pin the host key in a gitignored `known_hosts` and set `known_hosts_file` on that remote. Do not commit the pin.

Optional crypt and chunker:

```ini
[north-crypt]
type = crypt
remote = backend:customers/north/crypt
password = CHANGE_ME
password2 = CHANGE_ME
filename_encryption = standard
directory_name_encryption = true

[north-shard]
type = chunker
remote = backend:customers/north/shard
chunk_size = 2Gi
```

Obscure crypt passwords with `rclone obscure` before saving them. The example stack does not enable these layers.

## 3. tenants.json

Edit gitignored `secrets/tenants.json`:

```json
"north": {
  "access_key": "CHANGE_ME_ACCESS",
  "secret_key": "CHANGE_ME_SECRET",
  "buckets": ["north-plain"],
  "sftpgo_user": "north"
}
```

Generate the key locally. Do not commit it.

## 4. Compose service

Copy `s3-acme` in `docker-compose.yml`. Set the command to `["cache", "gateway-north", "north"]` and publish a free host port. On Dokploy, copy the service in `docker-compose.dokploy.yml` and `expose` the container port on the Compose network. Restart the stack.

```sh
docker compose up -d --build
```

## 5. SFTPGo user

In the SFTPGo UI, add an S3 user. Endpoint `http://s3-north:8080`. Force path style. Access key and secret from `tenants.json`.
