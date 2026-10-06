# KK Saga — Atlas to Server Migration

Steps to migrate KK Saga's MongoDB from Atlas to the self-hosted server
(`32.192.131.130`), following the same pattern used for apsaga, tscan, and
tgcongress. See [MONGODB_OPERATIONS.md](MONGODB_OPERATIONS.md) for the server's
general operations reference.

Replace every `<PLACEHOLDER>` before running. All commands run **on the
server**:

```bash
ssh -i ~/.ssh/punjab_saga.pem ubuntu@32.192.131.130
```

> **Do not commit this file with real values filled in.** Fill in
> placeholders in your terminal only, or in a local copy outside the repo.

---

---

## Step 1 — Set the source URI and check its size

```bash
KKSAGA_URI='<KKSAGA_ATLAS_URI>'
echo "${#KKSAGA_URI} characters"
```

```bash
mongosh "$KKSAGA_URI/<SOURCE_DB_NAME>" --quiet --eval '
const s = db.stats();
print("collections : " + s.collections);
print("documents   : " + s.objects.toLocaleString());
print("data size   : " + (s.dataSize/1024/1024).toFixed(1) + " MB");
print("");
db.getCollectionNames().forEach(c => print("  " + c.padEnd(30) + db.getCollection(c).countDocuments()));
'
```

`<SOURCE_DB_NAME>` is whatever the database is actually called in that Atlas
cluster — check the app's own `.env` (`DB_NAME`) rather than assuming it
matches the app's name. (`tscan`'s source was called `test`; `tgcongress`'s
was `apsagaclone_new`.)

If the command hangs rather than returning quickly, revisit Step 0.

**Record the output** — it's what Step 5 gets compared against.

---

## Step 2 — Generate a password and create the app user

```bash
openssl rand -hex 24
```

Save the output, then create the user (replace both placeholders):

```bash
mongosh -u admin -p '<ADMIN_PASSWORD>' --authenticationDatabase admin --quiet --eval '
db.getSiblingDB("kksaga").createUser({
  user: "kksaga_app",
  pwd: "<GENERATED_APP_PASSWORD>",
  roles: [ { role: "readWrite", db: "kksaga" } ]
});
print("kksaga_app created");
'
```

Confirm:

```bash
mongosh -u admin -p '<ADMIN_PASSWORD>' --authenticationDatabase admin --quiet --eval '
db.getSiblingDB("kksaga").getUsers().users.forEach(u => print(u.user + " @" + u.db + " " + JSON.stringify(u.roles)));
'
```

Expect: `kksaga_app @kksaga [{"role":"readWrite","db":"kksaga"}]`

---

## Step 3 — Dump from Atlas

```bash
mongodump --uri="$KKSAGA_URI/<SOURCE_DB_NAME>" --gzip --archive=/tmp/kksaga-fresh.archive.gz
```

Large collections can take a while depending on that Atlas cluster's tier —
this has ranged from under a minute to about an hour on prior migrations. Let
it run to completion.

```bash
ls -lh /tmp/kksaga-fresh.archive.gz
```

---

## Step 4 — Restore, renamed to `kksaga`

```bash
mongorestore -u admin -p '<ADMIN_PASSWORD>' \
             --authenticationDatabase admin \
             --gzip --archive=/tmp/kksaga-fresh.archive.gz \
             --nsFrom="<SOURCE_DB_NAME>.*" --nsTo="kksaga.*"
```

Should end with `<N> document(s) restored successfully. 0 document(s) failed to restore.`

If `<SOURCE_DB_NAME>` is already `kksaga`, the `--nsFrom`/`--nsTo` flags are
unnecessary but harmless to leave in.

---

## Step 5 — Verify

```bash
mongosh kksaga -u admin -p '<ADMIN_PASSWORD>' --authenticationDatabase admin --quiet --eval '
db.getCollectionNames().forEach(c => print("  " + c.padEnd(30) + db.getCollection(c).countDocuments()));
print("\ncollections: " + db.getCollectionNames().length);
'
```

Compare collection-by-collection against Step 1's recorded output. Counts
should match exactly, or be slightly **higher** if the source app kept
writing during the dump — never lower.

```bash
mongosh -u admin -p '<ADMIN_PASSWORD>' --authenticationDatabase admin --quiet --eval 'show dbs'
```

Confirm only `kksaga` appears in the list — no stray `<SOURCE_DB_NAME>`
database left over from the restore.

---

## Step 6 — Point the application at the server

In KK Saga's `.env`:

```
MONGODB_URI="mongodb://kksaga_app:<GENERATED_APP_PASSWORD>@32.192.131.130:27017/kksaga?authSource=kksaga"
DB_NAME="kksaga"
```

Comment out the old Atlas line rather than deleting it — a one-line revert if
anything misbehaves.

Restart the app and confirm it loads real data (a page listing grievances,
sources, or similar).

---

## Step 7 — Update the shared operations doc

Add a row to the applications table in
[MONGODB_OPERATIONS.md](MONGODB_OPERATIONS.md#3-connection-string-reference):

```
| KK Saga | `kksaga` | `kksaga_app` | `kksaga` |
```

---

## After this migration

Four applications will be sharing this server with **no automated backups
yet**. That gap gets more expensive with every database added. Set up backups
before migrating a fifth — see the "Backup and restore" section of
[MONGODB_OPERATIONS.md](MONGODB_OPERATIONS.md#5-backup-and-restore).
