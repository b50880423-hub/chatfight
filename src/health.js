import http from 'node:http';
import { getISTDayKey, getWeekKey } from './rankingLogic.js';

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function modeFields(mode) {
  if (mode === 'weekly') return { field: '$weeklyMessageCount', match: { weekKey: getWeekKey() } };
  if (mode === 'total') return { field: '$messageCount', match: {} };
  return { field: '$dailyMessageCount', match: { dayKey: getISTDayKey() } };
}

function shell(title, body, script = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  body{margin:0;background:#0b1020;color:#eef2ff;font-family:Inter,Arial,sans-serif}header{padding:38px 7%;background:linear-gradient(135deg,#182449,#512b81)}h1{margin:0;font-size:42px}.sub{opacity:.75;margin-top:8px}.wrap{max-width:1150px;margin:auto;padding:25px 7%}.stats,.grid{display:grid;gap:16px}.stats{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:-20px}.card{background:#131b31;border:1px solid #263252;border-radius:18px;padding:20px;box-shadow:0 10px 30px #0003}.num{font-size:28px;font-weight:800}.grid{grid-template-columns:repeat(auto-fit,minmax(330px,1fr));margin-top:20px}.tabs{display:flex;gap:8px;margin:20px 0;flex-wrap:wrap}.tabs button{border:0;border-radius:20px;padding:9px 16px;background:#243153;color:#fff;cursor:pointer}.tabs button.active{background:#7c4dff}ol{margin:0;padding-left:28px}.row{padding:12px 4px;border-bottom:1px solid #263252;display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#9aa7c7;font-size:13px}.name{font-weight:650}a{color:#9dc1ff;text-decoration:none}.group-link,.user-link{display:block;border-radius:12px;padding:2px 10px;margin:0 -10px}.group-link:hover,.user-link:hover{background:#1b2645}.back{display:inline-block;margin-bottom:18px;padding:10px 15px;border-radius:12px;background:#243153;color:#fff}.empty{color:#9aa7c7;padding:18px 0}@media(max-width:600px){h1{font-size:32px}.wrap{padding:20px 5%}}
  </style></head><body>${body}<script>${script}</script></body></html>`;
}

function pageHtml() {
  const body = `<header><h1>⚔️ ChatFight Rankings</h1><div class="sub">Live global activity, users and groups</div></header><main class="wrap"><section id="stats" class="stats"></section><div class="tabs"><button class="active" data-mode="today">Today</button><button data-mode="weekly">Weekly</button><button data-mode="total">All Time</button></div><section class="grid"><div class="card"><h2>🏆 Top Users</h2><div id="users">Loading...</div></div><div class="card"><h2>👥 Top Groups</h2><div id="groups">Loading...</div></div></section></main>`;
  const script = `let mode='today';const fmt=n=>Number(n||0).toLocaleString();const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));async function load(){try{let d=await fetch('/api/dashboard?mode='+mode).then(r=>r.json());stats.innerHTML=[['👥 Total Users',d.stats.users],['💬 Total Messages',d.stats.messages],['🏘️ Groups',d.stats.groups]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="num">'+fmt(x[1])+'</div></div>').join('');users.innerHTML=d.users.length?'<ol>'+d.users.map(x=>'<li class="row"><a class="user-link" href="/user/'+encodeURIComponent(x.userId)+'"><span class="name">'+esc(x.displayName||x.userName||'Unknown')+'</span><div class="muted">Active in '+fmt(x.groupCount)+' group(s) • Click for profile</div></a><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>':'<div class="empty">No users found for this period.</div>';groups.innerHTML=d.groups.length?'<ol>'+d.groups.map(x=>'<li class="row"><a class="group-link" href="/group/'+encodeURIComponent(x.groupId)+'"><span class="name">'+esc(x.groupName||'Unknown Group')+'</span><div class="muted">Tracked users: '+fmt(x.activeUsers)+(x.memberCount?' • Members: '+fmt(x.memberCount):'')+' • Click for details</div></a><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>':'<div class="empty">No groups found for this period.</div>'}catch(e){users.textContent=groups.textContent='Could not load rankings.'}}document.querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load()});load();setInterval(load,30000);`;
  return shell('ChatFight Rankings', body, script);
}

function groupPageHtml() {
  const body = `<header><h1 id="title">👥 Group Details</h1><div id="subtitle" class="sub">Loading group information...</div></header><main class="wrap"><a class="back" href="/">← Back to Rankings</a><section id="stats" class="stats"></section><div class="tabs"><button class="active" data-mode="today">Today</button><button data-mode="weekly">Weekly</button><button data-mode="total">All Time</button></div><section class="grid"><div class="card"><h2>🔥 Top Users in This Group</h2><div id="users">Loading...</div></div><div class="card"><h2>📊 Group Activity</h2><div id="activity">Loading...</div></div></section></main>`;
  const script = `const groupId=decodeURIComponent(location.pathname.split('/').pop());let mode='today';const fmt=n=>Number(n||0).toLocaleString();const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));async function load(){try{const r=await fetch('/api/group/'+encodeURIComponent(groupId)+'?mode='+mode);if(!r.ok)throw new Error('Not found');const d=await r.json();title.textContent='👥 '+(d.group.groupName||'Group Details');subtitle.textContent='Live activity and member statistics';stats.innerHTML=[['👥 Members',d.group.memberCount],['🟢 Tracked Users',d.group.activeUsers],['💬 Total Messages',d.group.totalMessages],['🏆 Global Rank','#'+d.group.rank]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="num">'+(String(x[1]).startsWith('#')?x[1]:fmt(x[1]))+'</div></div>').join('');users.innerHTML=d.users.length?'<ol>'+d.users.map((x,i)=>'<li class="row"><a class="user-link" href="/user/'+encodeURIComponent(x.userId)+'"><span class="name">#'+(i+1)+' '+esc(x.displayName||x.userName||'Unknown')+'</span><div class="muted">All-time messages: '+fmt(x.messageCount)+' • Click for profile</div></a><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>':'<div class="empty">No users found for this period.</div>';activity.innerHTML='<div class="row"><span>Today</span><b>'+fmt(d.activity.today)+'</b></div><div class="row"><span>This Week</span><b>'+fmt(d.activity.weekly)+'</b></div><div class="row"><span>All Time</span><b>'+fmt(d.activity.total)+'</b></div>'+(d.group.groupLink?'<p><a href="'+esc(d.group.groupLink)+'" target="_blank" rel="noopener">Open Telegram Group ↗</a></p>':'')}catch(e){title.textContent='Group not found';subtitle.textContent='This group may not have tracked data yet.';users.textContent=activity.textContent='No data available.'}}document.querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load()});load();`;
  return shell('ChatFight Group Details', body, script);
}

function userPageHtml() {
  const body = `<header><h1 id="title">👤 User Profile</h1><div id="subtitle" class="sub">Loading user statistics...</div></header><main class="wrap"><a class="back" href="/">← Back to Rankings</a><section id="stats" class="stats"></section><div class="tabs"><button class="active" data-mode="today">Today</button><button data-mode="weekly">Weekly</button><button data-mode="total">All Time</button></div><section class="grid"><div class="card"><h2>👥 Groups & Activity</h2><div id="groups">Loading...</div></div><div class="card"><h2>📊 User Activity</h2><div id="activity">Loading...</div></div></section></main>`;
  const script = `const userId=decodeURIComponent(location.pathname.split('/').pop());let mode='today';const fmt=n=>Number(n||0).toLocaleString();const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));async function load(){try{const r=await fetch('/api/user/'+encodeURIComponent(userId)+'?mode='+mode);if(!r.ok)throw new Error('Not found');const d=await r.json();const name=d.user.displayName||d.user.userName||'User';title.textContent='👤 '+name;subtitle.textContent=d.user.userName?'@'+d.user.userName:'ChatFight activity profile';stats.innerHTML=[['💬 Total Messages',d.user.totalMessages],['👥 Active Groups',d.user.groupCount],['🏆 Global Rank','#'+d.user.rank],['📅 Current Period',d.user.periodValue]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="num">'+(String(x[1]).startsWith('#')?x[1]:fmt(x[1]))+'</div></div>').join('');groups.innerHTML=d.groups.length?'<ol>'+d.groups.map((x,i)=>'<li class="row"><a class="group-link" href="/group/'+encodeURIComponent(x.groupId)+'"><span class="name">#'+(i+1)+' '+esc(x.groupName||'Unknown Group')+'</span><div class="muted">All-time: '+fmt(x.messageCount)+(x.groupLink?' • Telegram group available':'')+'</div></a><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>':'<div class="empty">No groups found for this user.</div>';activity.innerHTML='<div class="row"><span>Today</span><b>'+fmt(d.activity.today)+'</b></div><div class="row"><span>This Week</span><b>'+fmt(d.activity.weekly)+'</b></div><div class="row"><span>All Time</span><b>'+fmt(d.activity.total)+'</b></div>'}catch(e){title.textContent='User not found';subtitle.textContent='This user may not have tracked data yet.';groups.textContent=activity.textContent='No data available.'}}document.querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load()});load();`;
  return shell('ChatFight User Profile', body, script);
}

export function createHealthServer(getDb) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, { status: 'ok', service: 'chatfight' });
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(pageHtml()); }
      if (req.method === 'GET' && /^\/group\/[^/]+$/.test(url.pathname)) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(groupPageHtml()); }
      if (req.method === 'GET' && /^\/user\/[^/]+$/.test(url.pathname)) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(userPageHtml()); }
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const db = await getDb(); const users = db.collection('group_users'); const groupStats = db.collection('group_stats');
        const mode = ['today','weekly','total'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'today';
        const {field, match} = modeFields(mode);
        const [userRows, groupRows, userCount, messageAgg, groupCount] = await Promise.all([
          users.aggregate([{ $match: match },{ $group:{_id:'$userId',displayName:{$last:'$displayName'},userName:{$last:'$userName'},value:{$sum:field},groupCount:{$sum:1}}},{ $sort:{value:-1}},{ $limit:100}]).toArray(),
          users.aggregate([{ $match: match },{ $group:{_id:'$groupId',groupName:{$last:'$groupName'},value:{$sum:field},activeUsers:{$sum:1}}},{ $sort:{value:-1}},{ $limit:100}]).toArray(),
          users.aggregate([{ $group:{_id:'$userId'}},{ $count:'n'}]).toArray(),
          users.aggregate([{ $group:{_id:null,n:{$sum:'$messageCount'}} }]).toArray(),
          users.aggregate([{ $group:{_id:'$groupId'}},{ $count:'n'}]).toArray(),
        ]);
        const statsDocs = await groupStats.find({ groupId: { $in: groupRows.map(x=>x._id) } }).toArray(); const members = new Map(statsDocs.map(x=>[String(x.groupId),x.memberCount]));
        return json(res,{mode,stats:{users:userCount[0]?.n||0,messages:messageAgg[0]?.n||0,groups:groupCount[0]?.n||0},users:userRows.map(x=>({...x,userId:x._id})),groups:groupRows.map(x=>({...x,groupId:x._id,memberCount:members.get(String(x._id)) ?? null}))});
      }
      const groupApiMatch = url.pathname.match(/^\/api\/group\/([^/]+)$/);
      if (req.method === 'GET' && groupApiMatch) {
        const groupId = decodeURIComponent(groupApiMatch[1]); const db = await getDb(); const users = db.collection('group_users'); const groupStats = db.collection('group_stats');
        const mode = ['today','weekly','total'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'today'; const {field, match} = modeFields(mode);
        const base = await users.findOne({ groupId: String(groupId) }); if (!base) return json(res,{error:'Group not found'},404);
        const groupQuery = { ...match, groupId: String(groupId) };
        const [topUsers, totals, statsDoc, rankRows] = await Promise.all([
          users.aggregate([{ $match:groupQuery },{$sort:{messageCount:-1}},{$limit:100},{$project:{displayName:1,userName:1,userId:1,messageCount:1,dailyMessageCount:1,weeklyMessageCount:1,value:field}}]).toArray(),
          users.aggregate([{ $match:{groupId} },{$group:{_id:null,total:{$sum:'$messageCount'},today:{$sum:{$cond:[{$eq:['$dayKey',getISTDayKey()]},'$dailyMessageCount',0]}},weekly:{$sum:{$cond:[{$eq:['$weekKey',getWeekKey()]},'$weeklyMessageCount',0]}}}}]).toArray(),
          groupStats.findOne({ groupId: String(groupId) }), users.aggregate([{$group:{_id:'$groupId',total:{$sum:'$messageCount'}}},{$sort:{total:-1}}]).toArray(),
        ]);
        const rank = rankRows.findIndex(x=>String(x._id)===String(groupId))+1; const activeUsers = await users.countDocuments({ groupId: String(groupId) }); const t=totals[0]||{};
        return json(res,{mode,group:{groupId,groupName:statsDoc?.groupName||base.groupName||'Unknown Group',groupLink:statsDoc?.groupLink||base.groupLink||null,memberCount:statsDoc?.memberCount ?? null,activeUsers,totalMessages:t.total||0,rank:rank||'-'},activity:{today:t.today||0,weekly:t.weekly||0,total:t.total||0},users:topUsers});
      }
      const userApiMatch = url.pathname.match(/^\/api\/user\/([^/]+)$/);
      if (req.method === 'GET' && userApiMatch) {
        const userId = decodeURIComponent(userApiMatch[1]); const db = await getDb(); const users = db.collection('group_users');
        const mode = ['today','weekly','total'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'today'; const {field} = modeFields(mode);
        const userMatch = { $expr: { $eq: [{ $toString: '$userId' }, userId] } };
        const [baseRows, groups, totals, rankRows] = await Promise.all([
          users.aggregate([{ $match:userMatch },{$sort:{updatedAt:-1}},{$limit:1}]).toArray(),
          users.aggregate([{ $match:userMatch },{$project:{groupId:1,groupName:1,groupLink:1,messageCount:1,dailyMessageCount:1,weeklyMessageCount:1,value:field}},{$sort:{messageCount:-1}},{$limit:100}]).toArray(),
          users.aggregate([{ $match:userMatch },{$group:{_id:null,total:{$sum:'$messageCount'},today:{$sum:{$cond:[{$eq:['$dayKey',getISTDayKey()]},'$dailyMessageCount',0]}},weekly:{$sum:{$cond:[{$eq:['$weekKey',getWeekKey()]},'$weeklyMessageCount',0]}}}}]).toArray(),
          users.aggregate([{$group:{_id:'$userId',total:{$sum:'$messageCount'}}},{$sort:{total:-1}}]).toArray(),
        ]);
        const base=baseRows[0]; if (!base) return json(res,{error:'User not found'},404); const t=totals[0]||{};
        const rank=rankRows.findIndex(x=>String(x._id)===String(userId))+1; const periodValue=mode==='today'?(t.today||0):mode==='weekly'?(t.weekly||0):(t.total||0);
        return json(res,{mode,user:{userId,displayName:base.displayName||null,userName:base.userName||null,totalMessages:t.total||0,groupCount:groups.length,rank:rank||'-',periodValue},activity:{today:t.today||0,weekly:t.weekly||0,total:t.total||0},groups});
      }
      res.writeHead(404); res.end('Not found');
    } catch (e) { console.error('[Web]',e); json(res,{error:'Server error'},500); }
  });
}
