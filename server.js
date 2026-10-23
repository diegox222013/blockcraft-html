"use strict";
const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {WebSocketServer,WebSocket}=require("ws");

const PORT=Number(process.env.PORT)||3000;
const HOST="0.0.0.0";
const TILE=32,WORLD_W=130,WORLD_H=72,MAX_PLAYERS=8;
const rooms=new Map();
const ROOT=path.resolve(__dirname);
const TYPES={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};

function send(ws,payload){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload))}
function rand2(s,x,y){let n=Math.sin((x+1)*127.1+(y+1)*311.7+s*74.7)*43758.5453;return n-Math.floor(n)}
function surfaceY(x,s){return Math.max(12,Math.min(31,Math.floor(22+Math.sin(x*.09+s*.0007)*2.8+Math.sin(x*.035+s*.0012)*3.8)))}
function createWorld(s){
 const world=Array.from({length:WORLD_H},(_,y)=>Array.from({length:WORLD_W},(_,x)=>{
  const sy=surfaceY(x,s);if(y<sy)return 0;const n=rand2(s,x,y);if(y===sy)return n<.035?6:1;if(y<sy+4)return 2;return n<.17?3:2;
 }));
 for(let x=5;x<WORLD_W-5;x++){if(rand2(s,x,991)>.87){const sy=surfaceY(x,s);for(let dy=-5;dy<=-2;dy++)for(let dx=-2;dx<=2;dx++){if(Math.abs(dx)+Math.abs(dy+3)<5&&sy+dy>=0&&world[sy+dy][x+dx]===0)world[sy+dy][x+dx]=5}for(let k=1;k<=3;k++)if(sy-k>=0)world[sy-k][x]=4;}}
 return world;
}
function newCode(){let code;do{code=crypto.randomBytes(4).toString("hex").slice(0,6).toUpperCase()}while(rooms.has(code));return code}
function createRoom(mode){const room={code:newCode(),mode:mode,seed:Math.floor(Math.random()*850000)+10000,world:null,blocks:Object.create(null),players:new Map(),members:new Set(),createdAt:Date.now()};room.world=createWorld(room.seed);rooms.set(room.code,room);return room}
function safeName(value){return String(value||"Player").replace(/[<>\u0000-\u001f\u007f]/g,"").trim().slice(0,16)||"Player"}
function playerArray(room){return Array.from(room.players.values()).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,color:p.color}))}
function roomPlayers(room){const list=playerArray(room);for(const member of room.members)send(member,{type:"players",players:list})}
function broadcast(room,payload,except){for(const member of room.members)if(member!==except)send(member,payload)}
function actualBlock(room,x,y){const key=x+","+y;return Object.prototype.hasOwnProperty.call(room.blocks,key)?room.blocks[key]:room.world[y][x]}
function spawnAt(seed){return{x:8*TILE,y:surfaceY(8,seed)*TILE-28}}
function removeFromRoom(ws,notify=true){
 const room=ws.room,player=ws.player;if(!room||!player)return;
 room.members.delete(ws);room.players.delete(player.id);ws.room=null;ws.player=null;
 if(notify&&room.members.size){broadcast(room,{type:"notice",message:player.name+" salió de la sala."});roomPlayers(room)}
 if(!room.members.size)rooms.delete(room.code);
}
function joinRoom(ws,msg){
 if(ws.room)removeFromRoom(ws,false);
 const mode=msg.mode==="pvp"?"pvp":"private";
 let room=null,code=String(msg.roomCode||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
 if(mode==="private"){
  if(code){room=rooms.get(code);if(!room||room.mode!=="private"){send(ws,{type:"error",message:"No existe una sala privada activa con ese código."});return}}
  else room=createRoom("private");
 }else{
  for(const candidate of rooms.values())if(candidate.mode==="pvp"&&candidate.players.size<MAX_PLAYERS){room=candidate;break}
  if(!room)room=createRoom("pvp");
 }
 if(room.players.size>=MAX_PLAYERS){send(ws,{type:"error",message:"La sala está llena. Prueba otra vez."});return}
 const id=crypto.randomUUID(),spawn=spawnAt(room.seed),colors=["#83bff0","#e89cff","#ffc877","#89e9d0","#ff9b91","#d5eb75","#9ba8ff","#f0e7c0"];
 const player={id:id,name:safeName(msg.name),x:spawn.x,y:spawn.y,hp:100,color:colors[room.players.size%colors.length],inventory:[0,8,0,0,0,0],lastMoveAt:0,lastBlockAt:0,lastAttackAt:0};
 ws.room=room;ws.player=player;room.members.add(ws);room.players.set(id,player);
 send(ws,{type:"joined",playerId:id,name:player.name,roomCode:room.code,mode:room.mode,seed:room.seed,players:playerArray(room),blocks:room.blocks,inventory:player.inventory,health:player.hp});
 roomPlayers(room);
 if(room.players.size===2)broadcast(room,{type:"notice",message:"¡Hay otro jugador en la sala!"});
}
function onMessage(ws,raw){
 let msg;try{msg=JSON.parse(raw.toString())}catch(e){send(ws,{type:"error",message:"Mensaje inválido."});return}
 if(!msg||typeof msg.type!=="string")return;
 if(msg.type==="join"){joinRoom(ws,msg);return}
 if(msg.type==="leave"){removeFromRoom(ws);return}
 const room=ws.room,player=ws.player;if(!room||!player)return;
 if(msg.type==="move"){
  const x=Number(msg.x),y=Number(msg.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const now=Date.now();if(now-player.lastMoveAt<35)return;player.lastMoveAt=now;
  player.x=Math.max(0,Math.min(WORLD_W*TILE-20,player.x+Math.max(-65,Math.min(65,x-player.x))));
  player.y=Math.max(0,Math.min(WORLD_H*TILE-40,player.y+Math.max(-85,Math.min(85,y-player.y))));
  broadcast(room,{type:"player_update",player:{id:player.id,name:player.name,x:player.x,y:player.y,hp:player.hp,color:player.color}},ws);return;
 }
 if(msg.type==="block"){
  const now=Date.now();if(now-player.lastBlockAt<80)return;player.lastBlockAt=now;
  const x=Number(msg.x),y=Number(msg.y);if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=WORLD_W||y<0||y>=WORLD_H)return;
  const distance=Math.hypot(x*TILE+TILE/2-(player.x+10),y*TILE+TILE/2-(player.y+14));
  if(distance>=TILE*5){send(ws,{type:"error",message:"Ese bloque está demasiado lejos."});return}
  const key=x+","+y,current=actualBlock(room,x,y);
  if(msg.action==="mine"){
   if(!current){send(ws,{type:"error",message:"Ahí no hay ningún bloque."});return}
   if(current<1||current>6)return;room.blocks[key]=0;player.inventory[current-1]++;
  }else if(msg.action==="place"){
   const id=Number(msg.blockId);if(!Number.isInteger(id)||id<1||id>6)return;
   if(current!==0){send(ws,{type:"error",message:"Ese espacio está ocupado."});return}
   if(!player.inventory[id-1]){send(ws,{type:"error",message:"No tienes ese bloque."});return}
   const overlap=x*TILE<player.x+20&&x*TILE+TILE>player.x&&y*TILE<player.y+28&&y*TILE+TILE>player.y;
   if(overlap){send(ws,{type:"error",message:"No puedes colocar un bloque dentro de un jugador."});return}
   room.blocks[key]=id;player.inventory[id-1]--;
  }else return;
  broadcast(room,{type:"block_update",x:x,y:y,id:room.blocks[key],actorId:player.id,actorName:player.name});
  send(ws,{type:"inventory",inventory:player.inventory});return;
 }
 if(msg.type==="attack"){
  if(room.mode!=="pvp"){send(ws,{type:"error",message:"El combate solo está habilitado en Server PvP."});return}
  const now=Date.now();if(now-player.lastAttackAt<650)return;player.lastAttackAt=now;
  let target=null,best=Infinity;
  for(const candidate of room.players.values()){if(candidate.id===player.id)continue;const d=Math.hypot(candidate.x+10-(player.x+10),candidate.y+14-(player.y+14));if(d<best){best=d;target=candidate}}
  if(!target||best>86){send(ws,{type:"notice",message:"No hay jugadores lo bastante cerca para atacar."});return}
  target.hp-=25;let dead=false,spawn=null;
  if(target.hp<=0){dead=true;target.hp=100;spawn=spawnAt(room.seed);target.x=spawn.x;target.y=spawn.y}
  broadcast(room,{type:"player_hit",attackerId:player.id,targetId:target.id,health:target.hp,dead:dead,spawn:spawn,attackerName:player.name});
  broadcast(room,{type:"player_update",player:{id:target.id,name:target.name,x:target.x,y:target.y,hp:target.hp,color:target.color}});
  return;
 }
 if(msg.type==="chat"){
  const text=String(msg.text||"").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").trim().slice(0,140);
  if(!text)return;broadcast(room,{type:"chat",id:player.id,name:player.name,text:text});return;
 }
}
const server=http.createServer((req,res)=>{
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname)}catch(e){res.writeHead(400);res.end("Bad request");return}
 if(pathname==="/healthz"){res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify({ok:true,rooms:rooms.size,players:Array.from(rooms.values()).reduce((sum,r)=>sum+r.players.size,0)}));return}
 if(pathname==="/")pathname="/index.html";
 const file=path.resolve(ROOT,"."+pathname);
 if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);res.end("Forbidden");return}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(err.code==="ENOENT"?404:500,{"Content-Type":"text/plain; charset=utf-8"});res.end(err.code==="ENOENT"?"Not found":"Internal server error");return}
  const type=TYPES[path.extname(file).toLowerCase()]||"application/octet-stream";
  res.writeHead(200,{"Content-Type":type,"X-Content-Type-Options":"nosniff","Cache-Control":path.extname(file)===".html"?"no-cache":"public, max-age=300"});res.end(data);
 });
});
const wss=new WebSocketServer({server:server,maxPayload:16*1024});
wss.on("connection",ws=>{
 ws.room=null;ws.player=null;
 ws.on("message",data=>{try{onMessage(ws,data)}catch(err){console.error("WebSocket message error:",err);send(ws,{type:"error",message:"No se pudo procesar esa acción."})}});
 ws.on("close",()=>removeFromRoom(ws));
 ws.on("error",err=>console.error("WebSocket connection error:",err.message));
});
server.listen(PORT,HOST,()=>console.log("BlockCraft server listening on "+HOST+":"+PORT));
