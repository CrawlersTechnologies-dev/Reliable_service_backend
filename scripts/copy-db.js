// Copies every collection from one MongoDB database to another (e.g. our Atlas → the client's Atlas).
// Keeps all _ids, so cases, users, photos links and logins stay exactly the same.
//
//   OLD_URI="mongodb+srv://...old..." NEW_URI="mongodb+srv://...new..." node scripts/copy-db.js
//
// Stops if the new database already has data (add FORCE=1 to empty it first).
import mongoose from 'mongoose';

const { OLD_URI, NEW_URI, FORCE } = process.env;
if (!OLD_URI || !NEW_URI) {
  console.error('Set OLD_URI and NEW_URI.');
  process.exit(1);
}
if (OLD_URI === NEW_URI) {
  console.error('OLD_URI and NEW_URI are the same.');
  process.exit(1);
}

const { MongoClient } = mongoose.mongo;
const oldC = new MongoClient(OLD_URI);
const newC = new MongoClient(NEW_URI);
await oldC.connect();
await newC.connect();
const src = oldC.db(); // database name comes from the URI path (…mongodb.net/<name>?…)
const dst = newC.db();
console.log(`From: ${src.databaseName}  →  To: ${dst.databaseName}`);

const cols = (await src.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
const existing = (await dst.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
const busy = [];
for (const n of existing) if ((await dst.collection(n).estimatedDocumentCount()) > 0) busy.push(n);
if (busy.length && !FORCE) {
  console.error(`The new database already has data in: ${busy.join(', ')}. Run again with FORCE=1 to replace it.`);
  process.exit(1);
}

let total = 0;
for (const name of cols) {
  if (FORCE && existing.includes(name)) await dst.collection(name).deleteMany({});
  const cursor = src.collection(name).find({});
  let batch = [];
  let n = 0;
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length === 500) {
      await dst.collection(name).insertMany(batch, { ordered: false });
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await dst.collection(name).insertMany(batch, { ordered: false });
    n += batch.length;
  }
  // indexes (unique email, case number…)
  const idx = (await src.collection(name).indexes()).filter((i) => i.name !== '_id_');
  for (const { key, name: iname, v, ns, ...opts } of idx) {
    await dst.collection(name).createIndex(key, { name: iname, ...opts }).catch((e) => console.warn(`  index ${iname}: ${e.message}`));
  }
  const check = await dst.collection(name).countDocuments();
  console.log(`  ${name.padEnd(20)} ${String(n).padStart(6)} copied  (${check} in new DB)`);
  total += n;
}
console.log(`Done — ${total} documents in ${cols.length} collections.`);
await oldC.close();
await newC.close();
