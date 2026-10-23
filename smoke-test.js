"use strict";
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {createServer}=require("node:net");
const path=require("node:path");
const {WebSocket}=require("ws");

function getFreePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(err=>err?reject(err):resolve(port))})})}
function connect(port){return new Promise((resolve,reject)=>{const ws=new WebSocket("ws://127.0.0.1:"+port);const timer=setTimeout(()=>{ws.terminate();reject(new Error("WebSocket connection timed out"))},4000);ws.once("open",()=>{clearTimeout(timer);resolve(ws)});ws.once("error",err=>{clearTimeout(timer);reject(err)})})}
function waitMessage(ws,type,predicate=()=>true,timeout=4000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.removeListener("message",handler);reject(new Error("Timed out waiting for message: "+type))},timeout);function handler(raw){let data;try{data=JSON.parse(raw.toString())}catch(e){return}if(data.type===type&&predicate(data)){clearTimeout(timer);ws.removeListener("message",handler);resolve(data)}}ws.on("message",handler)})}
function send(ws,data){ws.send(JSON.stringify(data))}
function closeWs(ws){return new Promise(resolve=>{if(!ws||ws.readyState===WebSocket.CLOSED)return resolve();const timer=setTimeout(()=>{try{ws.terminate()}catch(e){}resolve()},500);if(timer.unref)timer.unref();ws.once("close",()=>{clearTimeout(timer);resolve()});try{ws.close()}catch(e){clearTimeout(timer);resolve()}})}
async function waitHealthy(port,child){for(let i=0;i<50;i++){if(child.exitCode!==null)throw new Error("Server exited early");try{const r=await fetch("http://127.0.0.1:"+port+"/healthz");if(r.ok)return}catch(e){}await new Promise(r=>setTimeout(r,100))}throw new Error("HTTP server did not become ready")}
async function main(){
 const port=await getFreePort(),url="http://127.0.0.1:"+port,child=spawn(process.execPath,[path.join(__dirname,"server.js")],{env:{...process.env,PORT:String(port)},stdio:["ignore","ignore","pipe"]});
 const sockets=[];let stderr="";child.stderr.on("data",d=>stderr+=d.toString());
 try{
  await waitHealthy(port,child);
  const page=await fetch(url+"/");assert.equal(page.status,200,"index page should load");assert.match(await page.text(),/BLOCK/,"index should include game brand");
  const health=await (await fetch(url+"/healthz")).json();assert.equal(health.ok,true,"health endpoint should report ok");
  const a=await connect(port);sockets.push(a);const joinedA=waitMessage(a,"joined");send(a,{type:"join",mode:"private",name:"TesterA"});const roomA=await joinedA;assert.equal(roomA.mode,"private");
  const b=await connect(port);sockets.push(b);const joinedB=waitMessage(b,"joined");const twoPlayers=waitMessage(a,"players",m=>m.players.length===2);send(b,{type:"join",mode:"private",roomCode:roomA.roomCode,name:"TesterB"});const roomB=await joinedB;await twoPlayers;assert.equal(roomB.roomCode,roomA.roomCode,"second player should enter the same private room");
  const chat=waitMessage(a,"chat",m=>m.text==="hello-room");send(b,{type:"chat",text:"hello-room"});assert.equal((await chat).name,"TesterB","chat should broadcast to the other player");
  const p2=roomB.players.find(p=>p.id===roomB.playerId);const moved=waitMessage(a,"player_update",m=>m.player.id===roomB.playerId);send(b,{type:"move",x:p2.x+25,y:p2.y});await moved;
  await closeWs(a);await closeWs(b);
  const c=await connect(port);sockets.push(c);const joinedC=waitMessage(c,"joined");send(c,{type:"join",mode:"pvp",name:"PvP_A"});const roomC=await joinedC;assert.equal(roomC.mode,"pvp");
  const d=await connect(port);sockets.push(d);const joinedD=waitMessage(d,"joined");const pvpCount=waitMessage(c,"players",m=>m.players.length===2);send(d,{type:"join",mode:"pvp",name:"PvP_B"});const roomD=await joinedD;await pvpCount;assert.equal(roomC.roomCode,roomD.roomCode,"public matchmaking should group players into one room");
  const pA=roomD.players.find(p=>p.id===roomC.playerId),pB=roomD.players.find(p=>p.id===roomD.playerId);const movedPvp=waitMessage(c,"player_update",m=>m.player.id===roomD.playerId);send(d,{type:"move",x:pA.x+25,y:pA.y});await movedPvp;
  const hit=waitMessage(d,"player_hit",m=>m.targetId===roomD.playerId&&m.health===75);send(c,{type:"attack"});await hit;
  console.log("PASS: HTTP, private rooms, player sync, chat, public matchmaking and PvP damage");
 }finally{
  await Promise.all(sockets.map(closeWs));child.kill("SIGTERM");await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once("exit",resolve);setTimeout(resolve,700).unref()});
  if(child.exitCode!==null&&child.exitCode!==0&&stderr)console.error(stderr);
 }
}
main().catch(err=>{console.error("FAIL:",err&&err.stack||err);process.exitCode=1});
