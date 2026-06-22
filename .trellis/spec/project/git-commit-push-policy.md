# Git Commit And Push Policy

## PLAN Confirmation

User approval of a PLAN means the agent may implement the current task. It does not authorize:

- `git commit`
- `git push`
- built-in Trellis archive
- skipping verification
- moving to the next child task

## Completion Signal

For staged overlay tasks, report work, verification, missed/extra scope, commit plan, soft archive plan, and `Pushed: no`, then wait for a completion signal.

Completion signal examples:

- `任务完成`
- `验证通过`
- `通过`
- `可以提交`
- `可以归档`
- `可以提交并归档`
- `这个任务 OK`

If the user says `先别提交`, `不要归档`, `等等`, `还要改`, or `先不要动`, do not commit or archive.

## Commit

After completion signal, commit only approved current-task files. Exclude unrelated dirty files.

## Push

Commit approval never implies push. Push requires an explicit command such as:

- `push`
- `推送`
- `git push`
- `可以推到远端`
