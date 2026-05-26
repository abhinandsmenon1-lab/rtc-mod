# RTC Mod Bot

Prefix: `+`

## Railway setup
1. Upload this folder to GitHub.
2. Create Railway project from GitHub repo.
3. In Railway Variables add:
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = bot application/client ID
   - `GUILD_ID` = your Discord server ID, optional but recommended for fast slash command updates
4. Start command is already: `npm start`

## Important Discord permissions
Invite bot with Administrator or at least:
- Manage Roles
- Ban Members
- Kick Members
- Moderate Members
- Send Messages
- Embed Links
- Use Slash Commands
- Read Message History

Put the bot role ABOVE the roles it needs to remove/demote.

## Commands
Prefix + slash:
- `+warn @user reason` / `/warn`
- `+permwarn @user reason` and `+perm warn @user reason` / `/permwarn`
- `+warnings @user` / `/warnings`
- `+unwarn @user number` / `/unwarn`
- `+removepermwarn @user number` / `/removepermwarn`
- `+ban @user reason` / `/ban`
- `+kick @user reason` / `/kick`
- `+mute @user 10m reason` / `/mute`
- `+unban userid reason` / `/unban`

Config commands:
- `+setconfigwarn` / `/setconfigwarn`
- `+setconfigperm` / `/setconfigperm`
- `+setmodconfig` / `/setmodconfig`

Admin-only utility slash commands:
- `/say`
- `/embedsay`
- `/dm`
- `/embeddm`

## Notes
- Regular warns and permanent warns are stored in `data.json`.
- At 3 total warns, bot removes the user's highest removable role, clears regular warns, and keeps permanent warns.
- Mods can only warn/moderate members below their highest role.
