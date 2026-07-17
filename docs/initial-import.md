# Initial data import

The initial import never publishes directly to the teacher hall. It creates review items only.

## 1. Dry run

```powershell
pnpm db:import:dry-run -- --file="C:\data\orders.txt" --output="C:\data\orders-review.xlsx"
```

Supported inputs are `.txt`, `.csv`, and `.xlsx`, with a maximum of 5,000 rows. Review the generated workbook for missing fields, duplicate warnings, and confidence levels.

For unknown spreadsheet headings, create a JSON mapping such as:

```json
{
  "学生阶段": "grade",
  "辅导内容": "subject"
}
```

Then add `--mapping="C:\data\mapping.json"`.

## 2. Stage for review

```powershell
pnpm db:import:stage -- --file="C:\data\orders.xlsx" --agent=001
```

The command uses `DATABASE_DIRECT_URL`, writes 200 rows per transaction, and prints the batch id. No item is public until it is reviewed and published from the agent workspace.

If a connection fails, resume the same file and batch:

```powershell
pnpm db:import:stage -- --file="C:\data\orders.xlsx" --agent=001 --batch=<batch-id>
```

The resume command skips rows already committed. Web imports remain limited to 200 rows; large imports belong in this CLI workflow.
