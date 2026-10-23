(()=> {
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("game-canvas"),ctx=canvas.getContext("2d");
const ui={launcher:$("launcher"),game:$("game-ui"),overlay:$("connecting-overlay"),title:$("connecting-title"),copy:$("connecting-copy"),status:$("server-status"),error:$("launcher-error"),name:$("player-name"),code:$("room-code"),toast:$("toast"),hotbar:$("hotbar"),total:$("inventory-total"),health:$("health-value"),healthFill:$("health-fill"),session:$("session-label"),day:$("day-label"),hudName:$("hud-name"),avatar:$("avatar-dot"),players:$("players-counter"),playersCount:$("players-count"),chat:$("chat-panel"),chatLog:$("chat-log"),mobileAttack:$("mobile-attack")};
const TILE=32,WORLD_W=130,WORLD_H=72;
const blocks=[
{id:1,name:"Pasto",color:"#5e9e43",top:"#85c95a"},
{id:2,name:"Tierra",color:"#875533",top:"#a36d45"},
{id:3,name:"Piedra",color:"#747e84",top:"#a3adb1"},
{id:4,name:"Madera",color:"#88572f",top:"#bd864c"},
{id:5,name:"Hojas",color:"#2f743b",top:"#4b9d4d"},
{id:6,name:"Arena",color:"#cfb879",top:"#f1dda0"}
];
let world=[],edits=Object.create(null),seed=2341,player={x:0,y:0,w:20,h:28,vx:0,vy:0,onGround:false,hp:100},inventory=[0,8,0,0,0,0],selected=0;
let camera={x:0,y:0},mouse={x:innerWidth*.58,y:innerHeight*.5},keys=Object.create(null),remotePlayers=new Map();
let active=false,online=false,gameMode="solo",playerId=null,roomCode="",playerName="Player",socket=null,socketPromise=null,pendingJoin=null,moveTimer=0,dayClock=0,lastFrame=0,lastAttack=0,toastTimer=0,blockTimer=0,particles=[];
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rand2(s,x,y){let n=Math.sin((x+1)*127.1+(y+1)*311.7+s*74.7)*43758.5453;return n-Math.floor(n)}
function surfaceY(x,s){return clamp(Math.floor(22+Math.sin(x*.09+s*.0007)*2.8+Math.sin(x*.035+s*.0012)*3.8),12,31)}
function generateWorld(s){
 seed=s;world=Array.from({length:WORLD_H},(_,y)=>Array.from({length:WORLD_W},(_,x)=>{
 const sy=surfaceY(x,s);if(y<sy)return 0;const n=rand2(s,x,y);if(y===sy)return n<.035?6:1;if(y<sy+4)return 2;return n<.17?3:2;
 }));
 for(let x=5;x<WORLD_W-5;x++){if(rand2(s,x,991)>.87){const sy=surfaceY(x,s);for(let dy=-5;dy<=-2;dy++)for(let dx=-2;dx<=2;dx++){if(Math.abs(dx)+Math.abs(dy+3)<5&&sy+dy>=0&&world[sy+dy][x+dx]===0)world[sy+dy][x+dx]=5}for(let k=1;k<=3;k++)if(sy-k>=0)world[sy-k][x]=4;}}
}
function blockAt(x,y){if(x<0||x>=WORLD_W||y>=WORLD_H)return 3;if(y<0)return 0;const key=x+","+y;return Object.prototype.hasOwnProperty.call(edits,key)?edits[key]:world[y][x]}
function writeBlock(x,y,id){if(x>=0&&x<WORLD_W&&y>=0&&y<WORLD_H)edits[x+","+y]=id}
function collides(x,y){const l=Math.floor(x/TILE),r=Math.floor((x+player.w-1)/TILE),t=Math.floor(y/TILE),b=Math.floor((y+player.h-1)/TILE);for(let yy=t;yy<=b;yy++)for(let xx=l;xx<=r;xx++)if(blockAt(xx,yy)!==0)return true;return false}
function spawnPlayer(){player={x:8*TILE,y:surfaceY(8,seed)*TILE-28,w:20,h:28,vx:0,vy:0,onGround:false,hp:100};camera.x=0;camera.y=0}
function showToast(text){ui.toast.textContent=text;ui.toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove("show"),2100)}
function setStatus(text,on){ui.status.classList.toggle("online",!!on);ui.status.classList.toggle("offline",on===false);ui.status.lastChild.textContent=" "+text}
function playerList(){return Array.from(remotePlayers.values())}
function countPlayers(n){ui.playersCount.textContent=String(n);ui.players.classList.toggle("hidden",!online)}
function updateHud(){ui.total.textContent=String(inventory.reduce((a,b)=>a+b,0));ui.health.textContent=String(player.hp);ui.healthFill.style.width=clamp(player.hp,0,100)+"%"}
function updateHotbar(){
 ui.hotbar.innerHTML="";
 blocks.forEach((b,i)=>{const el=document.createElement("button");el.type="button";el.className="hotbar-slot"+(i===selected?" selected":"");el.setAttribute("aria-label",(i+1)+": "+b.name+", "+(inventory[i]||0));el.title=(i+1)+": "+b.name;
 const num=document.createElement("span");num.className="slot-number";num.textContent=String(i+1);
 const icon=document.createElement("span");icon.className="block-icon";icon.style.background="linear-gradient(135deg,"+b.top+" 0 35%,"+b.color+" 36% 100%)";
 const label=document.createElement("span");label.className="slot-count";label.textContent=inventory[i]||"";
 el.append(num,icon,label);el.addEventListener("click",()=>{selected=i;updateHotbar()});ui.hotbar.appendChild(el);
 });updateHud();
}
function showLauncherError(s){ui.error.textContent=s||""}
function showConnecting(title,copy){ui.overlay.classList.remove("hidden");ui.title.textContent=title||"Conectando…";ui.copy.textContent=copy||"Preparando tu mundo"}
function hideConnecting(){ui.overlay.classList.add("hidden")}
function openSocket(){
 if(socket&&socket.readyState===WebSocket.OPEN)return Promise.resolve(socket);
 if(socketPromise)return socketPromise;
 if(location.protocol==="file:"||!location.host)return Promise.reject(new Error("Abre el juego desde el servidor Node.js para usar el modo online."));
 const protocol=location.protocol==="https:"?"wss:":"ws:";
 socketPromise=new Promise((resolve,reject)=>{
  let settled=false;const ws=new WebSocket(protocol+"//"+location.host);socket=ws;
  const timer=setTimeout(()=>{if(!settled){settled=true;try{ws.close()}catch(e){}reject(new Error("El servidor no respondió. Revisa el despliegue de Render."));}},8000);
  ws.onopen=()=>{if(!settled){settled=true;clearTimeout(timer);setStatus("Servidor conectado",true);resolve(ws)}};
  ws.onerror=()=>{setStatus("Servidor sin conexión",false);if(!settled){settled=true;clearTimeout(timer);reject(new Error("No se pudo conectar al servidor multijugador."))}};
  ws.onmessage=event=>{let data;try{data=JSON.parse(event.data)}catch(e){return}handleMessage(data)};
  ws.onclose=()=>{setStatus("Servidor sin conexión",false);socket=null;socketPromise=null;if(online){online=false;showToast("Se perdió la conexión con el servidor.");ui.chat.classList.add("hidden");ui.mobileAttack.classList.add("hidden");}};
 });
 return socketPromise;
}
function send(data){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data))}
function joinOnline(mode,code){
 showLauncherError("");playerName=(ui.name.value.trim()||"Player").slice(0,16);ui.name.value=playerName;showConnecting(mode==="pvp"?"Buscando partida…":"Creando sala…",mode==="pvp"?"Buscando una sala pública disponible":"Conectando al servidor multijugador");
 openSocket().then(ws=>{
  pendingJoin={};pendingJoin.timer=setTimeout(()=>{if(pendingJoin){pendingJoin=null;hideConnecting();showLauncherError("El servidor tardó demasiado en responder.");}},9000);
  send({type:"join",mode:mode,roomCode:(code||"").trim().toUpperCase(),name:playerName});
 }).catch(err=>{hideConnecting();showLauncherError(err.message);setStatus("Servidor sin conexión",false)});
}
function handleMessage(msg){
 if(msg.type==="joined"){
  if(pendingJoin&&pendingJoin.timer)clearTimeout(pendingJoin.timer);pendingJoin=null;
  online=true;playerId=msg.playerId;gameMode=msg.mode;roomCode=msg.roomCode;playerName=msg.name||playerName;
  edits=Object.assign(Object.create(null),msg.blocks||{});generateWorld(msg.seed||2341);
  inventory=Array.isArray(msg.inventory)?msg.inventory.slice(0,6):[0,8,0,0,0,0];while(inventory.length<6)inventory.push(0);
  player.hp=msg.health||100;spawnPlayer();
  remotePlayers.clear();(msg.players||[]).forEach(p=>{if(p.id===playerId){player.x=p.x;player.y=p.y;player.hp=p.hp||100}else remotePlayers.set(p.id,Object.assign({},p,{rx:p.x,ry:p.y}))});
  active=true;ui.launcher.classList.add("hidden");ui.game.classList.remove("hidden");hideConnecting();ui.session.textContent=gameMode==="pvp"?"SERVER PVP":"SALA PRIVADA";ui.hudName.textContent=playerName;ui.avatar.textContent=playerName.slice(0,1).toUpperCase();ui.chat.classList.remove("hidden");ui.mobileAttack.classList.toggle("hidden",gameMode!=="pvp");
  $("world-label").textContent="SALA "+roomCode;countPlayers((msg.players||[]).length);updateHotbar();showToast((gameMode==="pvp"?"Entraste a PvP":"Sala privada creada")+" · Código "+roomCode);setStatus("Conectado a "+roomCode,true);return;
 }
 if(msg.type==="error"){
  const message=msg.message||"Ocurrió un error.";if(pendingJoin){clearTimeout(pendingJoin.timer);pendingJoin=null;hideConnecting();showLauncherError(message)}else showToast(message);return;
 }
 if(msg.type==="players"){
  remotePlayers.clear();(msg.players||[]).forEach(p=>{if(p.id!==playerId)remotePlayers.set(p.id,Object.assign({},p,{rx:p.x,ry:p.y}))});countPlayers((msg.players||[]).length);return;
 }
 if(msg.type==="player_update"){
  const p=msg.player;if(!p||p.id===playerId)return;const old=remotePlayers.get(p.id);remotePlayers.set(p.id,Object.assign({},old||{},p,{rx:old?old.rx:p.x,ry:old?old.ry:p.y}));return;
 }
 if(msg.type==="block_update"){writeBlock(msg.x,msg.y,msg.id);if(msg.actorId!==playerId)showToast((msg.actorName||"Otro jugador")+" modificó un bloque");return}
 if(msg.type==="inventory"){inventory=msg.inventory||inventory;updateHotbar();return}
 if(msg.type==="player_hit"){
  const target=msg.targetId===playerId;if(target){player.hp=msg.health;updateHud();showToast(msg.dead?"¡Te han derrotado! Reapareciste.":"¡Te han golpeado! -25 salud");if(msg.dead&&msg.spawn){player.x=msg.spawn.x;player.y=msg.spawn.y;player.vx=0;player.vy=0}}
  const victim=remotePlayers.get(msg.targetId);if(victim){victim.hp=msg.health;if(msg.dead&&msg.spawn){victim.x=msg.spawn.x;victim.y=msg.spawn.y;victim.rx=victim.x;victim.ry=victim.y}}
  if(msg.attackerId===playerId&&!target)showToast(msg.dead?"¡Eliminación! +1 aura":"Golpe acertado");return;
 }
 if(msg.type==="chat"){appendChat(msg.name||"Player",msg.text||"",false);return}
 if(msg.type==="notice"){appendChat("",msg.message||"",true);return}
}
function appendChat(name,text,system){
 const p=document.createElement("p");if(system){p.className="chat-system";p.textContent=text}else{const n=document.createElement("span");n.className="chat-name";n.textContent=name+": ";p.append(n,document.createTextNode(text))}
 ui.chatLog.appendChild(p);while(ui.chatLog.children.length>25)ui.chatLog.removeChild(ui.chatLog.firstChild);ui.chatLog.scrollTop=ui.chatLog.scrollHeight;
}
function resetForSolo(){
 if(socket){try{send({type:"leave"});socket.close()}catch(e){}}
 socket=null;socketPromise=null;pendingJoin=null;online=false;playerId=null;roomCode="";gameMode="solo";remotePlayers.clear();edits=Object.create(null);
 playerName=(ui.name.value.trim()||"Player").slice(0,16);seed=Math.floor(Math.random()*900000)+1000;generateWorld(seed);inventory=[0,8,0,0,0,0];selected=0;spawnPlayer();player.hp=100;dayClock=0;active=true;
 ui.launcher.classList.add("hidden");ui.game.classList.remove("hidden");hideConnecting();ui.session.textContent="MODO INDIVIDUAL";ui.hudName.textContent=playerName;ui.avatar.textContent=playerName.slice(0,1).toUpperCase();ui.chat.classList.add("hidden");ui.mobileAttack.classList.add("hidden");countPlayers(0);updateHotbar();showToast("Mundo nuevo generado. ¡A construir!");
}
function leaveGame(){active=false;keys=Object.create(null);if(socket){try{send({type:"leave"});socket.close()}catch(e){}}socket=null;socketPromise=null;pendingJoin=null;online=false;playerId=null;roomCode="";remotePlayers.clear();ui.game.classList.add("hidden");ui.launcher.classList.remove("hidden");hideConnecting();showLauncherError("");setStatus("Listo para conectar",false)}
function targetTile(){return{x:Math.floor((mouse.x+camera.x)/TILE),y:Math.floor((mouse.y+camera.y)/TILE)}}
function inReach(x,y){return Math.hypot(x*TILE+TILE/2-(player.x+player.w/2),y*TILE+TILE/2-(player.y+player.h/2))<TILE*5}
function tileOverlapsPlayer(x,y){return x*TILE<player.x+player.w&&x*TILE+TILE>player.x&&y*TILE<player.y+player.h&&y*TILE+TILE>player.y}
function mine(){
 if(!active)return;const t=targetTile();if(t.x<0||t.x>=WORLD_W||t.y<0||t.y>=WORLD_H||!inReach(t.x,t.y)){showToast("Ese bloque está demasiado lejos.");return}
 const id=blockAt(t.x,t.y);if(!id){showToast("Ahí no hay ningún bloque.");return}
 if(online){send({type:"block",action:"mine",x:t.x,y:t.y})}
 else{writeBlock(t.x,t.y,0);inventory[id-1]++;updateHotbar();showToast("+"+blocks[id-1].name)}
}
function place(){
 if(!active)return;const t=targetTile();if(t.x<0||t.x>=WORLD_W||t.y<0||t.y>=WORLD_H||!inReach(t.x,t.y)){showToast("Ese lugar está demasiado lejos.");return}
 if(blockAt(t.x,t.y)!==0){showToast("Ese espacio está ocupado.");return}
 if(!inventory[selected]){showToast("No tienes ese bloque. ¡Mina algunos!");return}
 if(tileOverlapsPlayer(t.x,t.y)){showToast("No puedes colocarlo dentro de ti.");return}
 if(online)send({type:"block",action:"place",x:t.x,y:t.y,blockId:blocks[selected].id});
 else{writeBlock(t.x,t.y,blocks[selected].id);inventory[selected]--;updateHotbar()}
}
function attack(){if(!active||!online||gameMode!=="pvp")return;const now=performance.now();if(now-lastAttack<650)return;lastAttack=now;send({type:"attack"});particles.push({type:"slash",x:player.x+player.w/2,y:player.y+player.h/2,life:.24,max:.24})}
function isDown(){for(let i=0;i<arguments.length;i++)if(keys[String(arguments[i]).toLowerCase()])return true;return false}
function update(dt){
 dayClock+=dt;let dir=(isDown("a","d","arrowleft","arrowright")?0:0);if(isDown("a","arrowleft"))dir--;if(isDown("d","arrowright"))dir++;
 player.vx=dir*205;
 if(isDown("w","arrowup"," ","spacebar")&&player.onGround){player.vy=-420;player.onGround=false}
 player.vy=Math.min(650,player.vy+1200*dt);
 player.x+=player.vx*dt;if(collides(player.x,player.y))player.x-=player.vx*dt;
 player.y+=player.vy*dt;if(collides(player.x,player.y)){player.y-=player.vy*dt;if(player.vy>0)player.onGround=true;player.vy=0}else player.onGround=false;
 player.x=clamp(player.x,0,WORLD_W*TILE-player.w);
 const viewW=innerWidth,viewH=innerHeight;const tx=clamp(player.x+player.w/2-viewW*.5,0,Math.max(0,WORLD_W*TILE-viewW));const ty=clamp(player.y-viewH*.55,0,Math.max(0,WORLD_H*TILE-viewH));camera.x+=(tx-camera.x)*Math.min(1,dt*8);camera.y+=(ty-camera.y)*Math.min(1,dt*7);
 if(online){moveTimer+=dt;if(moveTimer>.09){moveTimer=0;send({type:"move",x:player.x,y:player.y})}}
 for(const p of remotePlayers.values()){if(p.rx==null)p.rx=p.x;if(p.ry==null)p.ry=p.y;p.rx+=(p.x-p.rx)*Math.min(1,dt*14);p.ry+=(p.y-p.ry)*Math.min(1,dt*14)}
 for(let i=particles.length-1;i>=0;i--){particles[i].life-=dt;if(particles[i].life<=0)particles.splice(i,1)}
 const t=targetTile();const id=blockAt(t.x,t.y);if(active&&id){$("target-chip").classList.remove("hidden");$("target-name").textContent=blocks[id-1]?blocks[id-1].name:"Bloque"}else $("target-chip").classList.add("hidden");
}
function rgb(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t))}
function cssrgb(a){return "rgb("+a.join(",")+")"}
function drawBlock(x,y,id){
 const sx=x*TILE-camera.x,sy=y*TILE-camera.y,b=blocks[id-1];if(!b)return;
 ctx.fillStyle=b.color;ctx.fillRect(sx,sy,TILE,TILE);ctx.fillStyle=b.top;ctx.fillRect(sx,sy,TILE,6);
 const n=rand2(seed,x,y);ctx.fillStyle="#ffffff16";ctx.fillRect(sx+3+n*12,sy+10,3,3);ctx.fillRect(sx+17+n*5,sy+21,4,3);ctx.fillStyle="#00000014";ctx.fillRect(sx,sy+TILE-3,TILE,3);
 if(id===4){ctx.fillStyle="#59391f";ctx.fillRect(sx+7,sy+7,2,22);ctx.fillRect(sx+21,sy+7,2,22);ctx.fillStyle="#d2a06a";ctx.fillRect(sx+13,sy+10,2,8)}
 if(id===5){ctx.fillStyle="#a6e77a55";ctx.fillRect(sx+4,sy+8,8,6);ctx.fillRect(sx+20,sy+19,7,6)}
 ctx.strokeStyle="#09131825";ctx.lineWidth=1;ctx.strokeRect(sx+.5,sy+.5,TILE-1,TILE-1);
}
function drawAvatar(x,y,name,color,hp,isLocal){
 const sx=x-camera.x,sy=y-camera.y;ctx.fillStyle="#0003";ctx.fillRect(sx-3,sy+27,26,5);
 ctx.fillStyle=color||"#84baf4";ctx.fillRect(sx+2,sy+10,16,11);ctx.fillStyle="#243640";ctx.fillRect(sx+3,sy+20,6,8);ctx.fillRect(sx+12,sy+20,6,8);
 ctx.fillStyle="#f0c3a1";ctx.fillRect(sx+4,sy,12,12);ctx.fillStyle="#634432";ctx.fillRect(sx+3,sy,14,4);ctx.fillRect(sx+2,sy+3,3,4);
 ctx.fillStyle="#202b2e";ctx.fillRect(sx+6,sy+5,2,2);ctx.fillRect(sx+12,sy+5,2,2);
 if(!isLocal){ctx.font="700 10px "+getComputedStyle(document.body).fontFamily;const width=ctx.measureText(name||"Player").width;ctx.fillStyle="#101c20cc";ctx.fillRect(sx+10-width/2,sy-20,width+20,15);ctx.fillStyle="#eff7f1";ctx.textAlign="center";ctx.fillText(name||"Player",sx+10,sy-9);ctx.fillStyle="#1118";ctx.fillRect(sx-1,sy-3,22,3);ctx.fillStyle="#ff8c87";ctx.fillRect(sx-1,sy-3,22*clamp(hp==null?100:hp,0,100)/100,3);ctx.textAlign="start"}
}
function render(ts){
 const w=innerWidth,h=innerHeight,day=.5+.5*Math.sin(dayClock*.1),top=rgb([7,18,34],[64,157,211],day),bottom=rgb([20,35,55],[180,225,193],day);
 const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,cssrgb(top));sky.addColorStop(.75,cssrgb(bottom));sky.addColorStop(1,day>.4?"#bedbb5":"#182b3b");ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
 const ox=w*(.16+.68*((dayClock*.012)%1));ctx.fillStyle=day>.42?"#ffe7a0":"#e0ebf7";ctx.beginPath();ctx.arc(ox,h*(.19+.06*Math.sin(dayClock*.1)),day>.42?21:15,0,Math.PI*2);ctx.fill();if(day<.35){ctx.fillStyle="#ffffffa0";for(let i=0;i<36;i++){const sx=rand2(seed,i,77)*w,sy=rand2(seed,i,88)*h*.53;ctx.fillRect(sx,sy,2,2)}}
 ctx.fillStyle=day<.35?"#162c42":"#6ea9a2";ctx.beginPath();ctx.moveTo(0,h);for(let x=0;x<=w+20;x+=20)ctx.lineTo(x,h*.59+Math.sin((x+camera.x*.13)*.008)*28+Math.sin(x*.02)*8);ctx.lineTo(w,h);ctx.fill();
 if(active){const x0=clamp(Math.floor(camera.x/TILE),0,WORLD_W),x1=clamp(Math.ceil((camera.x+w)/TILE)+1,0,WORLD_W),y0=clamp(Math.floor(camera.y/TILE),0,WORLD_H),y1=clamp(Math.ceil((camera.y+h)/TILE)+1,0,WORLD_H);
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const id=blockAt(x,y);if(id)drawBlock(x,y,id)}
 ctx.fillStyle="rgba(5,12,20,"+(.08+(1-day)*.24)+")";ctx.fillRect(0,0,w,h);
 for(const p of remotePlayers.values()){if(p.x-camera.x>-50&&p.x-camera.x<w+50)drawAvatar(p.rx==null?p.x:p.rx,p.ry==null?p.y:p.ry,p.name,p.color,p.hp,false)}
 drawAvatar(player.x,player.y,playerName,"#83bff0",player.hp,true);
 if(mouse.x>=0&&mouse.x<w){const target=targetTile();if(target.x>=0&&target.x<WORLD_W&&target.y>=0&&target.y<WORLD_H){ctx.strokeStyle="#f2ffe5cc";ctx.lineWidth=2;ctx.strokeRect(target.x*TILE-camera.x+1,target.y*TILE-camera.y+1,TILE-2,TILE-2)}}
 for(const p of particles){if(p.type==="slash"){const a=p.life/p.max;ctx.strokeStyle="rgba(183,243,107,"+a+")";ctx.lineWidth=4;ctx.beginPath();ctx.arc(player.x+player.w/2-camera.x,player.y+player.h/2-camera.y,18+(1-a)*13,-1.1,1.2);ctx.stroke()}}
 }else{
 ctx.globalAlpha=.55;for(let i=0;i<10;i++){const xx=((i*103+ts*.013)%(w+80))-40,yy=h*.44+(i%4)*24;ctx.fillStyle=["#70a35c","#b6d17a","#5c914d"][i%3];ctx.fillRect(xx,yy,32,32);ctx.fillStyle="#ffffff22";ctx.fillRect(xx,yy,32,5)}ctx.globalAlpha=1;
 }
 ui.day.textContent="DÍA "+(1+Math.floor(dayClock/85));
}
function resize(){const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.floor(innerWidth*dpr);canvas.height=Math.floor(innerHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
function frame(ts){const dt=lastFrame?Math.min((ts-lastFrame)/1000,.033):.016;lastFrame=ts;if(active)update(dt);render(ts);requestAnimationFrame(frame)}
function setMouse(e){const r=canvas.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top}
canvas.addEventListener("pointermove",setMouse);
canvas.addEventListener("pointerdown",e=>{if(!active)return;setMouse(e);if(e.pointerType==="touch"){e.preventDefault();mine()}else if(e.button===0)mine();else if(e.button===2)place()});
canvas.addEventListener("contextmenu",e=>e.preventDefault());
window.addEventListener("keydown",e=>{if(e.target&&["INPUT","TEXTAREA"].includes(e.target.tagName)){if(e.key==="Escape")e.target.blur();return}const k=e.key.toLowerCase();keys[k]=true;if(["arrowleft","arrowright","arrowup"," ","arrowdown"].includes(k))e.preventDefault();if(k>="1"&&k<="6"){selected=Number(k)-1;updateHotbar()}if(k==="f")attack();if(k==="r"&&active&&!online){resetForSolo()}});
window.addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false});
document.querySelectorAll("[data-key]").forEach(btn=>{const k=btn.dataset.key.toLowerCase();btn.addEventListener("pointerdown",e=>{e.preventDefault();keys[k]=true});["pointerup","pointerleave","pointercancel"].forEach(ev=>btn.addEventListener(ev,()=>keys[k]=false))});
$("create-room").addEventListener("click",()=>joinOnline("private",""));
$("join-room").addEventListener("click",()=>{const code=ui.code.value.trim().toUpperCase();if(!code){showLauncherError("Escribe el código de la sala que te compartieron.");return}joinOnline("private",code)});
$("quick-play").addEventListener("click",()=>joinOnline("pvp",""));
$("solo-play").addEventListener("click",resetForSolo);
$("leave-game").addEventListener("click",leaveGame);
$("cancel-connect").addEventListener("click",()=>{if(pendingJoin&&pendingJoin.timer)clearTimeout(pendingJoin.timer);pendingJoin=null;hideConnecting();if(socket){try{socket.close()}catch(e){}}socket=null;socketPromise=null});
$("mobile-mine").addEventListener("click",mine);$("mobile-place").addEventListener("click",place);ui.mobileAttack.addEventListener("click",attack);
$("chat-form").addEventListener("submit",e=>{e.preventDefault();const input=$("chat-input"),text=input.value.trim();if(text&&online){send({type:"chat",text:text.slice(0,140)});input.value=""}});
ui.code.addEventListener("input",()=>{ui.code.value=ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g,"")});
window.addEventListener("resize",resize);
generateWorld(seed);spawnPlayer();updateHotbar();resize();setStatus("Esperando servidor",false);
if(location.protocol!=="file:"&&location.host){fetch("/healthz",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(()=>setStatus("Servidor disponible",true)).catch(()=>setStatus("Sin servidor online",false))}
requestAnimationFrame(frame);
})();