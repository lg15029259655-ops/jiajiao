# Mainland production deployment

## Target layout

- Tencent Cloud CVM in Chengdu runs the Docker image and Nginx.
- TencentDB for PostgreSQL is in the same region and private network.
- `orders.<domain>` is the teacher hall.
- `agent.<domain>` is the agent workspace.
- Encrypted database backups are uploaded daily to a separate COS bucket and retained for 30 days.

Do not deploy real family data until the database password previously exposed in chat/screenshots has been rotated.

## Preparation order

1. Register one `.com` domain and complete real-name verification.
2. Buy an eligible mainland cloud resource for at least the period required by Tencent Cloud filing rules.
3. Complete ICP filing before public service.
4. Create the Chengdu managed PostgreSQL instance and private-network CVM.
5. Restore a `pg_dump` into a test database and compare counts for agents, orders, import items, and audit logs.
6. Configure `.env` from `.env.example`; never place it in Git.
7. Replace `example.com` in the Nginx template and obtain HTTPS certificates.
8. Test both subdomains, `/health/live`, `/health/ready`, teacher listing, agent login, and one complete order workflow.

## Release and rollback

Every release uses a versioned Docker image. CI must pass before copying the image to production. Start the new container on a temporary port, run health and smoke checks, then switch Nginx upstream and reload it. Keep the previous image and environment available for immediate rollback.

Lower DNS TTL one day before the first cutover. Do not delete the old database or server during acceptance.

## Monitoring and backup

- Alert on readiness failures, HTTP 500 rate, connection-pool saturation, slow queries, and backup upload failures.
- Alert at 60% database storage; upgrade before 80%.
- Schedule `deploy/backup-to-cos.ps1` daily with Windows Task Scheduler or the Linux equivalent.
- Keep 30 daily encrypted backups.
- Once a month, restore the newest backup into an empty test database and verify table counts and order summaries.
- Run the anonymization task independently of browser activity.
