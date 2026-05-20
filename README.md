# RTC Mod Bot

## Railway setup
1. Upload these files to GitHub.
2. Railway → New Project → Deploy from GitHub.
3. Variables:
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = bot application/client ID
   - `GUILD_ID` = your server ID
   - `PREFIX` = +
4. Start command: `npm start`
5. Run once locally or in Railway shell: `npm run deploy` to register slash commands.

## Prefix commands
`+warn @user reason`, `+unwarn @user warnNumber`, `+warnings @user`, `+permwarn @user reason`, `+removepermwarn @user number`, `+ban @user reason`, `+kick @user reason`, `+mute @user 10m reason`, `+unban userId reason`, `+setconfigwarn`, `+setconfigperm`, `+setmodconfig`

## Slash commands
`/warn`, `/unwarn`, `/warnings`, `/permwarn`, `/removepermwarn`, `/ban`, `/kick`, `/mute`, `/unban`, `/say`, `/embedsay`, `/dm`, `/embeddm`, `/setconfigwarn`, `/setconfigperm`, `/setmodconfig`
