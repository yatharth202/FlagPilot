# MongoDB audit-log write protection

Mongoose append-only middleware prevents accidental audit-log updates/deletes through the application model. For a production-grade boundary, the runtime MongoDB user must also lack collection-level update/delete privileges on `auditlogs`.

Create a custom role in the application's database (replace `flagpilot` with the actual database name). Include the collections your app uses. The example below gives normal CRUD on application data but only `find` and `insert` on audit logs:

```javascript
use flagpilot
db.createRole({
  role: "flagPilotRuntime",
  privileges: [
    ...["users", "projects", "featureflags", "analytics", "approvalrequests"].map(collection => ({
      resource: { db: "flagpilot", collection },
      actions: ["find", "insert", "update", "remove", "createIndex", "listIndexes"]
    })),
    {
      resource: { db: "flagpilot", collection: "auditlogs" },
      actions: ["find", "insert", "createIndex", "listIndexes"]
    }
  ],
  roles: []
});
```

Create the runtime user with this role and remove broad `readWrite` grants from that user. Run schema/index migrations with a separate deployment credential that has appropriate privileges (`MONGODB_MIGRATION_URI` is supported by the audit backfill script), then use the restricted credential at runtime. Create application collections and indexes before switching to the restricted user. Do not grant `update`, `remove`, `dropCollection`, or `dropDatabase` on `auditlogs` to the runtime user. Confirm collection names in the target database before applying the role.

This protects against normal application credentials modifying or deleting audit history. A database administrator or a separate privileged migration credential can still change the collection; use database backups and an external log sink or immutable object-storage export if tamper evidence against database administrators is required.
