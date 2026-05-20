require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const Database = require('better-sqlite3');

const PREFIX = process.env.PREFIX || '+';
const db = new Database('data.sqlite');
db.exec(`
CREATE TABLE IF NOT EXISTS configs (guildId TEXT PRIMARY KEY, warnLog TEXT, permLog TEXT, permRole TEXT, modLog TEXT, modRole TEXT);
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT, userId TEXT, modId TEXT, reason TEXT, type TEXT, createdAt INTEGER);
`);

const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers,GatewayIntentBits.DirectMessages,GatewayIntentBits.GuildModeration], partials:[Partials.Channel] });

const C = { yellow:0xffd83d, red:0xed4245, orange:0xff8b1f, blue:0x57a8ff, green:0x57f287, dark:0x2b1410 };
const getCfg = gid => db.prepare('SELECT * FROM configs WHERE guildId=?').get(gid) || { guildId:gid };
const setCfg = (gid, patch) => { const old=getCfg(gid); const n={...old,...patch,guildId:gid}; db.prepare('INSERT OR REPLACE INTO configs (guildId,warnLog,permLog,permRole,modLog,modRole) VALUES (@guildId,@warnLog,@permLog,@permRole,@modLog,@modRole)').run(n); };
const addWarn = (gid, uid, mid, reason, type) => db.prepare('INSERT INTO warnings (guildId,userId,modId,reason,type,createdAt) VALUES (?,?,?,?,?,?)').run(gid,uid,mid,reason,type,Date.now()).lastInsertRowid;
const listWarns = (gid, uid, type=null) => type ? db.prepare('SELECT * FROM warnings WHERE guildId=? AND userId=? AND type=? ORDER BY id').all(gid,uid,type) : db.prepare('SELECT * FROM warnings WHERE guildId=? AND userId=? ORDER BY id').all(gid,uid);
const deleteWarnByDisplay = (gid, uid, type, num) => { const arr=listWarns(gid,uid,type); const row=arr[num-1]; if(!row) return false; db.prepare('DELETE FROM warnings WHERE id=?').run(row.id); return row; };
const clearRegular = (gid, uid) => db.prepare('DELETE FROM warnings WHERE guildId=? AND userId=? AND type="regular"').run(gid,uid);

function parseTime(t){ const m=String(t||'').match(/^(\d+)(s|m|h|d)$/i); if(!m) return null; const n=+m[1], u=m[2].toLowerCase(); return n*({s:1000,m:60000,h:3600000,d:86400000}[u]); }
function hasRole(member, roleId){ return !!roleId && member.roles.cache.has(roleId); }
function topRemovableRole(member, botMember){ return member.roles.cache.filter(r=>r.id!==member.guild.id && !r.managed && r.position < botMember.roles.highest.position).sort((a,b)=>b.position-a.position).first(); }
function canMod(member, cfg){ return member.permissions.has(PermissionsBitField.Flags.Administrator) || hasRole(member, cfg.modRole); }
function canPerm(member, cfg){ return member.permissions.has(PermissionsBitField.Flags.Administrator) || hasRole(member, cfg.permRole); }
async function sendLog(guild, channelId, embed){ const ch = channelId && await guild.channels.fetch(channelId).catch(()=>null); if(ch) ch.send({embeds:[embed]}).catch(()=>{}); }
async function dm(user, payload){ return user.send(payload).catch(()=>{}); }

function warnEmbed(title,user,mod,reason,type,regularCount,permCount){
 return new EmbedBuilder().setColor(type==='perm'?C.red:C.yellow).setTitle(title).addFields(
  {name:'User', value:`${user} (${user.username})`, inline:true},
  {name:'Moderator', value:`${mod} (${mod.username})`, inline:true},
  {name:'Type', value:type==='perm'?'🔴 Permanent':'⚠️ Regular', inline:true},
  {name:'Reason', value:reason || 'No reason'},
  {name:'Warn Count', value:`Regular: ${regularCount} | Permanent: ${permCount}`}
 ).setTimestamp();
}

async function checkDemotion(guild, member, cfg){
 const regular=listWarns(guild.id, member.id, 'regular'); const perm=listWarns(guild.id, member.id, 'perm');
 if(regular.length + perm.length < 3) return;
 const botMember = await guild.members.fetchMe(); const role = topRemovableRole(member, botMember);
 if(!role) return;
 await member.roles.remove(role, 'Reached 3 total warnings — auto-demotion').catch(()=>{});
 clearRegular(guild.id, member.id);
 const e = new EmbedBuilder().setColor(C.orange).setTitle('📉 Auto-Demotion: 3 Warns Reached').addFields(
  {name:'User', value:`${member.user} (${member.user.username})`, inline:true},
  {name:'Demoted From', value:`${role} (${role.name})`, inline:true},
  {name:'Cleared Warns', value:`${regular.length} regular warn(s) cleared`, inline:true},
  {name:'Permanent Warnings', value: perm.length ? `${perm.length} retained` : 'None'}
 ).setFooter({text:'Permanent warnings are retained'}).setTimestamp();
 await sendLog(guild, cfg.warnLog || cfg.permLog || cfg.modLog, e);
 await dm(member.user, {embeds:[new EmbedBuilder().setColor(C.orange).setTitle('📉 You have been demoted').addFields({name:'Server',value:guild.name},{name:'Reason',value:'Reached 3 total warnings — auto-demotion applied'},{name:'Role Removed',value:role.name}).setTimestamp()]});
}

async function doWarn(ctx, user, reason, type){
 const guild=ctx.guild, member=await guild.members.fetch(user.id).catch(()=>null), mod=ctx.member, cfg=getCfg(guild.id);
 if(!member) return reply(ctx,'User not found.',true);
 if(type==='perm' && !canPerm(mod,cfg)) return reply(ctx,'You need the configured permanent warn role.',true);
 if(type==='regular' && !canMod(mod,cfg)) return reply(ctx,'You need the configured mod role.',true);
 addWarn(guild.id,user.id,mod.id,reason,type);
 const reg=listWarns(guild.id,user.id,'regular').length, perm=listWarns(guild.id,user.id,'perm').length;
 const embed = warnEmbed(type==='perm'?'🔴 Permanent Warning Issued':'⚠️ Warning Issued', user, mod.user, reason, type, reg, perm);
 await sendLog(guild, type==='perm' ? (cfg.permLog||cfg.warnLog) : cfg.warnLog, embed);
 await dm(user, {embeds:[new EmbedBuilder().setColor(type==='perm'?C.red:C.yellow).setTitle(type==='perm'?'🔴 You have received a Permanent Warning':'⚠️ You have been warned').addFields({name:'Server',value:guild.name},{name:'Reason',value:reason},{name:type==='perm'?'Note':'Warn Count',value:type==='perm'?'This is a permanent warning and cannot be removed by regular moderators.':`${reg} regular warn(s)`}).setTimestamp()]});
 await reply(ctx,{embeds:[embed]});
 await checkDemotion(guild, member, cfg);
}

async function doWarnings(ctx, user){
 const guild=ctx.guild, reg=listWarns(guild.id,user.id,'regular'), perm=listWarns(guild.id,user.id,'perm');
 const fmt=(arr,type)=> arr.length ? arr.map((w,i)=>`**#${i+1}** — <@${w.modId}> | ${w.reason}\n<t:${Math.floor(w.createdAt/1000)}:R>`).join('\n') : 'None';
 const embed=new EmbedBuilder().setColor(C.red).setTitle(`📋 Warnings for ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields(
  {name:'📊 Summary', value:`Regular Warns: **${reg.length}** | Permanent Warns: **${perm.length}**`},
  {name:`⚠️ Regular Warnings (${reg.length})`, value:fmt(reg,'regular')},
  {name:`🔴 Permanent Warnings (${perm.length})`, value:fmt(perm,'perm')}
 ).setTimestamp();
 const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`remove_warn:${user.id}:1`).setLabel('Remove Regular Warn #1').setEmoji('🗑️').setStyle(ButtonStyle.Danger));
 await reply(ctx,{embeds:[embed],components:[row]});
}

async function reply(ctx, data, ephemeral=false){ if(typeof data==='string') data={content:data}; if(ctx.reply) return ctx.reply({...data, ephemeral}).catch(()=>{}); return ctx.channel.send(data).catch(()=>{}); }

client.on('interactionCreate', async i=>{
 try{
  if(i.isButton() && i.customId.startsWith('remove_warn:')){ const [,uid,num]=i.customId.split(':'); const cfg=getCfg(i.guild.id); if(!canMod(i.member,cfg)) return i.reply({content:'No permission.',ephemeral:true}); const row=deleteWarnByDisplay(i.guild.id,uid,'regular',+num); return i.reply({content:row?`Removed regular warn #${num}.`:'That warn does not exist.',ephemeral:true}); }
  if(i.isChannelSelectMenu()||i.isRoleSelectMenu()) return;
  if(!i.isChatInputCommand()) return;
  const n=i.commandName, cfg=getCfg(i.guild.id);
  const user=i.options.getUser('user'); const reason=i.options.getString('reason') || 'No reason';
  if(n==='warn') return doWarn(i,user,reason,'regular');
  if(n==='permwarn') return doWarn(i,user,reason,'perm');
  if(n==='warnings') return doWarnings(i,user);
  if(n==='unwarn'){ if(!canMod(i.member,cfg)) return reply(i,'No permission.',true); const r=deleteWarnByDisplay(i.guild.id,user.id,'regular',i.options.getInteger('number')); return reply(i,r?'Regular warn removed.':'Warn not found.',true); }
  if(n==='removepermwarn'){ if(!canPerm(i.member,cfg)) return reply(i,'No permission.',true); const r=deleteWarnByDisplay(i.guild.id,user.id,'perm',i.options.getInteger('number')); return reply(i,r?'Permanent warn removed.':'Perm warn not found.',true); }
  if(['ban','kick','mute','unban'].includes(n) && !canMod(i.member,cfg)) return reply(i,'No permission.',true);
  if(n==='ban'){ await dm(user,{content:`You were banned from ${i.guild.name}. Reason: ${reason}`}); await i.guild.members.ban(user,{reason}); await sendLog(i.guild,cfg.modLog,new EmbedBuilder().setColor(C.red).setTitle('🔨 User Banned').addFields({name:'User',value:`${user}`},{name:'Moderator',value:`${i.user}`},{name:'Reason',value:reason}).setTimestamp()); return reply(i,'Banned.',true); }
  if(n==='kick'){ const m=await i.guild.members.fetch(user.id); await dm(user,{content:`You were kicked from ${i.guild.name}. Reason: ${reason}`}); await m.kick(reason); await sendLog(i.guild,cfg.modLog,new EmbedBuilder().setColor(C.orange).setTitle('👢 User Kicked').addFields({name:'User',value:`${user}`},{name:'Moderator',value:`${i.user}`},{name:'Reason',value:reason}).setTimestamp()); return reply(i,'Kicked.',true); }
  if(n==='mute'){ const ms=parseTime(i.options.getString('time')); if(!ms) return reply(i,'Use time like 10m, 1h, 2d.',true); const m=await i.guild.members.fetch(user.id); await m.timeout(ms,reason); await dm(user,{content:`You were muted in ${i.guild.name} for ${i.options.getString('time')}. Reason: ${reason}`}); await sendLog(i.guild,cfg.modLog,new EmbedBuilder().setColor(C.blue).setTitle('🔇 User Muted').addFields({name:'User',value:`${user}`},{name:'Time',value:i.options.getString('time')},{name:'Reason',value:reason}).setTimestamp()); return reply(i,'Muted.',true); }
  if(n==='unban'){ const uid=i.options.getString('userid'); await i.guild.members.unban(uid, i.options.getString('reason')||'No reason'); await sendLog(i.guild,cfg.modLog,new EmbedBuilder().setColor(C.green).setTitle('✅ User Unbanned').addFields({name:'User ID',value:uid},{name:'Moderator',value:`${i.user}`}).setTimestamp()); return reply(i,'Unbanned.',true); }
  if(n==='say'){ await i.channel.send(i.options.getString('message')); return reply(i,'Sent.',true); }
  if(n==='embedsay'){ const color=parseInt((i.options.getString('color')||'#5865f2').replace('#',''),16); await i.channel.send({embeds:[new EmbedBuilder().setColor(color).setTitle(i.options.getString('title')).setDescription(i.options.getString('message'))]}); return reply(i,'Embed sent.',true); }
  if(n==='dm'||n==='embeddm'){ const msg=i.options.getString('message'), role=i.options.getRole('role'), target=i.options.getUser('user'); let targets=[]; if(target) targets=[target]; else if(role) targets=(await i.guild.members.fetch()).filter(m=>m.roles.cache.has(role.id)&&!m.user.bot).map(m=>m.user); else return reply(i,'Choose a user or role.',true); const payload=n==='dm'?{content:msg}:{embeds:[new EmbedBuilder().setColor(parseInt((i.options.getString('color')||'#5865f2').replace('#',''),16)).setTitle(i.options.getString('title')).setDescription(msg)]}; await dm(i.user,payload); for(const u of targets) await dm(u,payload); return reply(i,`DM sent to ${targets.length} user(s), and to you.`,true); }
  if(n==='setconfigwarn'){ setCfg(i.guild.id,{warnLog:i.options.getChannel('logchannel').id}); return reply(i,'Warn config saved.',true); }
  if(n==='setconfigperm'){ setCfg(i.guild.id,{permLog:i.options.getChannel('logchannel').id,permRole:i.options.getRole('permrole').id}); return reply(i,'Perm warn config saved.',true); }
  if(n==='setmodconfig'){ setCfg(i.guild.id,{modLog:i.options.getChannel('logchannel').id,modRole:i.options.getRole('modrole').id}); return reply(i,'Mod config saved.',true); }
 }catch(e){ console.error(e); if(i.reply) i.reply({content:'Error: '+e.message,ephemeral:true}).catch(()=>{}); }
});

client.on('messageCreate', async msg=>{
 if(msg.author.bot || !msg.guild || !msg.content.startsWith(PREFIX)) return;
 const raw=msg.content.slice(PREFIX.length).trim(); const [cmdRaw,...args]=raw.split(/\s+/); const cmd=cmdRaw.toLowerCase(); const cfg=getCfg(msg.guild.id);
 const fake={guild:msg.guild, member:msg.member, user:msg.author, channel:msg.channel};
 try{
  if(cmd==='warn'){ const u=msg.mentions.users.first(); if(!u) return msg.reply('Mention a user.'); const reason=args.slice(1).join(' ')||'No reason'; return doWarn(fake,u,reason,'regular'); }
  if(cmd==='permwarn' || (cmd==='perm' && args[0]?.toLowerCase()==='warn')){ const offset=cmd==='perm'?1:0; const u=msg.mentions.users.first(); if(!u) return msg.reply('Mention a user.'); const reason=args.slice(offset+1).join(' ')||'No reason'; return doWarn(fake,u,reason,'perm'); }
  if(cmd==='warnings'){ const u=msg.mentions.users.first()||msg.author; return doWarnings(fake,u); }
  if(cmd==='unwarn'){ if(!canMod(msg.member,cfg)) return msg.reply('No permission.'); const u=msg.mentions.users.first(); const n=parseInt(args[1]); const r=deleteWarnByDisplay(msg.guild.id,u?.id,'regular',n); return msg.reply(r?'Regular warn removed.':'Warn not found.'); }
  if(cmd==='removepermwarn'){ if(!canPerm(msg.member,cfg)) return msg.reply('No permission.'); const u=msg.mentions.users.first(); const n=parseInt(args[1]); const r=deleteWarnByDisplay(msg.guild.id,u?.id,'perm',n); return msg.reply(r?'Permanent warn removed.':'Perm warn not found.'); }
  if(cmd==='ban'){ if(!canMod(msg.member,cfg)) return msg.reply('No permission.'); const u=msg.mentions.users.first(); const reason=args.slice(1).join(' ')||'No reason'; await dm(u,{content:`You were banned from ${msg.guild.name}. Reason: ${reason}`}); await msg.guild.members.ban(u,{reason}); await sendLog(msg.guild,cfg.modLog,new EmbedBuilder().setColor(C.red).setTitle('🔨 User Banned').addFields({name:'User',value:`${u}`},{name:'Moderator',value:`${msg.author}`},{name:'Reason',value:reason}).setTimestamp()); return msg.reply('Banned.'); }
  if(cmd==='kick'){ if(!canMod(msg.member,cfg)) return msg.reply('No permission.'); const u=msg.mentions.users.first(); const m=await msg.guild.members.fetch(u.id); const reason=args.slice(1).join(' ')||'No reason'; await dm(u,{content:`You were kicked from ${msg.guild.name}. Reason: ${reason}`}); await m.kick(reason); return msg.reply('Kicked.'); }
  if(cmd==='mute'){ if(!canMod(msg.member,cfg)) return msg.reply('No permission.'); const u=msg.mentions.users.first(); const ms=parseTime(args[1]); if(!ms) return msg.reply('Use time like 10m, 1h, 2d.'); const m=await msg.guild.members.fetch(u.id); const reason=args.slice(2).join(' ')||'No reason'; await m.timeout(ms,reason); return msg.reply('Muted.'); }
  if(cmd==='unban'){ if(!canMod(msg.member,cfg)) return msg.reply('No permission.'); await msg.guild.members.unban(args[0], args.slice(1).join(' ')||'No reason'); return msg.reply('Unbanned.'); }
  if(['setconfigwarn','setconfigperm','setmodconfig'].includes(cmd)){ if(!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) return msg.reply('Admin only.'); return startConfig(msg,cmd); }
 }catch(e){ console.error(e); msg.reply('Error: '+e.message).catch(()=>{}); }
});

async function startConfig(msg, cmd){
 const first = cmd==='setconfigwarn' ? 'Choose warn log channel' : cmd==='setconfigperm' ? 'Choose permanent warn log channel' : 'Choose moderation log channel';
 const row = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`cfgchan:${cmd}`).setPlaceholder(first).setChannelTypes(ChannelType.GuildText));
 const sent = await msg.reply({content:first, components:[row]});
 const col=sent.createMessageComponentCollector({time:60000,max:1});
 col.on('collect', async inter=>{
  if(inter.user.id!==msg.author.id) return inter.reply({content:'This setup is not for you.',ephemeral:true});
  const ch=inter.values[0];
  if(cmd==='setconfigwarn'){ setCfg(msg.guild.id,{warnLog:ch}); return inter.update({content:'Warn log channel saved.',components:[]}); }
  const roleRow=new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`cfgrole:${cmd}:${ch}`).setPlaceholder(cmd==='setconfigperm'?'Choose permanent warn role':'Choose minimum mod role'));
  await inter.update({content:'Now choose the role.',components:[roleRow]});
  const col2=sent.createMessageComponentCollector({time:60000,max:1});
  col2.on('collect', async r=>{ const role=r.values[0]; if(cmd==='setconfigperm') setCfg(msg.guild.id,{permLog:ch,permRole:role}); else setCfg(msg.guild.id,{modLog:ch,modRole:role}); r.update({content:'Config saved.',components:[]}); });
 });
}

client.once('ready',()=>console.log(`Logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
