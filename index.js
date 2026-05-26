import 'dotenv/config';
import fs from 'fs';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  GatewayIntentBits, Partials, PermissionsBitField, REST, Routes, SlashCommandBuilder,
  StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder
} from 'discord.js';

const PREFIX = '+';
const DATA_FILE = './data.json';
const COLORS = { warn: 0xffd43b, perm: 0xed4245, mod: 0x5865f2, demote: 0xff8c1a, ok: 0x57f287, bad: 0xed4245 };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildModeration],
  partials: [Partials.Channel]
});

let db = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : { guilds: {} };
function save(){ fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function gdata(gid){
  db.guilds[gid] ??= { warns: {}, config: { warnLogChannelId:null, permLogChannelId:null, modLogChannelId:null, warnRoleId:null, permRoleId:null, modRoleId:null } };
  return db.guilds[gid];
}
function userData(gid, uid){
  const g = gdata(gid); g.warns[uid] ??= { regular: [], perm: [] }; return g.warns[uid];
}
function nowId(){ return `${Date.now()}${Math.floor(Math.random()*999)}`; }
function cleanReason(reason){ return reason?.trim() || 'No reason provided'; }
function hasAdmin(member){ return member.permissions.has(PermissionsBitField.Flags.Administrator); }
function highest(member){ return member.roles.highest?.position || 0; }
function canActOn(executor, target){
  if (executor.id === target.id) return false;
  if (executor.guild.ownerId === executor.id) return true;
  return highest(executor) > highest(target);
}
function hasConfiguredRole(member, roleId){
  if (!roleId) return false;
  return member.roles.cache.has(roleId) || highest(member) >= (member.guild.roles.cache.get(roleId)?.position ?? 999999) || hasAdmin(member);
}
function configReady(gid, type){
  const c = gdata(gid).config;
  if(type === 'warn') return Boolean(c.warnLogChannelId && c.warnRoleId);
  if(type === 'perm') return Boolean(c.permLogChannelId && c.permRoleId);
  if(type === 'mod') return Boolean(c.modLogChannelId && c.modRoleId);
  return false;
}
function missingConfigText(type){
  return `⚙️ ${type} config is not set yet. An administrator must run /setconfig${type === 'mod' ? 'mod' : type} or +${type === 'mod' ? 'setmodconfig' : `setconfig${type}` } first.`;
}
function canWarn(member){ const c=gdata(member.guild.id).config; return configReady(member.guild.id,'warn') && hasConfiguredRole(member, c.warnRoleId); }
function canPerm(member){ const c=gdata(member.guild.id).config; return configReady(member.guild.id,'perm') && hasConfiguredRole(member, c.permRoleId); }
function canMod(member){ const c=gdata(member.guild.id).config; return configReady(member.guild.id,'mod') && hasConfiguredRole(member, c.modRoleId); }
async function reply(ctx, payload, ephemeral=false){
  if (ctx.isCommand?.() || ctx.isChatInputCommand?.()) return ctx.reply({ ...payload, ephemeral }).catch(()=>{});
  return ctx.reply(payload).catch(()=>{});
}
async function follow(ctx, payload, ephemeral=false){
  if (ctx.isCommand?.() || ctx.isChatInputCommand?.()) return ctx.followUp({ ...payload, ephemeral }).catch(()=>{});
  return ctx.channel.send(payload).catch(()=>{});
}
async function logTo(guild, channelId, embed){ if(!channelId) return; const ch=await guild.channels.fetch(channelId).catch(()=>null); if(ch?.isTextBased()) ch.send({ embeds:[embed] }).catch(()=>{}); }
function warnEmbed({target, mod, reason, type, number, total}){
  return new EmbedBuilder().setColor(type==='Permanent'?COLORS.perm:COLORS.warn).setTitle(`${type==='Permanent'?'🔴 Permanent Warning':'⚠️ Warning'} Issued`)
    .addFields(
      {name:'User', value:`${target} (${target.user.username})`, inline:true},
      {name:'Moderator', value:`${mod}`, inline:true},
      {name:'Type', value:type, inline:true},
      {name:'Reason', value:reason.slice(0,1024)},
      {name:`${type} Warn #`, value:String(number), inline:true},
      {name:'Total Warns', value:String(total), inline:true}
    ).setTimestamp();
}
function dmWarnEmbed(guild, reason, count, perm=false){
  return new EmbedBuilder().setColor(perm?COLORS.perm:COLORS.warn).setTitle(perm?'🔴 You have received a Permanent Warning':'⚠️ You have been warned')
  .addFields({name:'Server', value:guild.name}, {name:'Reason', value:reason}, ...(perm?[{name:'Note', value:'This is a permanent warning and can only be removed by staff with the perm warn role.'}]:[{name:'Warn Count', value:`${count} regular warn(s)`}])).setTimestamp();
}
function parseTime(s){
  if(!s) return null; const m=String(s).match(/^(\d+)(s|m|h|d|w)$/i); if(!m) return null;
  const n=Number(m[1]); const mult={s:1000,m:60000,h:3600000,d:86400000,w:604800000}[m[2].toLowerCase()];
  const ms=n*mult; return ms>0 && ms<=2419200000 ? ms : null;
}
function parseColor(c){ if(!c) return COLORS.mod; const x=c.replace('#',''); return /^[0-9a-fA-F]{6}$/.test(x)?parseInt(x,16):COLORS.mod; }
async function checkDemote(guild, member){
  const ud=userData(guild.id, member.id); const total = ud.regular.length + ud.perm.length;
  if(total < 3) return;
  const removable = member.roles.cache.filter(r=>r.id!==guild.id && !r.managed && r.editable).sort((a,b)=>b.position-a.position).first();
  if(!removable) return;
  await member.roles.remove(removable, 'Reached 3 warnings').catch(()=>{});
  const cleared = ud.regular.length; ud.regular=[]; save();
  const embed = new EmbedBuilder().setColor(COLORS.demote).setTitle('📉 Auto-Demotion: 3 Warns Reached')
    .addFields(
      {name:'User', value:`${member}` , inline:true},
      {name:'Role Removed', value:`${removable} (${removable.name})`, inline:true},
      {name:'Cleared Warns', value:`${cleared} regular warn(s) cleared`, inline:true},
      {name:'Note', value:'Permanent warnings were retained.'}
    ).setTimestamp();
  const c=gdata(guild.id).config; await logTo(guild, c.warnLogChannelId || c.modLogChannelId, embed);
  member.send({embeds:[new EmbedBuilder().setColor(COLORS.demote).setTitle('📉 You have been demoted').addFields({name:'Server', value:guild.name},{name:'Reason', value:'Reached 3 total warnings — auto-demotion applied'},{name:'Role Removed', value:removable.name}).setTimestamp()]}).catch(()=>{});
}
async function doWarn(ctx, target, reason, perm=false){
  const guild=ctx.guild, mod=ctx.member; if(!target) return reply(ctx,{content:'I cannot find that user.'},true);
  if(perm && !configReady(guild.id,'perm')) return reply(ctx,{content:missingConfigText('perm')},true);
  if(!perm && !configReady(guild.id,'warn')) return reply(ctx,{content:missingConfigText('warn')},true);
  if(!canActOn(mod,target)) return reply(ctx,{content:'You can only warn people below your highest role.'},true);
  if(perm ? !canPerm(mod) : !canWarn(mod)) return reply(ctx,{content:'You do not have permission for this warn command.'},true);
  const ud=userData(guild.id,target.id); const entry={id:nowId(), reason:cleanReason(reason), modId:mod.id, at:Date.now()};
  if(perm) ud.perm.push(entry); else ud.regular.push(entry); save();
  const total=ud.regular.length+ud.perm.length; const num=perm?ud.perm.length:ud.regular.length;
  const embed=warnEmbed({target,mod,reason:entry.reason,type:perm?'Permanent':'Regular',number:num,total});
  await reply(ctx,{embeds:[embed]});
  const c=gdata(guild.id).config; await logTo(guild, perm?(c.permLogChannelId||c.warnLogChannelId):(c.warnLogChannelId||c.modLogChannelId), embed);
  await target.send({embeds:[dmWarnEmbed(guild, entry.reason, ud.regular.length, perm)]}).catch(()=>{});
  await checkDemote(guild,target);
}
function warningsEmbed(guild, member){
  const ud=userData(guild.id,member.id);
  const regular = ud.regular.length ? ud.regular.map((w,i)=>`**#${i+1}** — <@${w.modId}> | ${w.reason}\n<t:${Math.floor(w.at/1000)}:R>`).join('\n') : 'None';
  const perm = ud.perm.length ? ud.perm.map((w,i)=>`**#${i+1}** — <@${w.modId}> | ${w.reason}\n<t:${Math.floor(w.at/1000)}:R>`).join('\n') : 'None';
  return new EmbedBuilder().setColor(COLORS.perm).setTitle(`📋 Warnings for ${member.user.username}`).setThumbnail(member.displayAvatarURL())
    .addFields({name:'📊 Summary', value:`Regular Warns: **${ud.regular.length}** | Permanent Warns: **${ud.perm.length}**`},{name:`⚠️ Regular Warnings (${ud.regular.length})`, value:regular.slice(0,1024)},{name:`🔴 Permanent Warnings (${ud.perm.length})`, value:perm.slice(0,1024)}).setTimestamp();
}
async function showWarnings(ctx,target){
  const ud=userData(ctx.guild.id,target.id);
  const rows=[];
  const buttons=[];

  for(let i=0;i<ud.regular.length;i++){
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rmwarn:${target.id}:${i+1}`)
        .setLabel(`🗑️ Remove Warn #${i+1}`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  for(let i=0;i<buttons.length;i+=5){
    rows.push(
      new ActionRowBuilder().addComponents(buttons.slice(i,i+5))
    );
  }

  await reply(ctx,{
    embeds:[warningsEmbed(ctx.guild,target)],
    components:rows
  });
}
async function removeWarn(ctx,target,num,perm=false){
  if(!target) return reply(ctx,{content:'User not found.'},true);
  if(perm && !configReady(ctx.guild.id,'perm')) return reply(ctx,{content:missingConfigText('perm')},true);
  if(!perm && !configReady(ctx.guild.id,'warn')) return reply(ctx,{content:missingConfigText('warn')},true);
  if(perm ? !canPerm(ctx.member) : !canWarn(ctx.member)) return reply(ctx,{content:'No permission.'},true);
  const ud=userData(ctx.guild.id,target.id); const arr=perm?ud.perm:ud.regular; const idx=Number(num)-1;
  if(!arr[idx]) return reply(ctx,{content:'That warn number does not exist.'},true);
  const [removed]=arr.splice(idx,1); save();
  await reply(ctx,{embeds:[new EmbedBuilder().setColor(COLORS.ok).setTitle('✅ Warning Removed').addFields({name:'User',value:`${target}`},{name:'Removed Reason',value:removed.reason},{name:'Type',value:perm?'Permanent':'Regular'}).setTimestamp()]});
}
async function modAction(ctx, action, target, reasonOrTime, maybeReason){
  if(!configReady(ctx.guild.id,'mod')) return reply(ctx,{content:missingConfigText('mod')},true);
  if(!canMod(ctx.member)) return reply(ctx,{content:'No mod permission.'},true);
  if(target && target.id && !canActOn(ctx.member,target)) return reply(ctx,{content:'You can only moderate people below your role.'},true);
  const guild=ctx.guild; let embed;
  if(action==='ban'){ await target.send(`You were banned from ${guild.name}. Reason: ${cleanReason(reasonOrTime)}`).catch(()=>{}); await target.ban({reason:cleanReason(reasonOrTime)}); embed=new EmbedBuilder().setColor(COLORS.bad).setTitle('🔨 User Banned').addFields({name:'User',value:`${target}`},{name:'Moderator',value:`${ctx.member}`},{name:'Reason',value:cleanReason(reasonOrTime)}).setTimestamp(); }
  if(action==='kick'){ await target.send(`You were kicked from ${guild.name}. Reason: ${cleanReason(reasonOrTime)}`).catch(()=>{}); await target.kick(cleanReason(reasonOrTime)); embed=new EmbedBuilder().setColor(COLORS.bad).setTitle('👢 User Kicked').addFields({name:'User',value:`${target}`},{name:'Moderator',value:`${ctx.member}`},{name:'Reason',value:cleanReason(reasonOrTime)}).setTimestamp(); }
  if(action==='mute'){ const ms=parseTime(reasonOrTime); if(!ms) return reply(ctx,{content:'Use time like 10m, 2h, 1d, max 28d.'},true); await target.timeout(ms, cleanReason(maybeReason)); embed=new EmbedBuilder().setColor(COLORS.mod).setTitle('🔇 User Muted').addFields({name:'User',value:`${target}`},{name:'Moderator',value:`${ctx.member}`},{name:'Time',value:reasonOrTime},{name:'Reason',value:cleanReason(maybeReason)}).setTimestamp(); }
  if(action==='unban'){ await guild.members.unban(target, cleanReason(reasonOrTime)); embed=new EmbedBuilder().setColor(COLORS.ok).setTitle('✅ User Unbanned').addFields({name:'User ID',value:String(target)},{name:'Moderator',value:`${ctx.member}`},{name:'Reason',value:cleanReason(reasonOrTime)}).setTimestamp(); }
  await reply(ctx,{embeds:[embed]}); await logTo(guild,gdata(guild.id).config.modLogChannelId,embed);
}
async function startConfig(ctx,type){
  if(!hasAdmin(ctx.member)) return reply(ctx,{content:'Administrator only.'},true);
  const id=`cfg:${type}:${ctx.user?.id||ctx.author.id}`;
  const row=new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${id}:log`).setPlaceholder('Select log channel').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1));
  await reply(ctx,{content:`Config step 1/2: choose the ${type} log channel.`,components:[row]},true);
}
async function handleConfigSelect(i){
  const [,type,uid,step]=i.customId.split(':'); if(i.user.id!==uid) return i.reply({content:'This config panel is not yours.',ephemeral:true});
  const g=gdata(i.guild.id); const selected=i.values[0];
  if(step==='log'){
    if(type==='warn') g.config.warnLogChannelId=selected; if(type==='perm') g.config.permLogChannelId=selected; if(type==='mod') g.config.modLogChannelId=selected; save();
    const row=new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`cfg:${type}:${uid}:role`).setPlaceholder(type==='perm'?'Select minimum perm warn role':'Select minimum role').setMinValues(1).setMaxValues(1));
    return i.update({content:'Config step 2/2: choose minimum role.',components:[row]});
  }
  if(step==='role'){
    if(type==='warn') g.config.warnRoleId=selected; if(type==='perm') g.config.permRoleId=selected; if(type==='mod') g.config.modRoleId=selected; save();
    return i.update({content:`✅ ${type} config saved.`,components:[]});
  }
}
async function startRemoveConfigs(ctx){
  if(!hasAdmin(ctx.member)) return reply(ctx,{content:'Administrator only.'},true);
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`rmcfg:${ctx.user?.id || ctx.author.id}`)
      .setPlaceholder('Choose config to remove')
      .addOptions(
        {label:'Warn config', description:'Delete warn log channel and warn role', value:'warn'},
        {label:'Permanent warn config', description:'Delete perm log channel and perm role', value:'perm'},
        {label:'Moderation config', description:'Delete mod log channel and mod role', value:'mod'}
      )
  );
  return reply(ctx,{content:'Select which config you want to remove:', components:[row]}, true);
}
async function handleRemoveConfigSelect(i){
  const [,uid]=i.customId.split(':');
  if(i.user.id!==uid) return i.reply({content:'This remove-config panel is not yours.', ephemeral:true});
  if(!hasAdmin(i.member)) return i.reply({content:'Administrator only.', ephemeral:true});
  const type=i.values[0]; const c=gdata(i.guild.id).config;
  if(type==='warn'){ c.warnLogChannelId=null; c.warnRoleId=null; }
  if(type==='perm'){ c.permLogChannelId=null; c.permRoleId=null; }
  if(type==='mod'){ c.modLogChannelId=null; c.modRoleId=null; }
  save();
  return i.update({content:`✅ ${type} config removed. Set it again before using those commands.`, components:[]});
}

function getMemberFromMention(msg, token){ const id=token?.match(/\d{17,20}/)?.[0]; return id?msg.guild.members.fetch(id).catch(()=>null):null; }

const slash = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('permwarn').setDescription('Permanent warn a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('Show warnings').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('unwarn').setDescription('Remove regular warn').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('number').setDescription('Warn number').setRequired(true)),
  new SlashCommandBuilder().setName('removepermwarn').setDescription('Remove permanent warn').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('number').setDescription('Warn number').setRequired(true)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('mute').setDescription('Timeout user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addStringOption(o=>o.setName('time').setDescription('Example: 10m, 2h, 1d').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unban').setDescription('Unban user id').addStringOption(o=>o.setName('userid').setDescription('User ID').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('setconfigwarn').setDescription('Configure warn system'), new SlashCommandBuilder().setName('setconfigperm').setDescription('Configure perm warn system'), new SlashCommandBuilder().setName('setmodconfig').setDescription('Configure moderation'),
  new SlashCommandBuilder().setName('removeconfigs').setDescription('Remove saved configs'),
  new SlashCommandBuilder().setName('embed').setDescription('Embed tools')
    .addSubcommand(s=>s.setName('say').setDescription('Bot sends an embed').addStringOption(o=>o.setName('title').setDescription('Title').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addStringOption(o=>o.setName('color').setDescription('#RRGGBB optional')))
    .addSubcommand(s=>s.setName('dm').setDescription('DM an embed to yourself plus a user or role').addStringOption(o=>o.setName('title').setDescription('Title').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addStringOption(o=>o.setName('color').setDescription('#RRGGBB optional')).addUserOption(o=>o.setName('user').setDescription('Target user')).addRoleOption(o=>o.setName('role').setDescription('Target role'))),
  new SlashCommandBuilder().setName('say').setDescription('Bot says message').addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('embedsay').setDescription('Bot sends embed').addStringOption(o=>o.setName('title').setDescription('Title').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addStringOption(o=>o.setName('color').setDescription('#RRGGBB optional')),
  new SlashCommandBuilder().setName('dm').setDescription('DM yourself plus a role or user').addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addUserOption(o=>o.setName('user').setDescription('Target user')).addRoleOption(o=>o.setName('role').setDescription('Target role')),
  new SlashCommandBuilder().setName('embeddm').setDescription('Embed DM yourself plus a role or user').addStringOption(o=>o.setName('title').setDescription('Title').setRequired(true)).addStringOption(o=>o.setName('message').setDescription('Message').setRequired(true)).addStringOption(o=>o.setName('color').setDescription('#RRGGBB optional')).addUserOption(o=>o.setName('user').setDescription('Target user')).addRoleOption(o=>o.setName('role').setDescription('Target role'))
].map(c=>c.toJSON());

client.once('ready', async()=>{
  console.log(`Logged in as ${client.user.tag}`);
  if(process.env.CLIENT_ID){ const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN); if(process.env.GUILD_ID) await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:slash}); else await rest.put(Routes.applicationCommands(process.env.CLIENT_ID),{body:slash}); console.log('Slash commands registered'); }
});
client.on('interactionCreate', async i=>{
  try{
    if(i.isStringSelectMenu() && i.customId.startsWith('rmcfg:')) return handleRemoveConfigSelect(i);
    if(i.isChannelSelectMenu()||i.isRoleSelectMenu()) return handleConfigSelect(i);
    if(i.isButton() && i.customId.startsWith('rmwarn:')){ const [,uid,num]=i.customId.split(':'); const m=await i.guild.members.fetch(uid).catch(()=>null); if(!m) return i.reply({content:'User not found.',ephemeral:true}); return removeWarn(i,m,num,false); }
    if(!i.isChatInputCommand()) return;
    const n=i.commandName;
    if(n==='warn') return doWarn(i, await i.guild.members.fetch(i.options.getUser('user').id), i.options.getString('reason'), false);
    if(n==='permwarn') return doWarn(i, await i.guild.members.fetch(i.options.getUser('user').id), i.options.getString('reason'), true);
    if(n==='warnings') return showWarnings(i, await i.guild.members.fetch(i.options.getUser('user').id));
    if(n==='unwarn') return removeWarn(i, await i.guild.members.fetch(i.options.getUser('user').id), i.options.getInteger('number'), false);
    if(n==='removepermwarn') return removeWarn(i, await i.guild.members.fetch(i.options.getUser('user').id), i.options.getInteger('number'), true);
    if(n==='ban'||n==='kick'||n==='mute') return modAction(i,n, await i.guild.members.fetch(i.options.getUser('user').id), i.options.getString(n==='mute'?'time':'reason'), i.options.getString('reason'));
    if(n==='unban') return modAction(i,'unban', i.options.getString('userid'), i.options.getString('reason'));
    if(n==='setconfigwarn') return startConfig(i,'warn'); if(n==='setconfigperm') return startConfig(i,'perm'); if(n==='setmodconfig') return startConfig(i,'mod'); if(n==='removeconfigs') return startRemoveConfigs(i);
    if(!hasAdmin(i.member) && ['say','embedsay','dm','embeddm','embed'].includes(n)) return reply(i,{content:'Administrator only.'},true);
    if(n==='embed'){
      const sub=i.options.getSubcommand();
      const msg=i.options.getString('message');
      const embed=new EmbedBuilder().setColor(parseColor(i.options.getString('color'))).setTitle(i.options.getString('title')).setDescription(msg).setTimestamp();
      if(sub==='say') return reply(i,{embeds:[embed]});
      if(sub==='dm'){
        const role=i.options.getRole('role'), user=i.options.getUser('user'); const payload={embeds:[embed]}; let sent=0;
        await i.deferReply({ephemeral:true}).catch(()=>{});
        await i.user.send(payload).catch(()=>{});
        if(user){ await user.send(payload).catch(()=>{}); sent++; }
        if(role){ await i.guild.members.fetch().catch(()=>{}); for(const [,m] of role.members){ if(!m.user.bot){ await m.send(payload).catch(()=>{}); sent++; } } }
        return i.editReply({content:`✅ Embed DM sent. Targets: ${sent} + you.`}).catch(()=>{});
      }
    }
    if(n==='say') return reply(i,{content:i.options.getString('message')});
    if(n==='embedsay') return reply(i,{embeds:[new EmbedBuilder().setColor(parseColor(i.options.getString('color'))).setTitle(i.options.getString('title')).setDescription(i.options.getString('message')).setTimestamp()]});
    if(n==='dm'||n==='embeddm'){
      const role=i.options.getRole('role'), user=i.options.getUser('user'); const msg=i.options.getString('message'); const embed=n==='embeddm'?new EmbedBuilder().setColor(parseColor(i.options.getString('color'))).setTitle(i.options.getString('title')).setDescription(msg).setTimestamp():null;
      const payload=embed?{embeds:[embed]}:{content:msg}; let sent=0;
      await i.deferReply({ephemeral:true}).catch(()=>{});
      await i.user.send(payload).catch(()=>{});
      if(user){ await user.send(payload).catch(()=>{}); sent++; }
      if(role){ await i.guild.members.fetch().catch(()=>{}); for(const [,m] of role.members){ if(!m.user.bot){ await m.send(payload).catch(()=>{}); sent++; } } }
      return i.editReply({content:`✅ DM sent. Targets: ${sent} + you.`}).catch(()=>{});
    }
  }catch(e){ console.error(e); if(i.replied||i.deferred) i.followUp({content:'Error: check bot permissions/role hierarchy.',ephemeral:true}).catch(()=>{}); else i.reply({content:'Error: check bot permissions/role hierarchy.',ephemeral:true}).catch(()=>{}); }
});
client.on('messageCreate', async msg=>{
  try{
    if(msg.author.bot || !msg.guild || !msg.content.startsWith(PREFIX)) return;
    const args=msg.content.slice(PREFIX.length).trim().split(/ +/); const cmd=args.shift()?.toLowerCase();
    if(cmd==='warn'){ const target=await getMemberFromMention(msg,args.shift()); return doWarn(msg,target,args.join(' '),false); }
    if(cmd==='permwarn' || (cmd==='perm' && args[0]?.toLowerCase()==='warn')){ if(cmd==='perm') args.shift(); const target=await getMemberFromMention(msg,args.shift()); return doWarn(msg,target,args.join(' '),true); }
    if(cmd==='warnings'){ const target=await getMemberFromMention(msg,args.shift()) || msg.member; return showWarnings(msg,target); }
    if(cmd==='unwarn'){ const target=await getMemberFromMention(msg,args.shift()); return removeWarn(msg,target,args.shift(),false); }
    if(cmd==='removepermwarn'){ const target=await getMemberFromMention(msg,args.shift()); return removeWarn(msg,target,args.shift(),true); }
    if(cmd==='ban'||cmd==='kick'){ const target=await getMemberFromMention(msg,args.shift()); return modAction(msg,cmd,target,args.join(' ')); }
    if(cmd==='mute'){ const target=await getMemberFromMention(msg,args.shift()); const time=args.shift(); return modAction(msg,'mute',target,time,args.join(' ')); }
    if(cmd==='unban'){ const id=args.shift(); return modAction(msg,'unban',id,args.join(' ')); }
    if(cmd==='setconfigwarn') return startConfig(msg,'warn'); if(cmd==='setconfigperm') return startConfig(msg,'perm'); if(cmd==='setmodconfig') return startConfig(msg,'mod'); if(cmd==='removeconfigs') return startRemoveConfigs(msg);
  }catch(e){ console.error(e); msg.reply('Error: check command format, permissions, and bot role hierarchy.').catch(()=>{}); }
});
client.login(process.env.DISCORD_TOKEN);
